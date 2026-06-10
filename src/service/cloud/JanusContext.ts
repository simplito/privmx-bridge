/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { JanusConnection, JanusSession, JanusSessionType } from "../../CommonTypes";
import * as types from "../../types";
import { AppException } from "../../api/AppException";
import * as WebRtcTypes from "../webrtc/v2/WebRtcTypes";
import { Logger } from "../log/Logger";

export function isPublishingSession(session: JanusSession): boolean {
    return session.type === "main" && session.janusPublisherId !== undefined && session.publishedStreams.length > 0;
}

export class JanusContext {
    
    private static readonly KEEPALIVE_INTERVAL_MS = 25000;
    private static readonly JANUS_PLUGIN_VIDEOROOM = "janus.plugin.videoroom";
    
    private opChains = new Map<string, Promise<unknown>>();
    
    constructor(
        public readonly ws: JanusConnection,
        public janusSessions: JanusSession[],
        private readonly isClosed: () => boolean,
        private readonly logger: Logger,
    ) {}
    
    /**
     * Serializes session-lifecycle operations sharing a `key` (e.g. one room on this ws). Without
     * it, find-then-create flows race across `await`s and produce duplicate Janus sessions, and
     * leave/publish can interleave. Each call runs after the previous one for the same key settles.
     */
    runExclusive<T>(key: string, func: () => Promise<T>): Promise<T> {
        const previous = this.opChains.get(key) ?? Promise.resolve();
        const next = previous.then(() => func(), () => func());
        this.opChains.set(key, next.then(() => undefined, () => undefined));
        return next;
    }
    
    async createJanusSession(source: string, streamRoomId: types.stream.StreamRoomId, type: JanusSessionType, userId: types.cloud.UserId): Promise<JanusSession> {
        if (this.isClosed()) {
            throw new AppException("MEDIA_SERVER_SOCKET_ALREADY_CLOSED");
        }
        
        const createSessionResponse = await this.ws.janusApi.create({ janus: "create" });
        const sessionId = createSessionResponse.data.id;
        const placeholderHandleId = -1 as unknown as WebRtcTypes.VideoRoomPluginHandleId;
        
        const jSession: JanusSession = {
            source,
            streamRoomId,
            session: { id: sessionId, handle: placeholderHandleId },
            keepAlivePinger: null as any,
            streamsToAccept: [],
            type,
            userId,
            
            addStreamsOffer: function(streamsIds: WebRtcTypes.StreamId[]) {
                if (streamsIds && Array.isArray(streamsIds)) {
                    this.streamsToAccept.push(...streamsIds);
                }
            },
            
            acceptStreamsOffer: function() {
                const accepted = [...this.streamsToAccept];
                this.streamsToAccept = [];
                return accepted;
            },
            
            publishedStreams: [],
            publishedAnnounced: false,
            
            keepPublishedStream: function(stream: WebRtcTypes.Publisher): void {
                const streamToAdd = structuredClone(stream);
                if (!streamToAdd.display) {
                    streamToAdd.display = this.userId;
                }
                this.publishedStreams.push(streamToAdd);
            },
            
            removePublishedStream: function(streamId: WebRtcTypes.StreamId): void {
                const found = this.publishedStreams.findIndex(x => x.id === streamId);
                if (found > -1) {
                    this.publishedStreams.splice(found, 1);
                }
            },
        };
        
        this.janusSessions.push(jSession);
        
        try {
            const attachResponse = await this.ws.janusApi.attach({
                janus: "attach",
                session_id: sessionId,
                plugin: JanusContext.JANUS_PLUGIN_VIDEOROOM,
            });
            
            const handleId = attachResponse.data.id as WebRtcTypes.VideoRoomPluginHandleId;
            
            jSession.session.handle = handleId;
            jSession.keepAlivePinger = setInterval(() => void this.tryKeepAlive(this.ws, sessionId), JanusContext.KEEPALIVE_INTERVAL_MS);
            
            return jSession;
        }
        catch (error) {
            const index = this.janusSessions.indexOf(jSession);
            if (index > -1) {
                this.janusSessions.splice(index, 1);
            }
            throw error;
        }
    }
    
    findJanusSession(sessionId: WebRtcTypes.SessionId): JanusSession {
        const session = this.findJanusSessionByIdOrReturnNull(sessionId);
        if (!session) {
            throw new AppException("INVALID_PARAMS", `Janus session ${sessionId} not found`);
        }
        return session;
    }
    
    findJanusSessionByIdOrReturnNull(sessionId: WebRtcTypes.SessionId): JanusSession | undefined {
        return this.janusSessions.find(x => x.session.id === sessionId);
    }
    
    findJanusSessionBySourceOrReturnNull(source: string): JanusSession | undefined {
        return this.janusSessions.find(x => x.source === source);
    }
    
    async deleteJanusSession(sessionId: WebRtcTypes.SessionId): Promise<void> {
        const index = this.janusSessions.findIndex(x => x.session.id === sessionId);
        if (index < 0) {
            return;
        }
        // Mutate in place — the same array instance is shared with the ws-cleanup handler, so
        // reassigning here would desync it (leaking pingers / Janus sessions on close).
        const [session] = this.janusSessions.splice(index, 1);
        
        if (session.keepAlivePinger) {
            clearInterval(session.keepAlivePinger);
        }
        
        try {
            await this.ws.janusApi.detach({
                janus: "detach",
                session_id: sessionId,
                handle_id: session.session.handle,
            });
            await this.ws.janusApi.destroy({
                janus: "destroy",
                session_id: sessionId,
            });
        }
        catch (e) {
            this.logger.warning({ sessionId, error: e }, "Error cleaning up Janus session (may have been already closed)");
        }
    }
    
    async deleteAllJanusSessionsByRoom(streamRoomId: types.stream.StreamRoomId) {
        const sessionsToRemove = this.janusSessions.filter(x => x.streamRoomId === streamRoomId);
        // Remove in place (see deleteJanusSession) rather than reassigning the shared array.
        for (const sess of sessionsToRemove) {
            const index = this.janusSessions.indexOf(sess);
            if (index > -1) {
                this.janusSessions.splice(index, 1);
            }
        }
        
        await Promise.all(sessionsToRemove.map(async (sess) => {
            if (sess.keepAlivePinger) {
                clearInterval(sess.keepAlivePinger);
            }
            try {
                await this.ws.janusApi.destroy({
                    janus: "destroy",
                    session_id: sess.session.id,
                });
            }
            catch {
                this.logger.debug({ sessionId: sess.session.id }, "Session destroy failed (likely already closed)");
            }
        }));
    }
    
    private async tryKeepAlive(conn: JanusConnection, sessionId: WebRtcTypes.SessionId) {
        if (this.isClosed()) {
            return;
        }
        
        try {
            await conn.janusApi.keepAlive({janus: "keepalive", session_id: sessionId});
        }
        catch (e) {
            this.logger.debug({sessionId, e}, "KeepAlive failed");
        }
    }
}