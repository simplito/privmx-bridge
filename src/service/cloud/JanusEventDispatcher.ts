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
import { JanusVideoRoomMapper } from "./JanusVideoRoomMapper";
import { isPublishingSession } from "./JanusContext";

const JanusEvents = {
    UPDATED: "updated",
    WEBRTCUP: "webrtcup",
} as const;

/**
 * Routes a raw Janus notification to the bridge event it maps to. Only two are translated: a
 * subscriber `updated` → `streamRoomReoffer`, and a publisher `webrtcup` → `streamPublished`.
 * Every other Janus push is either already conveyed by a broadcast event (publish/unpublish/leave)
 * or is internal signaling we don't expose — those are ignored, not forwarded. This is the inbound
 * half of the per-ws Janus integration; it knows nothing about connection lifecycle.
 */
export class JanusEventDispatcher {
    
    private logger: Logger;
    
    constructor(
        loggerFactory: LoggerFactory,
        private repositoryFactory: RepositoryFactory,
        private streamNotificationService: StreamNotificationService,
        private parser: JanusNotificationParser,
        private mapper: JanusVideoRoomMapper,
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
            
            // Only two Janus events translate to a bridge event; decide that first so we skip the
            // stream-room DB lookup for the high-frequency noise (talking/slowlink/media/…).
            const eventType = this.parser.extractAndValidateEventType(notification);
            const isSubscriberReoffer = janusSession.type === "subscriber" && eventType === JanusEvents.UPDATED;
            const isPublisherReady = janusSession.type === "main" && eventType === JanusEvents.WEBRTCUP;
            if (!isSubscriberReoffer && !isPublisherReady) {
                this.logger.debug({ eventType }, "Ignoring untranslated Janus event");
                return;
            }
            
            const streamRoom = await this.repositoryFactory.createStreamRoomRepository().get(janusSession.streamRoomId);
            if (!streamRoom) {
                this.logger.error({ sessionId, streamRoomId: janusSession.streamRoomId }, "Stream room missing for active session");
                return;
            }
            
            if (isSubscriberReoffer) {
                // A subscriber whose upstream changed gets a fresh Janus offer; forward only the jsep to renegotiate.
                this.streamNotificationService.sendStreamRoomReofferSingleEvent(websocket, wsId, streamRoom, notification.jsep as WebRtcTypes.RTCSessionDescriptionOffer | undefined);
            }
            else {
                this.dispatchPublisherReady(janusSession, streamRoom);
            }
        }
        catch (error) {
            this.logger.error(error, "Error processing Janus notification");
        }
    }
    
    /**
     * A publisher's media is only subscribable once its PeerConnection is up (Janus `webrtcup`),
     * not when the offer was accepted — so streamPublished is emitted here, from the streams cached
     * at publish time, to avoid peers racing the publisher's ICE setup.
     */
    private dispatchPublisherReady(session: JanusSession, streamRoom: db.stream.StreamRoom): void {
        const publisher = session.publishedStreams[session.publishedStreams.length - 1];
        if (publisher && !session.publishedAnnounced) {
            session.publishedAnnounced = true;
            this.streamNotificationService.sendStreamPublishedEvent(streamRoom, {
                streamRoomId: streamRoom.id,
                stream: this.mapper.convertPublisherToPublisherAsStream(publisher),
                userId: session.userId,
            });
        }
    }
    
    /**
     * On a dropped/de-authorized client session there is no unpublish/leave/unsubscribe API call,
     * so synthesize the same broadcast events here: `streamUnpublished` for publishing sessions,
     * `streamUnsubscribed` for subscriber sessions (with the feeds they still held), then
     * `streamRoomLeft` (deduplicated per room+user).
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
            const subscriptions = sess.type === "subscriber" ? [...sess.subscriptions] : [];
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
                if (subscriptions.length > 0) {
                    this.streamNotificationService.sendStreamUnsubscribedEvent(streamRoom, { streamRoomId, userId, subscriptions });
                }
                if (emitLeft) {
                    this.streamNotificationService.sendStreamRoomLeftEvent(streamRoom, { streamRoomId, userId });
                }
            })();
        }
    }
}
