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
import { InboxConverter } from "../../api/main/inbox/InboxConverter";
import * as inboxApi from "../../api/main/inbox/InboxApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import * as managementInboxApi from "../../api/plain/inbox/ManagementInboxApiTypes";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { ManagementInboxConverter } from "../../api/plain/inbox/ManagementInboxConverter";
import { WebSocketPlainSender } from "../ws/WebSocketPlainSender";
import { DateUtils } from "../../utils/DateUtils";
import { TargetChannel } from "../ws/WebSocketConnectionManager";
import { UserIdentityWithStatus } from "../../types/cloud";
import { Utils } from "../../utils/Utils";

/**
 * Payloads are converted once per recipient, so each carries `groupKeys` narrowed to that recipient's own
 * groups and the `staleGroups` a `inboxGet` would serve — see `getInboxRecipients`.
 */
export class InboxNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private webSocketPlainSender: WebSocketPlainSender,
        private inboxConverter: InboxConverter,
        private repositoryFactory: RepositoryFactory,
        private managementInboxConverter: ManagementInboxConverter,
    ) {
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    /** Direct members plus the expanded members of any granted groups, each recipient's own grants, and those
     *  groups' current epochs — all out of the single lookup the expansion already does. */
    private async getInboxRecipients(inbox: db.inbox.Inbox): Promise<{userIds: types.cloud.UserId[], groupsByUser: Map<types.cloud.UserId, types.group.GroupId[]>, groupEpochs: Map<types.group.GroupId, number>}> {
        const groupIds = (inbox.groups || []).map(g => g.groupId);
        const {groupsByUser, groupEpochs} = await this.repositoryFactory.createGroupRepository().getGranteeView(groupIds);
        return {
            userIds: Utils.unique([...inbox.users, ...inbox.managers, ...groupsByUser.keys()]),
            groupsByUser: groupsByUser,
            groupEpochs: groupEpochs,
        };
    }
    
    sendInboxCustomEvent(inbox: db.inbox.Inbox, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("inboxCustomEvent", async () => {
            const now = DateUtils.now();
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, (await this.getInboxRecipients(inbox)).userIds);
            this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxCustomEvent>(
                contextUsers.map(u => u.userPubKey),
                {
                    containerId: inbox.id,
                    contextId: inbox.contextId,
                    channel: `inbox/custom/${customChannelName}` as types.core.WsChannelName,
                },
                {
                    channel: `inbox/${inbox.id}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: inbox.id,
                        author: author,
                        keyId: keyId,
                        eventData: eventData,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendInboxCreated(inbox: db.inbox.Inbox, solution: types.cloud.SolutionId) {
        this.safe("inboxCreated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser, groupEpochs} = await this.getInboxRecipients(inbox);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, userIds);
            const notification: managementInboxApi.InboxCreatedEvent = {
                channel: "inbox",
                type: "inboxCreated",
                data: this.managementInboxConverter.convertInbox(inbox),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxCreatedEvent>(
                    [user.userPubKey],
                    {
                        containerId: inbox.id,
                        contextId: inbox.contextId,
                        channel: "inbox/create" as types.core.WsChannelName,
                    },
                    {
                        channel: "inbox",
                        type: "inboxCreated",
                        data: this.inboxConverter.convertInbox(user.userId, inbox, groupsByUser.get(user.userId) ?? [], groupEpochs),
                        timestamp: now,
                    },
                );
            }
        });
    }
    
    sendInboxUpdated(inbox: db.inbox.Inbox, solution: types.cloud.SolutionId, additionalUsers: UserIdentityWithStatus[]) {
        this.safe("inboxUpdated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser, groupEpochs} = await this.getInboxRecipients(inbox);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, userIds);
            const notification: managementInboxApi.InboxUpdatedEvent = {
                channel: "inbox",
                type: "inboxUpdated",
                data: this.managementInboxConverter.convertInbox(inbox),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            const targetChannel: TargetChannel = {
                containerId: inbox.id,
                contextId: inbox.contextId,
                channel: "inbox/update" as types.core.WsChannelName,
            };
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxUpdatedEvent>(
                    [user.userPubKey],
                    targetChannel,
                    {
                        channel: "inbox",
                        type: "inboxUpdated",
                        data: this.inboxConverter.convertInbox(user.userId, inbox, groupsByUser.get(user.userId) ?? [], groupEpochs),
                        timestamp: now,
                    },
                );
            }
            for (const user of additionalUsers) {
                const userNotification: inboxApi.InboxUpdatedEvent = {
                    channel: "inbox",
                    type: "inboxUpdated",
                    // These are the users this update removed, so they hold no grant on the inbox any
                    // more and `groupsByUser` (built from its current grants) has nothing for them. `[]`
                    // is the answer.
                    data: this.inboxConverter.convertInbox(user.id, inbox, groupsByUser.get(user.id) ?? [], groupEpochs),
                    timestamp: now,
                };
                if (user.status === "inactive") {
                    await this.repositoryFactory.createNotificationRepository().insert(user.pub, targetChannel, userNotification);
                }
                else {
                    this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxUpdatedEvent>(
                        [user.pub],
                        targetChannel,
                        userNotification,
                    );
                }
            }
        });
    }
    
    sendInboxDeleted(inbox: db.inbox.Inbox, solution: types.cloud.SolutionId) {
        this.safe("inboxDeleted", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, (await this.getInboxRecipients(inbox)).userIds);
            const notification: managementInboxApi.InboxDeletedEvent = {
                channel: "inbox",
                type: "inboxDeleted",
                data: {
                    inboxId: inbox.id,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxDeletedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: inbox.id,
                    contextId: inbox.contextId,
                    channel: "inbox/delete" as types.core.WsChannelName,
                },
                {
                    channel: "inbox",
                    type: "inboxDeleted",
                    data: {
                        inboxId: inbox.id,
                        type: inbox.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
}
