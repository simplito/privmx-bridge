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
            
            this.registerJanusCleanupHandlers(websocket, wsId, conn, janusSessions, setClosedAndClearPingers);
            
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
    
    private registerJanusCleanupHandlers(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId, conn: JanusConnection, janusSessions: JanusSession[], cleanupCallback: () => void): void {
        let cleanedUp = false;
        
        const doCleanup = () => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;
            const sessionsToClean = [...janusSessions];
            cleanupCallback();
            janusSessions.splice(0);
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
                                    this.logger.error({ sessionId: sess.session.id, error: e }, "Graceful leave failed during session cleanup");
                                }
                            }
                            
                            try {
                                await conn.janusApi.destroy({
                                    janus: "destroy",
                                    session_id: sess.session.id,
                                });
                            }
                            catch (e) {
                                this.logger.error({ sessionId: sess.session.id, error: e }, "Session destroy failed during session cleanup");
                            }
                        }));
                    }
                }
                finally {
                    conn.janusWs.close();
                }
            })();
        };
        
        if (websocket.ex.janus && websocket.ex.janus[wsId]) {
            websocket.ex.janus[wsId].cleanup = doCleanup;
        }
        
        websocket.on("close", doCleanup);
        
        conn.janusWs.addEventListener("close", () => {
            cleanedUp = true;
            cleanupCallback();
            janusSessions.splice(0);
        });
    }
    
    static cleanupJanusForWsId(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): void {
        if (!websocket.ex.janus) {
            return;
        }
        const entry = websocket.ex.janus[wsId];
        if (!entry) {
            return;
        }
        entry.cleanup?.();
        delete websocket.ex.janus[wsId];
    }
}
