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
export class StreamNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private webSocketPlainSender: WebSocketPlainSender,
        private streamConverter: StreamConverter,
        private repositoryFactory: RepositoryFactory,
        private managementStreamConverter: ManagementStreamConverter,
    ) {
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    sendStreamCustomEvent(streamRoom: db.stream.StreamRoom, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("streamCustomEvent", async () => {
            const now = DateUtils.now();
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(streamRoom.contextId, [...streamRoom.users, ...streamRoom.managers]);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<streamApi.StreamRoomCustomEvent>(
                    [user.userPubKey],
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
                        channel: "stream/create" as types.core.WsChannelName,
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
                channel: "stream/update" as types.core.WsChannelName,
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
                    channel: "stream/delete" as types.core.WsChannelName,
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
}
