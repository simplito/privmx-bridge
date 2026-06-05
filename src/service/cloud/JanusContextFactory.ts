/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { JanusConnection, JanusSession } from "../../CommonTypes";
import * as types from "../../types";
import { AppException } from "../../api/AppException";
import { WebSocketExtendedWithJanus } from "../../CommonTypes";
import { LoggerFactory } from "../log/LoggerFactory";
import * as WebSocket from "ws";
import { JanusContext } from "./JanusContext";
import { Logger } from "../log/Logger";
import { JanusConnector } from "./JanusConnector";
import { JanusEventDispatcher } from "./JanusEventDispatcher";

const JANUS_PLUGIN = "janus.plugin.videoroom";

/** Per-ws JanusContext lifecycle (create/cache/cleanup); transport via JanusConnector, inbound events via JanusEventDispatcher. */
export class JanusContextFactory {
    
    private logger: Logger;
    
    constructor(
        private loggerFactory: LoggerFactory,
        private connector: JanusConnector,
        private dispatcher: JanusEventDispatcher,
    ) {
        this.logger = this.loggerFactory.createLogger(JanusContextFactory);
    }
    
    async prepareJanusContext(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): Promise<JanusContext> {
        if (!websocket.ex.janus) {
            websocket.ex.janus = {};
        }
        
        if (websocket.ex.janus[wsId]) {
            return websocket.ex.janus[wsId].janusContextPromise;
        }
        
        const contextPromise = this.createJanusContextInternal(websocket, wsId);
        websocket.ex.janus[wsId] = { janusContextPromise: contextPromise };
        
        contextPromise.catch(() => {
            if (websocket.ex.janus && websocket.ex.janus[wsId] && websocket.ex.janus[wsId].janusContextPromise === contextPromise) {
                delete websocket.ex.janus[wsId];
            }
        });
        
        return contextPromise;
    }
    
    private async createJanusContextInternal(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): Promise<JanusContext> {
        try {
            const conn = await this.connector.openWs(notification =>
                this.dispatcher.handleJanusNotification(notification, websocket, wsId),
            );
            
            let closed = false;
            const janusSessions: JanusSession[] = [];
            
            const setClosedAndClearPingers = () => {
                if (closed) {
                    return;
                }
                closed = true;
                for (const session of janusSessions) {
                    clearInterval(session.keepAlivePinger);
                }
            };
            
            this.registerJanusCleanupHandlers(websocket, conn, janusSessions, setClosedAndClearPingers);
            
            return new JanusContext(
                conn,
                janusSessions,
                () => closed,
                this.loggerFactory.createLogger(JanusContext),
            );
            
        }
        catch (e: unknown) {
            this.logger.error(e, "Cannot connect to media server for user context");
            throw new AppException("CANNOT_CONNECT_TO_MEDIA_SERVER");
        }
    }
    
    private registerJanusCleanupHandlers(websocket: WebSocketExtendedWithJanus, conn: JanusConnection, janusSessions: JanusSession[], cleanupCallback: () => void): void {
        let cleanedUp = false;
        const cleanup = () => {
            cleanupCallback();
        };
        
        websocket.on("close", () => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;
            const sessionsToClean = [...janusSessions];
            cleanup();
            janusSessions.splice(0);
            // The client connection dropped: emit streamUnpublished (for publishing sessions)
            // + streamRoomLeft, mirroring an explicit unpublish/leave, so peers tear down media
            // and roster without an API call.
            this.dispatcher.emitDisconnectEventsForSessions(sessionsToClean);
            void (async () => {
                try {
                    if (conn.janusWs.readyState === WebSocket.OPEN) {
                        await Promise.all(sessionsToClean.map(async (sess) => {
                            if (sess.session && sess.session.handle) {
                                try {
                                    await conn.janusVideoRoomPluginApi.leave({
                                        janus: "message",
                                        session_id: sess.session.id,
                                        handle_id: sess.session.handle,
                                        plugin: JANUS_PLUGIN,
                                        body: { request: "leave" },
                                    });
                                }
                                catch (e) {
                                    this.logger.error({ sessionId: sess.session.id, error: e }, "Graceful leave failed during socket close");
                                }
                            }
                            
                            try {
                                await conn.janusApi.destroy({
                                    janus: "destroy",
                                    session_id: sess.session.id,
                                });
                            }
                            catch (e) {
                                this.logger.error({ sessionId: sess.session.id, error: e }, "Session destroy failed during socket close");
                            }
                        }));
                    }
                }
                finally {
                    conn.janusWs.close();
                }
            })();
        });
        
        conn.janusWs.addEventListener("close", () => {
            cleanedUp = true;
            cleanup();
            janusSessions.splice(0);
        });
    }
}
