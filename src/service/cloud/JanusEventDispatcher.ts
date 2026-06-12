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
import { JanusRoomsWatcher } from "./JanusRoomsWatcher";

const JanusEvents = {
    UPDATED: "updated",
    WEBRTCUP: "webrtcup",
} as const;

export class JanusEventDispatcher {
    
    private logger: Logger;
    
    constructor(
        loggerFactory: LoggerFactory,
        private repositoryFactory: RepositoryFactory,
        private streamNotificationService: StreamNotificationService,
        private parser: JanusNotificationParser,
        private mapper: JanusVideoRoomMapper,
        private janusRoomsWatcher: JanusRoomsWatcher,
        private host: types.core.Host,
    ) {
        this.logger = loggerFactory.createLogger(JanusEventDispatcher);
    }
    
    async handleJanusNotification(notification: any, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId): Promise<void> {
        if (!websocket.ex.janus || !websocket.ex.janus[wsId]) {
            return;
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
    
    private dispatchPublisherReady(session: JanusSession, streamRoom: db.stream.StreamRoom): void {
        const publisher = session.publishedStreams[session.publishedStreams.length - 1];
        if (publisher && !session.streamPublishedEventEmitted) {
            session.streamPublishedEventEmitted = true;
            this.streamNotificationService.sendStreamPublishedEvent(streamRoom, {
                streamRoomId: streamRoom.id,
                stream: this.mapper.convertPublisherToPublisherAsStream(publisher),
                userId: session.userId,
            });
        }
    }
    
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
                if (emitLeft) {
                    await this.janusRoomsWatcher.removeSubscriber(this.host, streamRoomId, userId).catch(e =>
                        this.logger.error({ streamRoomId, userId, error: e }, "Failed to remove subscriber from cache on disconnect"));
                }
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
