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
    
    sendInboxCustomEvent(inbox: db.inbox.Inbox, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("inboxCustomEvent", async () => {
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, inbox.users);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxCustomEvent>([user.userPubKey], {
                    channel: `inbox/${inbox.id}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: inbox.id,
                        author: author,
                        keyId: keyId,
                        eventData: eventData,
                    },
                });
            }
        });
    }
    
    sendInboxCreated(inbox: db.inbox.Inbox, solution: types.cloud.SolutionId) {
        this.safe("inboxCreated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, inbox.users);
            const notification: managementInboxApi.InboxCreatedEvent = {
                channel: "inbox",
                type: "inboxCreated",
                data: this.managementInboxConverter.convertInbox(inbox),
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxCreatedEvent>([user.userPubKey], {
                    channel: "inbox",
                    type: "inboxCreated",
                    data: this.inboxConverter.convertInbox(user.userId, inbox),
                });
            }
        });
    }
    
    sendInboxUpdated(inbox: db.inbox.Inbox, solution: types.cloud.SolutionId) {
        this.safe("inboxUpdated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, inbox.users);
            const notification: managementInboxApi.InboxUpdatedEvent = {
                channel: "inbox",
                type: "inboxUpdated",
                data: this.managementInboxConverter.convertInbox(inbox),
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxUpdatedEvent>([user.userPubKey], {
                    channel: "inbox",
                    type: "inboxUpdated",
                    data: this.inboxConverter.convertInbox(user.userId, inbox),
                });
            }
        });
    }
    
    sendInboxDeleted(inbox: db.inbox.Inbox, solution: types.cloud.SolutionId) {
        this.safe("inboxDeleted", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(inbox.contextId, inbox.users);
            const notification: managementInboxApi.InboxDeletedEvent = {
                channel: "inbox",
                type: "inboxDeleted",
                data: {
                    inboxId: inbox.id,
                },
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<inboxApi.InboxDeletedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: "inbox",
                type: "inboxDeleted",
                data: {
                    inboxId: inbox.id,
                    type: inbox.type,
                },
            });
        });
    }
}
