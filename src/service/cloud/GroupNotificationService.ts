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
import { GroupConverter } from "../../api/main/context/GroupConverter";
import * as contextApi from "../../api/main/context/ContextApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { DateUtils } from "../../utils/DateUtils";

export class GroupNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private groupConverter: GroupConverter,
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    /**
     * Read here rather than threaded in from the write path: these run in a background job after the transaction
     * commits. That the payload carries the whole tree and history at all is what `BR-03` removes.
     */
    private async getState(group: db.group.Group) {
        return this.repositoryFactory.createGroupRepository().getFullState(group);
    }
    
    sendCreatedGroup(group: db.group.Group, _solution: types.cloud.SolutionId) {
        this.safe("groupCreated", async () => {
            const now = DateUtils.now();
            const state = await this.getState(group);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(group.contextId, [...group.users, ...group.managers]);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<contextApi.GroupCreatedEvent>(
                    [user.userPubKey],
                    {
                        contextId: group.contextId,
                        channel: "context/groups/create" as types.core.WsChannelName,
                    },
                    {
                        channel: "context",
                        type: "groupCreated",
                        data: this.groupConverter.convertGroup(user.userId, group, state),
                        timestamp: now,
                    },
                );
            }
        });
    }
    
    sendUpdatedGroup(group: db.group.Group, _solution: types.cloud.SolutionId, additionalUsers: types.cloud.UserIdentityWithStatus[]) {
        this.safe("groupUpdated", async () => {
            const now = DateUtils.now();
            const state = await this.getState(group);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(group.contextId, [...group.users, ...group.managers]);
            const targetChannel = {
                contextId: group.contextId,
                channel: "context/groups/update" as types.core.WsChannelName,
            };
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<contextApi.GroupUpdatedEvent>(
                    [user.userPubKey],
                    targetChannel,
                    {
                        channel: "context",
                        type: "groupUpdated",
                        data: this.groupConverter.convertGroup(user.userId, group, state),
                        timestamp: now,
                    },
                );
            }
            for (const user of additionalUsers) {
                const notification: contextApi.GroupUpdatedEvent = {
                    channel: "context",
                    type: "groupUpdated",
                    data: this.groupConverter.convertGroup(user.id, group, state),
                    timestamp: now,
                };
                if (user.status === "inactive") {
                    await this.repositoryFactory.createNotificationRepository().insert(user.pub, targetChannel, notification);
                }
                else {
                    this.webSocketSender.sendCloudEventAtChannel<contextApi.GroupUpdatedEvent>([user.pub], targetChannel, notification);
                }
            }
        });
    }
    
    sendDeletedGroup(group: db.group.Group, _solution: types.cloud.SolutionId) {
        this.safe("groupDeleted", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(group.contextId, [...group.users, ...group.managers]);
            this.webSocketSender.sendCloudEventAtChannel<contextApi.GroupDeletedEvent>(
                contextUsers.map(u => u.userPubKey),
                {
                    contextId: group.contextId,
                    channel: "context/groups/delete" as types.core.WsChannelName,
                },
                {
                    channel: "context",
                    type: "groupDeleted",
                    data: {
                        groupId: group.id,
                        contextId: group.contextId,
                    },
                    timestamp: now,
                },
            );
        });
    }
}
