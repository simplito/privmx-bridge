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
import { DateUtils } from "../../utils/DateUtils";
import { TargetChannel } from "../ws/WebSocketConnectionManager";
import { Utils } from "../../utils/Utils";

/**
 * Every payload here is converted **once per recipient**, so each one carries a `ThreadInfo.groupKeys` narrowed
 * to that recipient's own groups — the same guarantee `threadGet` gives.
 *
 * It costs nothing extra. Expanding group grantees into a recipient list already reads the whole group
 * documents, so `getMemberGroupsMap` hands back each recipient's grants out of that one query instead of
 * discarding them. Serving an unnarrowed list here would be the anomaly: a client would have no way to tell a
 * payload it may trust from one it may not.
 */
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
    
    /**
     * Direct members plus the expanded members of any granted groups (Phase 2 grantee notifications), along with
     * each recipient's own grants on this thread — both from the single group lookup the expansion already does,
     * so a per-recipient payload can be narrowed for free. Direct members in no granted group map to `[]`.
     */
    private async getThreadRecipients(thread: db.thread.Thread): Promise<{userIds: types.cloud.UserId[], groupsByUser: Map<types.cloud.UserId, types.group.GroupId[]>}> {
        const groupIds = (thread.groups || []).map(g => g.groupId);
        const groupsByUser = await this.repositoryFactory.createGroupRepository().getMemberGroupsMap(groupIds);
        return {
            userIds: Utils.unique([...thread.users, ...thread.managers, ...groupsByUser.keys()]),
            groupsByUser: groupsByUser,
        };
    }
    
    sendThreadCustomEvent(thread: db.thread.Thread, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("threadCustomEvent", async () => {
            const now = DateUtils.now();
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, (await this.getThreadRecipients(thread)).userIds);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadCustomEvent>(
                contextUsers.map(u => u.userPubKey),
                {
                    contextId: thread.contextId,
                    containerId: thread.id,
                    channel: `thread/custom/${customChannelName}` as types.core.WsChannelName,
                    containerType: thread.type,
                },
                {
                    channel: `thread/${thread.id}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: thread.id,
                        author: author,
                        keyId: keyId,
                        eventData: eventData,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendCreatedThread(thread: db.thread.Thread, solution: types.cloud.SolutionId) {
        this.safe("threadCreated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser} = await this.getThreadRecipients(thread);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, userIds);
            const notification: managementThreadApi.ThreadCreatedEvent = {
                channel: "thread",
                type: "threadCreated",
                data: this.managementThreadConverter.convertThread(thread),
                timestamp: now,
                
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadCreatedEvent>(
                    [user.userPubKey],
                    {
                        contextId: thread.contextId,
                        containerId: thread.id,
                        channel: "thread/create" as types.core.WsChannelName,
                        containerType: thread.type,
                    },
                    {
                        channel: "thread",
                        type: "threadCreated",
                        data: this.threadConverter.convertThread(user.userId, thread, groupsByUser.get(user.userId) ?? []),
                        timestamp: now,
                    },
                );
            }
        });
    }
    
    sendUpdatedThread(thread: db.thread.Thread, solution: types.cloud.SolutionId, additionalUsers: types.cloud.UserIdentityWithStatus[]) {
        this.safe("threadUpdated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser} = await this.getThreadRecipients(thread);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, userIds);
            const notification: managementThreadApi.ThreadUpdatedEvent = {
                channel: "thread",
                type: "threadUpdated",
                data: this.managementThreadConverter.convertThread(thread),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            const targetChannel: TargetChannel = {
                contextId: thread.contextId,
                containerId: thread.id,
                channel: "thread/update" as types.core.WsChannelName,
                containerType: thread.type,
            };
            for (const user of contextUsers) {
                const userNotification: threadApi.ThreadUpdatedEvent = {
                    channel: "thread",
                    type: "threadUpdated",
                    data: this.threadConverter.convertThread(user.userId, thread, groupsByUser.get(user.userId) ?? []),
                    timestamp: now,
                };
                this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadUpdatedEvent>(
                    [user.userPubKey],
                    targetChannel,
                    userNotification,
                );
            }
            for (const user of additionalUsers) {
                const userNotification: threadApi.ThreadUpdatedEvent = {
                    channel: "thread",
                    type: "threadUpdated",
                    // These are the users this update removed, so they hold no grant on the thread any more and
                    // `groupsByUser` (built from its current grants) has nothing for them. `[]` is the answer.
                    data: this.threadConverter.convertThread(user.id, thread, groupsByUser.get(user.id) ?? []),
                    timestamp: now,
                };
                if (user.status === "inactive") {
                    await this.repositoryFactory.createNotificationRepository().insert(user.pub, targetChannel, userNotification);
                }
                else {
                    this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadUpdatedEvent>(
                        [user.pub],
                        targetChannel,
                        userNotification,
                    );
                }
            }
        });
    }
    
    sendThreadStats(thread: db.thread.Thread, solution: types.cloud.SolutionId) {
        this.safe("threadStats", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, (await this.getThreadRecipients(thread)).userIds);
            const notification: managementThreadApi.ThreadStatsEvent = {
                channel: "thread",
                type: "threadStats",
                data: {
                    threadId: thread.id,
                    lastMsgDate: thread.lastMsgDate,
                    messages: thread.messages,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadStatsEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: thread.contextId,
                    containerId: thread.id,
                    channel: "thread/stats" as types.core.WsChannelName,
                    containerType: thread.type,
                },
                {
                    channel: "thread",
                    type: "threadStats",
                    data: {
                        threadId: thread.id,
                        contextId: thread.contextId,
                        type: thread.type,
                        lastMsgDate: thread.lastMsgDate,
                        messages: thread.messages,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendDeletedThread(thread: db.thread.Thread, solution: types.cloud.SolutionId) {
        this.safe("threadDeleted", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, (await this.getThreadRecipients(thread)).userIds);
            const notification: managementThreadApi.ThreadDeletedEvent = {
                channel: "thread",
                type: "threadDeleted",
                data: {
                    threadId: thread.id,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadDeletedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: thread.contextId,
                    containerId: thread.id,
                    channel: "thread/delete" as types.core.WsChannelName,
                    containerType: thread.type,
                },
                {
                    channel: "thread",
                    type: "threadDeleted",
                    data: {
                        threadId: thread.id,
                        type: thread.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendNewThreadMessage(thread: db.thread.Thread, msg: db.thread.ThreadMessage, solution: types.cloud.SolutionId) {
        this.safe("threadNewMessage", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, (await this.getThreadRecipients(thread)).userIds);
            const notification: managementThreadApi.ThreadNewMessageEvent = {
                channel: "thread",
                type: "threadNewMessage",
                data: this.managementThreadConverter.convertThreadMessage(thread, msg),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadNewMessageEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: thread.contextId,
                    containerId: thread.id,
                    itemId: msg.id,
                    channel: "thread/messages/create" as types.core.WsChannelName,
                    containerType: thread.type,
                },
                {
                    channel: `thread/${thread.id}/messages`,
                    type: "threadNewMessage",
                    data: {...this.threadConverter.convertMessage(thread, msg), containerType: thread.type},
                    timestamp: now,
                },
            );
        });
    }
    
    sendUpdatedThreadMessage(thread: db.thread.Thread, msg: db.thread.ThreadMessage, solution: types.cloud.SolutionId) {
        this.safe("threadUpdatedMessage", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, (await this.getThreadRecipients(thread)).userIds);
            const notification: managementThreadApi.ThreadUpdatedMessageEvent = {
                channel: "thread",
                type: "threadUpdatedMessage",
                data: this.managementThreadConverter.convertThreadMessage(thread, msg),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadUpdatedMessageEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: thread.contextId,
                    containerId: thread.id,
                    itemId: msg.id,
                    channel: "thread/messages/update" as types.core.WsChannelName,
                    containerType: thread.type,
                },
                {
                    channel: `thread/${thread.id}/messages`,
                    type: "threadUpdatedMessage",
                    data: {...this.threadConverter.convertMessage(thread, msg), containerType: thread.type},
                    timestamp: now,
                },
            );
        });
    }
    
    sendDeletedThreadMessage(thread: db.thread.Thread, msg: db.thread.ThreadMessage, solution: types.cloud.SolutionId) {
        this.safe("threadDeletedMessage", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(thread.contextId, (await this.getThreadRecipients(thread)).userIds);
            const notification: managementThreadApi.ThreadDeletedMessageEvent = {
                channel: "thread",
                type: "threadDeletedMessage",
                data: {
                    messageId: msg.id,
                    threadId: thread.id,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<threadApi.ThreadDeletedMessageEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: thread.contextId,
                    containerId: thread.id,
                    itemId: msg.id,
                    channel: "thread/messages/delete" as types.core.WsChannelName,
                    containerType: thread.type,
                },
                {
                    channel: `thread/${thread.id}/messages`,
                    type: "threadDeletedMessage",
                    data: {
                        messageId: msg.id,
                        threadId: thread.id,
                        containerType: thread.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
}
