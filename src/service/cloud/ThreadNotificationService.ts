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
import { ThreadConverter } from "../../api/main/thread/ThreadConverter";
import * as threadApi from "../../api/main/thread/ThreadApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import * as managementThreadApi from "../../api/plain/thread/ManagementThreadApiTypes";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { ManagementThreadConverter } from "../../api/plain/thread/ManagementThreadConverter";
import { WebSocketPlainSender } from "../ws/WebSocketPlainSender";

export class ThreadNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private webSocketPlainSender: WebSocketPlainSender,
        private threadConverter: ThreadConverter,
        private repositoryFactory: RepositoryFactory,
        private managementThreadConverter: ManagementThreadConverter,
    ) {
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    sendThreadCustomEvent(thread: db.thread.Thread, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("threadCustomEvent", async () => {
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadCustomEvent>([user.userPubKey], {
                    channel: `thread/${thread.id}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: thread.id,
                        author: author,
                        keyId: keyId,
                        eventData: eventData,
                    },
                });
            }
        });
    }
    
    sendCreatedThread(thread: db.thread.Thread, solution: types.cloud.SolutionId) {
        this.safe("threadCreated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            const notification: managementThreadApi.ThreadCreatedEvent = {
                channel: "thread",
                type: "threadCreated",
                data: this.managementThreadConverter.convertThread(thread),
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadCreatedEvent>([user.userPubKey], {
                    channel: "thread",
                    type: "threadCreated",
                    data: this.threadConverter.convertThread(user.userId, thread),
                });
                this.webSocketSender.sendCloudEventAtChannel<threadApi.Thread2CreatedEvent>([user.userPubKey], {
                    channel: "thread2",
                    type: "thread2Created",
                    data: this.threadConverter.convertThread(user.userId, thread),
                });
            }
        });
    }
    
    sendUpdatedThread(thread: db.thread.Thread, solution: types.cloud.SolutionId) {
        this.safe("threadUpdated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            const notification: managementThreadApi.ThreadUpdatedEvent = {
                channel: "thread",
                type: "threadUpdated",
                data: this.managementThreadConverter.convertThread(thread),
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadUpdatedEvent>([user.userPubKey], {
                    channel: "thread",
                    type: "threadUpdated",
                    data: this.threadConverter.convertThread(user.userId, thread),
                });
                this.webSocketSender.sendCloudEventAtChannel<threadApi.Thread2UpdatedEvent>([user.userPubKey], {
                    channel: "thread2",
                    type: "thread2Updated",
                    data: this.threadConverter.convertThread(user.userId, thread),
                });
            }
        });
    }
    
    sendThreadStats(thread: db.thread.Thread, solution: types.cloud.SolutionId) {
        this.safe("threadStats", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            const notification: managementThreadApi.ThreadStatsEvent = {
                channel: "thread",
                type: "threadStats",
                data: {
                    threadId: thread.id,
                    lastMsgDate: thread.lastMsgDate,
                    messages: thread.messages,
                },
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadStatsEvent>(contextUsers.map(x => x.userPubKey), {
                channel: "thread",
                type: "threadStats",
                data: {
                    threadId: thread.id,
                    contextId: thread.contextId,
                    type: thread.type,
                    lastMsgDate: thread.lastMsgDate,
                    messages: thread.messages,
                },
            });
            this.webSocketSender.sendCloudEventAtChannel<threadApi.Thread2StatsEvent>(contextUsers.map(x => x.userPubKey), {
                channel: "thread2",
                type: "thread2Stats",
                data: {
                    threadId: thread.id,
                    contextId: thread.contextId,
                    type: thread.type,
                    lastMsgDate: thread.lastMsgDate,
                    messages: thread.messages,
                },
            });
        });
    }
    
    sendDeletedThread(thread: db.thread.Thread, solution: types.cloud.SolutionId) {
        this.safe("threadDeleted", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            const notification: managementThreadApi.ThreadDeletedEvent = {
                channel: "thread",
                type: "threadDeleted",
                data: {
                    threadId: thread.id,
                },
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadDeletedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: "thread",
                type: "threadDeleted",
                data: {
                    threadId: thread.id,
                    type: thread.type,
                },
            });
            this.webSocketSender.sendCloudEventAtChannel<threadApi.Thread2DeletedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: "thread2",
                type: "thread2Deleted",
                data: {
                    threadId: thread.id,
                    type: thread.type,
                },
            });
        });
    }
    
    sendNewThreadMessage(thread: db.thread.Thread, msg: db.thread.ThreadMessage, solution: types.cloud.SolutionId) {
        this.safe("threadNewMessage", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            const notification: managementThreadApi.ThreadNewMessageEvent = {
                channel: "thread",
                type: "threadNewMessage",
                data: this.managementThreadConverter.convertThreadMessage(thread, msg),
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadNewMessageEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `thread/${thread.id}/messages`,
                type: "threadNewMessage",
                data: this.threadConverter.convertMessage(thread, msg),
            });
            this.webSocketSender.sendCloudEventAtChannel<threadApi.Thread2NewMessageEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `thread2/${thread.id}/messages`,
                type: "thread2NewMessage",
                data: this.threadConverter.convertMessage(thread, msg),
            });
        });
    }
    
    sendUpdatedThreadMessage(thread: db.thread.Thread, msg: db.thread.ThreadMessage, solution: types.cloud.SolutionId) {
        this.safe("threadUpdatedMessage", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            const notification: managementThreadApi.ThreadUpdatedMessageEvent = {
                channel: "thread",
                type: "threadUpdatedMessage",
                data: this.managementThreadConverter.convertThreadMessage(thread, msg),
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadUpdatedMessageEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `thread/${thread.id}/messages`,
                type: "threadUpdatedMessage",
                data: this.threadConverter.convertMessage(thread, msg),
            });
            this.webSocketSender.sendCloudEventAtChannel<threadApi.Thread2UpdatedMessageEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `thread2/${thread.id}/messages`,
                type: "thread2UpdatedMessage",
                data: this.threadConverter.convertMessage(thread, msg),
            });
        });
    }
    
    sendDeletedThreadMessage(thread: db.thread.Thread, msg: db.thread.ThreadMessage, solution: types.cloud.SolutionId) {
        this.safe("threadDeletedMessage", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, thread.users);
            const notification: managementThreadApi.ThreadDeletedMessageEvent = {
                channel: "thread",
                type: "threadDeletedMessage",
                data: {
                    messageId: msg.id,
                    threadId: thread.id,
                },
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadDeletedMessageEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `thread/${thread.id}/messages`,
                type: "threadDeletedMessage",
                data: {
                    messageId: msg.id,
                    threadId: thread.id,
                },
            });
            this.webSocketSender.sendCloudEventAtChannel<threadApi.Thread2DeletedMessageEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `thread2/${thread.id}/messages`,
                type: "thread2DeletedMessage",
                data: {
                    messageId: msg.id,
                    threadId: thread.id,
                },
            });
        });
    }
}
