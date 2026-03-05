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
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import * as WebRtcTypes from "../webrtc/v2/WebRtcTypes";
import { WebSocketExtendedWithJanus } from "../../CommonTypes";
import * as streamApi from "../../api/main/stream/StreamApiTypes";
import { DateUtils } from "../../utils/DateUtils";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { LoggerFactory } from "../log/LoggerFactory";
import { WebSocketOutboundHandler } from "../ws/WebSocketOutboundHandler";
import * as WebSocket from "ws";
import { StreamNotificationService } from "./StreamNotificationService";
import { JanusVideoRoomPluginApi } from "../webrtc/v2/janus/videoroom/JanusVideoRoomPluginApi";
import { JanusRequester } from "../webrtc/v2/janus/JanusRequester";
import { JanusApi } from "../webrtc/v2/janus/JanusApi";
import { Config } from "../../cluster/common/ConfigUtils";
import { JanusContext } from "./JanusContext";
import { Logger } from "../log/Logger";
import { NewPublisherEventRaw, VideoRoomStreamTrack } from "../webrtc/v2/WebRtcTypes";

interface AdminContext {
    connection: JanusConnection;
    sessionId: WebRtcTypes.SessionId;
    handleId: WebRtcTypes.VideoRoomPluginHandleId;
}

export class JanusContextFactory {
    
    private static readonly JanusConstants = {
        PROTOCOL: "janus-protocol",
        PLUGIN: "janus.plugin.videoroom",
        Events: {
            ATTACHED: "attached",
            UPDATED: "updated",
            EVENT: "event",
            PUBLISHERS: "publishers",
            UNPUBLISHED: "unpublished",
            LEAVING: "leaving",
        },
    } as const;
    
    private logger: Logger;
    private adminContext: AdminContext | null = null;
    private adminKeepAliveInterval: NodeJS.Timeout | null = null;
    
    constructor(
        private loggerFactory: LoggerFactory,
        private webSocketOutboundHandler: WebSocketOutboundHandler,
        private streamNotificationService: StreamNotificationService,
        private repositoryFactory: RepositoryFactory,
        private config: Config,
    ) {
        this.logger = this.loggerFactory.createLogger(JanusContextFactory);
    }
    
    async withJanus<T>(func: (videoApi: JanusVideoRoomPluginApi, sessionId: WebRtcTypes.SessionId, handleId: WebRtcTypes.VideoRoomPluginHandleId) => Promise<T>): Promise<T> {
        try {
            const ctx = await this.getAdminContext();
            return await func(ctx.connection.janusVideoRoomPluginApi, ctx.sessionId, ctx.handleId);
        }
        catch (e) {
            this.logger.error(e, "Error during request to media server (Admin Task)");
            this.destroyAdminContext();
            throw new AppException("ERROR_DURING_REQUEST_TO_MEDIA_SERVER");
        }
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
    
    private async getAdminContext(): Promise<AdminContext> {
        if (this.adminContext && !this.adminContext.connection.janusWs.CLOSED && this.adminContext.connection.janusWs.readyState === WebSocket.OPEN) {
            return this.adminContext;
        }
        
        this.destroyAdminContext();
        
        this.logger.out("Opening new persistent Admin Janus Connection...");
        const connection = await this.openWs();
        
        try {
            const createSessionResponse = await connection.janusApi.create({ janus: "create" });
            const sessionId = createSessionResponse.data.id;
            
            const attachResponse = await connection.janusApi.attach({ janus: "attach", session_id: sessionId, plugin: JanusContextFactory.JanusConstants.PLUGIN });
            const handleId = attachResponse.data.id as WebRtcTypes.VideoRoomPluginHandleId;
            
            this.adminContext = { connection, sessionId, handleId };
            
            this.adminKeepAliveInterval = setInterval(() => {
                connection.janusApi.keepAlive({ janus: "keepalive", session_id: sessionId })
                    .catch(err => {
                        this.logger.error(err, "Admin KeepAlive failed. Resetting context.");
                        this.destroyAdminContext();
                    });
            }, 30000);
            
            connection.janusWs.addEventListener("close", () => {
                this.logger.warning({}, "Admin Janus Connection closed unexpectedly.");
                this.destroyAdminContext();
            });
            
            return this.adminContext;
        }
        catch (error) {
            connection.janusWs.close();
            throw error;
        }
    }
    
    private destroyAdminContext() {
        if (this.adminKeepAliveInterval) {
            clearInterval(this.adminKeepAliveInterval);
            this.adminKeepAliveInterval = null;
        }
        if (this.adminContext) {
            try {
                this.adminContext.connection.janusWs.close();
            }
            catch { /* ignore */ }
            this.adminContext = null;
        }
    }
    
    private async createJanusContextInternal(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): Promise<JanusContext> {
        try {
            const conn = await this.openWs(notification =>
                this.handleJanusNotification(notification, websocket, wsId),
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
            
            this.registerJanusCleanupHandlers(websocket, conn, wsId, janusSessions, setClosedAndClearPingers);
            
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
    
    private async handleJanusNotification(notification: any, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): Promise<void> {
        if (!websocket.ex.janus || !websocket.ex.janus[wsId]) {
            return; // Drop packet, context mismatch or already deleted
        }
        
        if (!this.isValidJanusNotification(notification)) {
            this.logger.warning(notification, "Invalid notification structure, treating as generic event");
            this.processJanusGenericEvent(notification, websocket, wsId);
            return;
        }
        
        try {
            const ctx = await websocket.ex.janus[wsId].janusContextPromise;
            const sessionId = notification.session_id as WebRtcTypes.SessionId;
            const janusSession = ctx.findJanusSession(sessionId);
            
            if (!janusSession) {
                this.processJanusGenericEvent(notification, websocket, wsId);
                return;
            }
            
            const streamRoom = await this.repositoryFactory.createStreamRoomRepository().get(janusSession.streamRoomId);
            if (!streamRoom) {
                this.logger.error({ sessionId, streamRoomId: janusSession.streamRoomId }, "Stream room missing for active session");
                return;
            }
            
            switch (janusSession.type) {
                case "main":
                    this.processJanusPublisherEvents(websocket, wsId, streamRoom, janusSession, notification);
                    break;
                case "subscriber":
                    this.processJanusSubscriberEvents(websocket, wsId, streamRoom, janusSession, notification);
                    break;
                default:
                    this.processJanusGenericEvent(notification, websocket, wsId, streamRoom);
            }
        }
        catch (error) {
            this.logger.error(error, "Error processing Janus notification");
            this.processJanusGenericEvent(notification, websocket, wsId);
        }
    }
    
    private isValidJanusNotification(n: any): boolean {
        return typeof n === "object" && n !== null && "janus" in n && "session_id" in n && typeof n.session_id === "number";
    }
    
    private processJanusSubscriberEvents(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId, mappedRoom: db.stream.StreamRoom, janusSession: JanusSession, event: any) {
        const eventType = this.extractAndValidateEventType(event);
        
        if (eventType === JanusContextFactory.JanusConstants.Events.UPDATED) {
            const extractedData = this.extractData<WebRtcTypes.JanusRoomStreamsUpdatedData>(event);
            if (extractedData) {
                extractedData.jsep = event.jsep;
                extractedData.sessionId = janusSession.session.id;
                this.streamNotificationService.sendSubscriberStreamsUpdatedSingleEvent(websocket, wsId, mappedRoom, extractedData);
            }
        }
    }
    
    private processJanusPublisherEvents(_websocket: WebSocketExtendedWithJanus, _wsId: types.core.WsId, mappedRoom: db.stream.StreamRoom, _janusSession: JanusSession, event: any) {
        const eventType = this.extractAndValidateEventType(event);
        const eventData = this.extractData<any>(event);
        
        if (eventType === JanusContextFactory.JanusConstants.Events.EVENT && eventData) {
            if (JanusContextFactory.JanusConstants.Events.PUBLISHERS in eventData) {
                const convertedData = this.convertJanusVideoRoomPublishersEvent(eventData as WebRtcTypes.JanusVideoRoomCurrentPublishersRaw);
                this.streamNotificationService.sendNewStreamsSingleEvent(_websocket, _wsId, mappedRoom, convertedData);
            }
            else if (JanusContextFactory.JanusConstants.Events.UNPUBLISHED in eventData) {
                this.streamNotificationService.sendUnpublishedSingleEvent(_websocket, _wsId, mappedRoom, eventData.unpublished as WebRtcTypes.StreamId);
            }
            else if (JanusContextFactory.JanusConstants.Events.LEAVING in eventData) {
                try {
                    const leftEventData = this.convertLeavingPublisherToStreamLeftEventDataOrThrow(eventData as WebRtcTypes.JanusVideoRoomUserLeftEventRaw, mappedRoom);
                    this.streamNotificationService.sendStreamLeftEvent(mappedRoom, leftEventData);
                }
                catch {
                    this.logger.debug(event, "Event.LEAVING not emited by user.");
                }
                
            }
            else {
                this.logger.warning(event, "UNANDLED JANUS EVENT");
            }
        }
    }
    
    private processJanusGenericEvent(event: any, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId, mappedRoom?: db.stream.StreamRoom) {
        if (event.janus !== "ack" && event.janus !== "keepalive") {
            this.logger.debug({ eventType: event.janus }, "Processing Janus Generic Event");
        }
        
        const evt: streamApi.JanusGenericEvent = {
            channel: "stream",
            type: "janus",
            data: event,
            timestamp: DateUtils.now(),
        };
        const session = websocket.ex.sessions.find(x => x.wsId === wsId);
        if (session) {
            const payload = mappedRoom ? this.streamNotificationService.convertJanusRoomIdToBridgeRoomId(mappedRoom, evt) : evt;
            this.webSocketOutboundHandler.sendToWsSession(websocket, session, payload);
        }
    }
    
    async openWs(onUnhandledMessage?: (notification: unknown) => unknown, onEveryMessage?: (notification: unknown) => unknown): Promise<JanusConnection> {
        try {
            const url = `wss://${this.config.streams.mediaServer.url}:${this.config.streams.mediaServer.port}`;
            const janusWs = new WebSocket(url, JanusContextFactory.JanusConstants.PROTOCOL, {
                protocolVersion: 8,
                rejectUnauthorized: !this.config.streams.mediaServer.allowSelfSignedCerts,
            });
            
            return new Promise<JanusConnection>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    janusWs.close();
                    reject(new AppException("CANNOT_CONNECT_TO_MEDIA_SERVER", "Connection timed out"));
                }, 5000);
                
                janusWs.addEventListener("open", () => {
                    clearTimeout(timeout);
                    const janusRequester = new JanusRequester(this.loggerFactory.createLogger(JanusRequester), janusWs, this.config, x => onUnhandledMessage?.(x), x => onEveryMessage?.(x));
                    const janusApi = new JanusApi(janusRequester, this.loggerFactory.createLogger(JanusApi));
                    const janusVideoRoomPluginApi = new JanusVideoRoomPluginApi(janusRequester, this.loggerFactory.createLogger(JanusVideoRoomPluginApi));
                    resolve({ janusRequester, janusWs, janusApi, janusVideoRoomPluginApi });
                });
                
                janusWs.addEventListener("error", (err: unknown) => {
                    clearTimeout(timeout);
                    this.logger.error(err, "WS Connection Error");
                    reject(new AppException("CANNOT_CONNECT_TO_MEDIA_SERVER"));
                });
            });
        }
        catch (e) {
            this.logger.error(e, "Cannot connect to media server");
            throw new AppException("CANNOT_CONNECT_TO_MEDIA_SERVER");
        }
    }
    
    private registerJanusCleanupHandlers(websocket: WebSocketExtendedWithJanus, conn: JanusConnection, wsId: types.core.WsId, janusSessions: JanusSession[], cleanupCallback: () => void): void {
        const cleanup = () => {
            cleanupCallback();
        };
        
        websocket.on("close", () => {
            const sessionsToClean = [...janusSessions];
            cleanup();
            janusSessions.splice(0);
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
                                        plugin: JanusContextFactory.JanusConstants.PLUGIN,
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
            cleanup();
            janusSessions.splice(0);
            this.sendJanusCloseEvent(websocket, wsId);
        });
    }
    
    private sendJanusCloseEvent(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): void {
        const evt: streamApi.JanusCloseEvent = {
            channel: "stream",
            type: "janusclose",
            data: true,
            timestamp: DateUtils.now(),
        };
        const session = websocket.ex.sessions.find(x => x.wsId === wsId);
        if (session) {
            this.webSocketOutboundHandler.sendToWsSession(websocket, session, evt);
        }
    }
    
    private extractData<T>(raw: any): T | null {
        if ("plugindata" in raw && "data" in raw.plugindata) {
            return raw.plugindata.data as T;
        }
        return null;
    }
    
    private extractAndValidateEventType(raw: any): string {
        const data = this.extractData<any>(raw);
        if (!data && "janus" in raw) {
            return raw.janus;
        }
        if (data && "videoroom" in data) {
            return data.videoroom;
        }
        this.logger.warning({ raw }, "Unknown event type structure");
        return "unknown";
    }
    
    private convertJanusVideoRoomPublishersEvent(raw: WebRtcTypes.JanusVideoRoomCurrentPublishersRaw): WebRtcTypes.NewStreamsEventData {
        const {publishers, ...parentTypeRest} = raw;
        return {...parentTypeRest, streams: publishers.map(x => this.convertPublisherToPublisherAsStream(x))};
    }
    
    public convertPublisherToPublisherAsStream(publisher: WebRtcTypes.Publisher): WebRtcTypes.PublisherAsStream {
        const {display, streams, ...rest} = publisher;
        if (!display || !streams) {
            throw new Error("convertPublisherToPublisherAsStream(): Cannot convert Janus publisher to Endpoint's stream.");
        }
        return {...rest, userId: display, tracks: streams};
    }
    
    public convertLeavingPublisherToStreamLeftEventDataOrThrow(eventData: {
        videoroom: "event";
        room: WebRtcTypes.VideoRoomId;
        leaving: number;
        display?: string;
    }, mappedRoom: db.stream.StreamRoom): streamApi.StreamLeftEventData {
        if (!eventData.display) {
            throw new Error("Event not emited by user");
        }
        return {
            userId: eventData.display as types.cloud.UserId,
            streamId: eventData.leaving as number,
            streamRoomId: mappedRoom.id,
        };
    }
    
    static isVideoRoomStreamTrack(obj: any): obj is VideoRoomStreamTrack {
        return (
            typeof obj === "object" &&
            obj !== null &&
            typeof obj.type === "string" &&
            typeof obj.codec === "string" &&
            typeof obj.mid === "string" &&
            typeof obj.mindex === "number"
        );
    }
    
    static isNewPublisherEventRaw(obj: any, lazy: boolean = true): obj is NewPublisherEventRaw {
        return (
            typeof obj === "object" &&
            obj !== null &&
            typeof obj.id === "number" &&
            typeof obj.video_codec === "string" &&
            typeof obj.display === "string" &&
            Array.isArray(obj.streams) &&
            (lazy || obj.streams.every((item: any) => JanusContextFactory.isVideoRoomStreamTrack(item)))
        );
    }
    
    static isJanusVideoRoomCurrentPublishersRaw(obj: any, lazy: boolean = true): obj is WebRtcTypes.JanusVideoRoomCurrentPublishersRaw {
        return (
            typeof obj === "object" &&
            obj !== null &&
            typeof obj.room === "number" &&
            (Array.isArray(obj.publishers) && (lazy || obj.publishers.every((item: any) => JanusContextFactory.isNewPublisherEventRaw(item))))
        );
    }
}