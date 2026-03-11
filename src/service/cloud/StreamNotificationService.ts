/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { JobService } from "../job/JobService";
import { WebSocketSender } from "../ws/WebSocketSender";
import { StreamConverter } from "../../api/main/stream/StreamConverter";
import * as streamApi from "../../api/main/stream/StreamApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import * as managementStreamApi from "../../api/plain/stream/ManagementStreamApiTypes";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { ManagementStreamConverter } from "../../api/plain/stream/ManagementStreamConverter";
import { WebSocketPlainSender } from "../ws/WebSocketPlainSender";
import { DateUtils } from "../../utils/DateUtils";
import { UserIdentityWithStatus } from "../../types/cloud";
import { TargetChannel } from "../ws/WebSocketConnectionManager";
import { WebSocketOutboundHandler } from "../ws/WebSocketOutboundHandler";
import { WebSocketExtendedWithJanus } from "../../CommonTypes";
import { AppException } from "../../api/AppException";
import { WebSocketInnerManager } from "../ws/WebSocketInnerManager";
import * as WebRtcTypes from "../webrtc/v2/WebRtcTypes";

export enum StreamRoomChannelType {
    CREATE = "streamroom/create",
    UPDATE = "streamroom/update",
    DELETE = "streamroom/delete",
    INTERNAL = "streamroom/internal",
}

export enum StreamRoomStreamChannelType {
    PUBLISH = "streamroom/streams/publish",
    UNPUBLISH = "streamroom/streams/unpublish",
    JOIN = "streamroom/streams/join",
    LEAVE = "streamroom/streams/leave",
    UPDATE = "streamroom/streams/update",
}
export class StreamNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private webSocketPlainSender: WebSocketPlainSender,
        private streamConverter: StreamConverter,
        private repositoryFactory: RepositoryFactory,
        private managementStreamConverter: ManagementStreamConverter,
        private webSocketOutboundHandler: WebSocketOutboundHandler,
        private webSocketInnerManager: WebSocketInnerManager,
    ) {
    }
    
    public convertJanusRoomIdToBridgeRoomId(mappedRoom: db.stream.StreamRoom, evt: any) {
        const convertedEvt = {...evt};
        if (convertedEvt.data && typeof(convertedEvt.data) === "object" && "room" in convertedEvt.data) {
            convertedEvt.data.room = mappedRoom.id;
        }
        else if (convertedEvt.data && typeof(convertedEvt.data) === "object" && "roomId" in convertedEvt.data) {
            convertedEvt.data.roomId = mappedRoom.id;
        }
        else if (convertedEvt.data && typeof(convertedEvt.data) === "object" && "plugindata" in convertedEvt.data && typeof(convertedEvt.data.plugindata) === "object" && "data" in convertedEvt.data.plugindata && "room" in convertedEvt.data.plugindata.data) {
            convertedEvt.data.plugindata.data.room = mappedRoom.id;
        }
        else {
            throw new Error("No conversion made on janus room -> stream room on event: " + JSON.stringify(evt, null, 2));
        }
        return convertedEvt;
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    sendStreamCustomEvent(streamRoom: db.stream.StreamRoom, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("streamCustomEvent", async () => {
            const now = DateUtils.now();
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, [...streamRoom.users, ...streamRoom.managers]);
            this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamRoomCustomEvent>(
                contextUsers.map(u => u.userPubKey),
                {
                    containerId: streamRoom.id,
                    contextId: streamRoom.contextId,
                    channel: `stream/custom/${customChannelName}` as types.core.WsChannelName,
                    containerType: streamRoom.type,
                },
                {
                    channel: `stream/${streamRoom.id}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: streamRoom.id,
                        author: author,
                        keyId: keyId,
                        eventData: eventData,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendStreamLeftEvent(streamRoom: db.stream.StreamRoom, notificationData: streamApi.StreamLeftEventData) {
        this.safe("streamLeftEvent", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().
                getUsers(streamRoom.contextId, streamRoom.users);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamLeftEvent>([user.userPubKey],
                {
                    containerId: streamRoom.id,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomStreamChannelType.LEAVE as types.core.WsChannelName,
                    containerType: streamRoom.type,
                },
                {
                    channel: "stream",
                    type: "streamLeft",
                    data: notificationData,
                    timestamp: now,
                });
            }
        });
    }
    
    sendStreamJoinedEvent(streamRoom: db.stream.StreamRoom, notificationData: streamApi.StreamJoinedEventData) {
        this.safe("streamJoinedEvent", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, streamRoom.users);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamJoinedEvent>([user.userPubKey],
                {
                    containerId: streamRoom.id,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomStreamChannelType.JOIN as types.core.WsChannelName,
                    containerType: streamRoom.type,
                },
                {
                    channel: "stream",
                    type: "streamJoined",
                    data: notificationData,
                    timestamp: now,
                });
            }
        });
    }
    
    sendStreamPublishedEvent(streamRoom: db.stream.StreamRoom, notificationData: streamApi.StreamPublishedEventData) {
        this.safe("streamPublishedEvent", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, streamRoom.users);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamPublishedEvent>([user.userPubKey],
                {
                    containerId: streamRoom.id,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomStreamChannelType.PUBLISH as types.core.WsChannelName,
                    containerType: streamRoom.type,
                },
                {
                    channel: "stream",
                    type: "streamPublished",
                    data: notificationData,
                    timestamp: now,
                });
            }
        });
    }
    
    sendStreamUpdatedEvent(streamRoom: db.stream.StreamRoom, notificationData: streamApi.StreamUpdatedEventData) {
        this.safe("streamUpdatedEvent", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, streamRoom.users);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamUpdatedEvent>([user.userPubKey],
                {
                    containerId: streamRoom.id,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomChannelType.UPDATE as types.core.WsChannelName,
                    containerType: streamRoom.type,
                },
                {
                    channel: "stream",
                    type: "streamUpdated",
                    data: notificationData,
                    timestamp: now,
                });
            }
        });
    }
    
    sendStreamUnpublishedEvent(streamRoom: db.stream.StreamRoom, notificationData: streamApi.StreamUnpublishedEventData) {
        this.safe("streamUnpublishedEvent", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, streamRoom.users);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamUnpublishedEvent>([user.userPubKey],
                {
                    containerId: streamRoom.id,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomStreamChannelType.UNPUBLISH as types.core.WsChannelName,
                    containerType: streamRoom.type,
                },
                {
                    channel: "stream",
                    type: "streamUnpublished",
                    data: notificationData,
                    timestamp: now,
                });
            }
        });
    }
    
    sendStreamRoomCreated(streamRoom: db.stream.StreamRoom, solution: types.cloud.SolutionId) {
        this.safe("streamRoomCreated", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, [...streamRoom.users, ...streamRoom.managers]);
            const notification: managementStreamApi.StreamRoomCreatedEvent = {
                channel: "stream",
                type: "streamRoomCreated",
                data: this.managementStreamConverter.convertStreamRoom(streamRoom),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamRoomCreatedEvent>(
                    [user.userPubKey],
                    {
                        containerId: streamRoom.id,
                        contextId: streamRoom.contextId,
                        channel: StreamRoomChannelType.CREATE as types.core.WsChannelName,
                        containerType: streamRoom.type,
                    },
                    {
                        channel: "stream",
                        type: "streamRoomCreated",
                        data: this.streamConverter.convertStreamRoom(user.userId, streamRoom),
                        timestamp: now,
                    },
                );
            }
        });
    }
    
    sendStreamRoomUpdated(streamRoom: db.stream.StreamRoom, solution: types.cloud.SolutionId, additionalUsers: UserIdentityWithStatus[]) {
        this.safe("streamRoomUpdated", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, [...streamRoom.users, ...streamRoom.managers]);
            const notification: managementStreamApi.StreamRoomUpdatedEvent = {
                channel: "stream",
                type: "streamRoomUpdated",
                data: this.managementStreamConverter.convertStreamRoom(streamRoom),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            const targetChannel: TargetChannel = {
                containerId: streamRoom.id,
                contextId: streamRoom.contextId,
                channel: StreamRoomChannelType.UPDATE as types.core.WsChannelName,
                containerType: streamRoom.type,
            };
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamRoomUpdatedEvent>(
                    [user.userPubKey],
                    targetChannel,
                    {
                        channel: "stream",
                        type: "streamRoomUpdated",
                        data: this.streamConverter.convertStreamRoom(user.userId, streamRoom),
                        timestamp: now,
                    },
                );
            }
            for (const user of additionalUsers) {
                const userNotification: streamApi.StreamRoomUpdatedEvent = {
                    channel: "stream",
                    type: "streamRoomUpdated",
                    data: this.streamConverter.convertStreamRoom(user.id, streamRoom),
                    timestamp: now,
                };
                if (user.status === "inactive") {
                    await this.repositoryFactory.createNotificationRepository().insert(user.pub, targetChannel, userNotification);
                }
                else {
                    this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamRoomUpdatedEvent>(
                        [user.pub],
                        targetChannel,
                        userNotification,
                    );
                }
            }
        });
    }
    
    sendStreamRoomDeleted(streamRoom: db.stream.StreamRoom, solution: types.cloud.SolutionId) {
        this.safe("streamRoomDeleted", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, [...streamRoom.users, ...streamRoom.managers]);
            const notification: managementStreamApi.StreamRoomDeletedEvent = {
                channel: "stream",
                type: "streamRoomDeleted",
                data: {
                    streamRoomId: streamRoom.id,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamRoomDeletedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: streamRoom.id,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomChannelType.DELETE as types.core.WsChannelName,
                    containerType: streamRoom.type,
                },
                {
                    channel: "stream",
                    type: "streamRoomDeleted",
                    data: {
                        streamRoomId: streamRoom.id,
                        type: streamRoom.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendNewStreamsSingleEvent(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId, streamRoom: db.stream.StreamRoom, data: WebRtcTypes.NewStreamsEventData) {
        const eventType = "remoteStreamsChanged";
        this.safe(`${eventType}Event`, async () => {
            const session = websocket.ex.sessions.find(x => x.wsId === wsId);
            if (session) {
                const targetChannel: TargetChannel = {
                    containerId: streamRoom.id,
                    containerType: streamRoom.type,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomChannelType.UPDATE as types.core.WsChannelName,
                };
                
                const {matchingSubscriptions} = this.webSocketInnerManager.getMatchingsubscriptionsAndOptions(targetChannel, session.channels);
                if (matchingSubscriptions.length === 0) {
                    return;
                }
                const convertedEvent = this.convertJanusRoomIdToBridgeRoomId(streamRoom, {
                    type: eventType,
                    data: data,
                    timestamp: DateUtils.now(),
                    subscriptions: matchingSubscriptions,
                    version: 2,
                });
                this.webSocketOutboundHandler.sendToWsSession(websocket, session, convertedEvent);
            }
            else {
                throw new AppException("FAILED_TO_SEND_MEDIA_EVENT", `${eventType}`);
            }
            
        });
        
    }
    
    sendSubscriberStreamsUpdatedSingleEvent(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId, streamRoom: db.stream.StreamRoom, data: WebRtcTypes.JanusRoomStreamsUpdatedData) {
        const eventType = "streamsUpdated";
        this.safe(`${eventType}Event`, async () => {
            const session = websocket.ex.sessions.find(x => x.wsId === wsId);
            if (session) {
                const targetChannel: TargetChannel = {
                    containerId: streamRoom.id,
                    containerType: streamRoom.type,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomChannelType.INTERNAL as types.core.WsChannelName,
                };
                
                const {matchingSubscriptions} = this.webSocketInnerManager.getMatchingsubscriptionsAndOptions(targetChannel, session.channels);
                if (matchingSubscriptions.length === 0) {
                    return;
                }
                const now = DateUtils.now();
                const convertedEvent = this.convertJanusRoomIdToBridgeRoomId(streamRoom, {
                    type: eventType,
                    data: data,
                    timestamp: now,
                    subscriptions: matchingSubscriptions,
                    version: 2,
                });
                
                this.webSocketOutboundHandler.sendToWsSession(websocket, session, convertedEvent);
            }
            else {
                throw new AppException("FAILED_TO_SEND_MEDIA_EVENT", `${eventType}`);
            }
            
        });
    }
    
    sendUnpublishedSingleEvent(websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId, streamRoom: db.stream.StreamRoom, leavingPublisher: WebRtcTypes.StreamId) {
        const eventType = "streamUnpublished";
        this.safe(`${eventType}Event`, async () => {
            const session = websocket.ex.sessions.find(x => x.wsId === wsId);
            if (session) {
                const targetChannel: TargetChannel = {
                    containerId: streamRoom.id,
                    containerType: streamRoom.type,
                    contextId: streamRoom.contextId,
                    channel: StreamRoomStreamChannelType.UNPUBLISH as types.core.WsChannelName,
                };
                
                const {matchingSubscriptions} = this.webSocketInnerManager.getMatchingsubscriptionsAndOptions(targetChannel, session.channels);
                if (matchingSubscriptions.length === 0) {
                    return;
                }
                const convertedEvent = {
                    type: eventType,
                    data: {streamRoomId: streamRoom.id, streamId: leavingPublisher},
                    timestamp: DateUtils.now(),
                    subscriptions: matchingSubscriptions,
                    version: 2,
                };
                
                this.webSocketOutboundHandler.sendToWsSession(websocket, session, convertedEvent);
            }
            else {
                throw new AppException("FAILED_TO_SEND_MEDIA_EVENT", `${eventType}`);
            }
            
        });
        
    }
}
