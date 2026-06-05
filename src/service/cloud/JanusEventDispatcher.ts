/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as db from "../../db/Model";
import * as WebRtcTypes from "../webrtc/v2/WebRtcTypes";
import { JanusSession, WebSocketExtendedWithJanus } from "../../CommonTypes";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { LoggerFactory } from "../log/LoggerFactory";
import { Logger } from "../log/Logger";
import { StreamNotificationService } from "./StreamNotificationService";
import { JanusNotificationParser } from "./JanusNotificationParser";
import { isPublishingSession } from "./JanusContext";

const JanusEvents = {
    UPDATED: "updated",
} as const;

/**
 * Routes a raw Janus notification to the bridge event it maps to. The only event translated is
 * the subscriber re-offer; every other Janus push is either already conveyed by a broadcast event
 * (publish/unpublish/leave) or is internal signaling we don't expose — those are ignored, not
 * forwarded. This is the inbound half of the per-ws Janus integration; it knows nothing about
 * connection lifecycle.
 */
export class JanusEventDispatcher {
    
    private logger: Logger;
    
    constructor(
        loggerFactory: LoggerFactory,
        private repositoryFactory: RepositoryFactory,
        private streamNotificationService: StreamNotificationService,
        private parser: JanusNotificationParser,
    ) {
        this.logger = loggerFactory.createLogger(JanusEventDispatcher);
    }
    
    async handleJanusNotification(notification: any, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): Promise<void> {
        if (!websocket.ex.janus || !websocket.ex.janus[wsId]) {
            return; // Drop packet, context mismatch or already deleted
        }
        
        if (!this.parser.isValidJanusNotification(notification)) {
            this.logger.warning(notification, "Invalid Janus notification structure, ignoring");
            return;
        }
        
        try {
            const ctx = await websocket.ex.janus[wsId].janusContextPromise;
            const sessionId = notification.session_id as WebRtcTypes.SessionId;
            const janusSession = ctx.findJanusSessionByIdOrReturnNull(sessionId);
            if (!janusSession) {
                return;
            }
            
            const streamRoom = await this.repositoryFactory.createStreamRoomRepository().get(janusSession.streamRoomId);
            if (!streamRoom) {
                this.logger.error({ sessionId, streamRoomId: janusSession.streamRoomId }, "Stream room missing for active session");
                return;
            }
            
            if (!this.tryDispatchSubscriberReoffer(janusSession, streamRoom, notification, websocket, wsId)) {
                this.logger.debug({ eventType: notification.janus }, "Ignoring untranslated Janus event");
            }
        }
        catch (error) {
            this.logger.error(error, "Error processing Janus notification");
        }
    }
    
    /** A subscriber whose upstream changed gets a fresh Janus offer; forward only the jsep to renegotiate. */
    private tryDispatchSubscriberReoffer(session: JanusSession, streamRoom: db.stream.StreamRoom, event: any, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): boolean {
        if (session.type === "subscriber" && this.parser.extractAndValidateEventType(event) === JanusEvents.UPDATED) {
            this.streamNotificationService.sendStreamRoomReofferSingleEvent(websocket, wsId, streamRoom, event.jsep as WebRtcTypes.RTCSessionDescriptionOffer | undefined);
            return true;
        }
        return false;
    }
    
    /**
     * On a dropped client ws there is no unpublish/leave API call, so synthesize the same
     * broadcast events here: `streamUnpublished` for publishing sessions, then `streamRoomLeft`
     * (deduplicated per room+user).
     */
    emitDisconnectEventsForSessions(sessions: JanusSession[]): void {
        const leftEmitted = new Set<string>();
        const roomCache = new Map<types.stream.StreamRoomId, Promise<db.stream.StreamRoom | null>>();
        const getRoom = (id: types.stream.StreamRoomId) => {
            let room = roomCache.get(id);
            if (!room) {
                room = this.repositoryFactory.createStreamRoomRepository().get(id);
                roomCache.set(id, room);
            }
            return room;
        };
        for (const sess of sessions) {
            const streamRoomId = sess.streamRoomId;
            const userId = sess.userId;
            const wasPublishing = isPublishingSession(sess);
            const leftKey = `${streamRoomId}/${userId}`;
            const emitLeft = !leftEmitted.has(leftKey);
            if (emitLeft) {
                leftEmitted.add(leftKey);
            }
            void (async () => {
                const streamRoom = await getRoom(streamRoomId);
                if (!streamRoom) {
                    return;
                }
                if (wasPublishing) {
                    this.streamNotificationService.sendStreamUnpublishedEvent(streamRoom, { streamRoomId, streamId: Number(sess.janusPublisherId), userId });
                }
                if (emitLeft) {
                    this.streamNotificationService.sendStreamRoomLeftEvent(streamRoom, { streamRoomId, userId });
                }
            })();
        }
    }
}
