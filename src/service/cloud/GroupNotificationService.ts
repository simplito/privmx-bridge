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
import * as contextApi from "../../api/main/context/ContextApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { DateUtils } from "../../utils/DateUtils";

/**
 * Group events, which say *what* changed and never *how the group now looks*.
 *
 * The payload is built once and sent to every recipient, so its size and the work of building it do not depend on
 * how many members the group has. It used to be converted per recipient and carry the whole state: a group of a
 * thousand meant a thousand copies of the tree and the history over the socket for a single membership change.
 * Whoever needs the state calls `groupGet`.
 */
export class GroupNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    sendCreatedGroup(group: db.group.Group, _solution: types.cloud.SolutionId) {
        this.safe("groupCreated", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(group.contextId, [...group.users, ...group.managers]);
            this.webSocketSender.sendCloudEventAtChannel<contextApi.GroupCreatedEvent>(
                contextUsers.map(user => user.userPubKey),
                {
                    contextId: group.contextId,
                    // Without containerId a subscription scoped to one group matches every group in the context:
                    // the matcher skips the selector check when the target carries none (BR-37).
                    containerId: group.id,
                    channel: "context/groups/create" as types.core.WsChannelName,
                },
                {
                    channel: "context",
                    type: "groupCreated",
                    data: this.changedData(group, "created"),
                    timestamp: now,
                },
            );
        });
    }
    
    /**
     * @param additionalUsers recipients who are no longer members — a removed member is told so their client can
     *        stop trying to climb. Inactive ones get the event stored instead of sent.
     */
    sendUpdatedGroup(
        group: db.group.Group,
        _solution: types.cloud.SolutionId,
        additionalUsers: types.cloud.UserIdentityWithStatus[],
        changeKind: contextApi.GroupChangeKind,
    ) {
        this.safe("groupUpdated", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(group.contextId, [...group.users, ...group.managers]);
            const targetChannel = {
                contextId: group.contextId,
                containerId: group.id,
                channel: "context/groups/update" as types.core.WsChannelName,
            };
            const notification: contextApi.GroupUpdatedEvent = {
                channel: "context",
                type: "groupUpdated",
                data: this.changedData(group, changeKind),
                timestamp: now,
            };
            this.webSocketSender.sendCloudEventAtChannel<contextApi.GroupUpdatedEvent>(
                contextUsers.map(user => user.userPubKey),
                targetChannel,
                notification,
            );
            const activeAdditional = additionalUsers.filter(user => user.status !== "inactive");
            if (activeAdditional.length > 0) {
                this.webSocketSender.sendCloudEventAtChannel<contextApi.GroupUpdatedEvent>(
                    activeAdditional.map(user => user.pub),
                    targetChannel,
                    notification,
                );
            }
            for (const user of additionalUsers.filter(u => u.status === "inactive")) {
                await this.repositoryFactory.createNotificationRepository().insert(user.pub, targetChannel, notification);
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
                    containerId: group.id,
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
    
    private changedData(group: db.group.Group, changeKind: contextApi.GroupChangeKind): contextApi.GroupChangedEventData {
        return {
            groupId: group.id,
            contextId: group.contextId,
            version: group.version,
            keyVersion: group.keyVersion ?? 0,
            changeKind: changeKind,
        };
    }
}
