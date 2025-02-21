/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import * as types from "../../types";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { CloudUser, Executor } from "../../CommonTypes";
import { CloudKeyService } from "./CloudKeyService";
import { ThreadNotificationService } from "./ThreadNotificationService";
import { CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { BasePolicy } from "./BasePolicy";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbInconsistencyError } from "../../error/DbInconsistencyError";

export class ThreadService {
    
    private policy: ThreadPolicy;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private cloudKeyService: CloudKeyService,
        private threadNotificationService: ThreadNotificationService,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
    ) {
        this.policy = new ThreadPolicy(this.policyService);
    }
    
    async getThread(executor: Executor, threadId: types.thread.ThreadId, type: types.thread.ThreadType|undefined) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread || (type && thread.type !== type)) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, thread.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadGet", ["threadId=" + threadId]);
            if (!this.policy.canReadContainer(user, context, thread)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        return thread;
    }
    
    async getMyThreads(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.thread.ThreadType|undefined, listParams: types.core.ListModel, sortBy: keyof db.thread.Thread) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "thread/threadList", []);
        if (!this.policy.canListMyContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const threads = await this.repositoryFactory.createThreadRepository().getPageByContextAndUser(contextId, type, user.userId, cloudUser.solutionId, listParams, sortBy);
        return {user, threads};
    }
    
    async getAllThreads(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.thread.ThreadType|undefined, listParams: types.core.ListModel, sortBy: keyof db.thread.Thread) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "thread/threadListAll", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const threads = await this.repositoryFactory.createThreadRepository().getAllThreads(contextId, type, listParams, sortBy);
        return {user, threads};
    }
    
    async getThreadsByContext(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel2<types.thread.ThreadId>) {
        const ctx = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!ctx) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, ctx, (user, context) => {
            if (!this.policy.canListAllContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadList", []);
        });
        const threads = await this.repositoryFactory.createThreadRepository().getPage(contextId, listParams);
        return threads;
    }
    
    async getThreadMessage(executor: Executor, messageId: types.thread.ThreadMessageId) {
        const message = await this.repositoryFactory.createThreadMessageRepository().get(messageId);
        if (!message) {
            throw new AppException("THREAD_MESSAGE_DOES_NOT_EXIST");
        }
        const thread = await this.repositoryFactory.createThreadRepository().get(message.threadId);
        if (!thread) {
            throw new DbInconsistencyError(`thread=${message.threadId} does not exist, from message=${messageId}`);
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, thread.contextId, (user, context) => {
            if (!this.policy.canReadItem(user, context, thread, message)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessageGet", ["threadId=" + thread.id, "messageId=" + messageId]);
        });
        return {thread, message};
    }
    
    async getThreadMessages(executor: Executor, threadId: types.thread.ThreadId, listParams: types.core.ListModel) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, thread.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, thread)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessagesGet", ["threadId=" + thread.id]);
        });
        const messages = await this.repositoryFactory.createThreadMessageRepository().getPageByThread(threadId, listParams);
        return {thread, messages};
    }
    
    async getThreadMyMessages(executor: CloudUser, threadId: types.thread.ThreadId, listParams: types.core.ListModel) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, thread.contextId, (user, context) => {
            if (!this.policy.canListMyItems(user, context, thread)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessagesGetMy", ["threadId=" + thread.id]);
        });
        const messages = await this.repositoryFactory.createThreadMessageRepository().getPageByThreadAndUser(executor.getUser(thread.contextId), threadId, listParams);
        return {thread, messages};
    }
    
    async getThreadMessages2(executor: Executor, threadId: types.thread.ThreadId,  listParams: types.core.ListModel2<types.thread.ThreadMessageId>) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, thread.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, thread)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessagesGet", ["threadId=" + thread.id]);
        });
        const messages = await this.repositoryFactory.createThreadMessageRepository().getPageByThreadMatch2(threadId, listParams);
        return {thread, messages};
    }
    
    async createThread(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.thread.ThreadType|undefined, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.thread.ThreadData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerPolicy) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "thread/threadCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        const thread = await this.repositoryFactory.createThreadRepository().createThread(contextId, type, user.userId, managers, users, data, keyId, newKeys, policy);
        this.threadNotificationService.sendCreatedThread(thread, context.solution);
        return thread;
    }
    
    async updateThread(cloudUser: CloudUser, id: types.thread.ThreadId, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.thread.ThreadData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.thread.ThreadVersion, force: boolean, policy: types.cloud.ContainerPolicy|undefined) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        const {thread: rThread, context: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const threadRepository = this.repositoryFactory.createThreadRepository(session);
            const oldThread = await threadRepository.get(id);
            if (!oldThread) {
                throw new AppException("THREAD_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldThread.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadUpdate", ["threadId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldThread, managers, policy);
            const currentVersion = <types.thread.ThreadVersion>oldThread.history.length;
            if (currentVersion !== version && !force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldThread.contextId, [...oldThread.history.map(x => x.keyId), keyId], oldThread.keys, keys, keyId, users, managers);
            const thread = await threadRepository.updateThread(oldThread, user.userId, managers, users, data, keyId, newKeys, policy);
            return {thread, context};
        });
        this.threadNotificationService.sendUpdatedThread(rThread, usedContext.solution);
        return rThread;
    }
    
    async deleteThread(executor: Executor, id: types.thread.ThreadId) {
        const result = await this.repositoryFactory.withTransaction(async session => {
            const threadRepository = this.repositoryFactory.createThreadRepository(session);
            const threadMessageRepository = this.repositoryFactory.createThreadMessageRepository(session);
            const oldThread = await threadRepository.get(id);
            if (!oldThread) {
                throw new AppException("THREAD_DOES_NOT_EXIST");
            }
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, oldThread.contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "thread/threadDelete", ["threadId=" + id]);
                if (!this.policy.canDeleteContainer(user, context, oldThread)) {
                    throw new AppException("ACCESS_DENIED");
                }
            });
            const inboxes = await this.repositoryFactory.createInboxRepository(session).getInboxesWithThread(id);
            if (inboxes.length > 0) {
                throw new AppException("THREAD_BELONGS_TO_INBOX", inboxes[0].id);
            }
            await threadRepository.deleteThread(oldThread.id);
            await threadMessageRepository.deleteAllFromThread(oldThread.id);
            return {oldThread, context: usedContext};
        });
        this.threadNotificationService.sendDeletedThread(result.oldThread, result.context.solution);
        return result.oldThread;
    }
    
    async deleteManyThreads(executor: Executor, threadIds: types.thread.ThreadId[]) {
        const resultMap: Map<types.thread.ThreadId, "OK" | "THREAD_DOES_NOT_EXIST" | "ACCESS_DENIED" | "THREAD_BELONGS_TO_INBOX"> = new Map();
        for (const id of threadIds) {
            resultMap.set(id, "THREAD_DOES_NOT_EXIST");
        }
        
        const result = await this.repositoryFactory.withTransaction(async session => {
            const threadRepository = this.repositoryFactory.createThreadRepository(session);
            const threadMessageRepository = this.repositoryFactory.createThreadMessageRepository(session);
            const inboxRepository = this.repositoryFactory.createInboxRepository(session);
            const threads = await threadRepository.getMany(threadIds);
            if (threads.length === 0) {
                return {contextId: null, toNotify: []};
            }
            const contextId = threads[0].contextId;
            let additionalAccessCheck: ((thread: db.thread.Thread) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "thread/threadDeleteMany", []);
                additionalAccessCheck = thread => this.policy.canDeleteContainer(user, context, thread);
            });
            const toDelete: types.thread.ThreadId[] = [];
            const toNotify: db.thread.Thread[] = [];
            for (const thread of threads) {
                if (thread.contextId !== contextId) {
                    throw new AppException("RESOURCES_HAVE_DIFFERENT_CONTEXTS");
                }
                if (!additionalAccessCheck(thread)) {
                    resultMap.set(thread.id, "ACCESS_DENIED");
                }
                else {
                    const inboxes = await inboxRepository.getInboxesWithThread(thread.id);
                    if (inboxes.length > 0) {
                        resultMap.set(thread.id, "THREAD_BELONGS_TO_INBOX");
                    }
                    else {
                        resultMap.set(thread.id, "OK");
                        toDelete.push(thread.id);
                        toNotify.push(thread);
                    }
                }
            }
            await threadRepository.deleteManyThreads(toDelete);
            await threadMessageRepository.deleteAllFromThreads(toDelete);
            return {contextId, toNotify, usedContext};
        });
        if (result.usedContext) {
            for (const deletedThread of result.toNotify) {
                this.threadNotificationService.sendDeletedThread(deletedThread, result.usedContext.solution);
            }
        }
        
        const resultArray: types.thread.ThreadDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({id, status});
        }
        
        return {contextId: result.contextId, results: resultArray};
    }
    
    async deleteThreadsByContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const threadRepository = this.repositoryFactory.createThreadRepository();
        const threadMessageRepository = this.repositoryFactory.createThreadMessageRepository();
        await threadRepository.deleteOneByOneByContext(contextId, async thread => {
            await threadMessageRepository.deleteAllFromThread(thread.id);
            this.threadNotificationService.sendDeletedThread(thread, solutionId);
        });
    }
    
    async sendMessage(cloudUser: CloudUser, threadId: types.thread.ThreadId, data: types.thread.ThreadMessageData, keyId: types.core.KeyId) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, thread.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessageSend", ["threadId=" + threadId]);
        if (!this.policy.canCreateItem(user, context, thread)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (thread.keyId !== keyId) {
            throw new AppException("INVALID_THREAD_KEY");
        }
        const message = await this.repositoryFactory.createThreadMessageRepository().createMessage(null, user.userId, threadId, data, keyId);
        await this.repositoryFactory.createThreadRepository().increaseMessageCounter(thread.id, message.createDate);
        this.threadNotificationService.sendNewThreadMessage(thread, message, context.solution);
        const threadStats = await this.repositoryFactory.createThreadRepository().getThreadStats(thread.id);
        if (threadStats) {
            this.threadNotificationService.sendThreadStats({...thread, ...threadStats}, context.solution);
        }
        return {thread, message};
    }
    
    async updateMessage(cloudUser: CloudUser, messageId: types.thread.ThreadMessageId, data: types.thread.ThreadMessageData, keyId: types.core.KeyId, version: types.thread.ThreadMessageVersion|undefined, force: boolean|undefined) {
        const message = await this.repositoryFactory.createThreadMessageRepository().get(messageId);
        if (!message) {
            throw new AppException("THREAD_MESSAGE_DOES_NOT_EXIST");
        }
        const thread = await this.repositoryFactory.createThreadRepository().get(message.threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, thread.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessageUpdate", ["messageId=" + messageId, "threadId=" + thread.id]);
        if (!this.policy.canUpdateItem(user, context, thread, message)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (thread.keyId !== keyId) {
            throw new AppException("INVALID_THREAD_KEY");
        }
        const currentVersion = ((message.updates || []).length + 1) as types.thread.ThreadMessageVersion;
        if (typeof(version) === "number" && currentVersion !== version && force !== true) {
            throw new AppException("ACCESS_DENIED", `version does not match, get: ${version}, expected: ${currentVersion}`);
        }
        const newMessage = await this.repositoryFactory.createThreadMessageRepository().updateMessage(message, user.userId, data, keyId);
        this.threadNotificationService.sendUpdatedThreadMessage(thread, newMessage, context.solution);
        return {thread, message: newMessage};
    }
    
    async deleteMessage(executor: Executor, messageId: types.thread.ThreadMessageId) {
        const message = await this.repositoryFactory.createThreadMessageRepository().get(messageId);
        if (!message) {
            throw new AppException("THREAD_MESSAGE_DOES_NOT_EXIST");
        }
        const thread = await this.repositoryFactory.createThreadRepository().get(message.threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, thread.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessageDelete", ["messageId=" + messageId, "threadId=" + thread.id]);
            if (!this.policy.canDeleteItem(user, context, thread, message)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        await this.repositoryFactory.createThreadMessageRepository().deleteMessage(messageId);
        const lastMessageDate = await this.repositoryFactory.createThreadMessageRepository().getLastMessageDate(thread.id);
        await this.repositoryFactory.createThreadRepository().decreaseMessageCounter(thread.id, lastMessageDate || thread.createDate);
        this.threadNotificationService.sendDeletedThreadMessage(thread, message, usedContext.solution);
        const threadStats = await this.repositoryFactory.createThreadRepository().getThreadStats(thread.id);
        if (threadStats) {
            this.threadNotificationService.sendThreadStats({...thread, ...threadStats}, usedContext.solution);
        }
        return {thread, message};
    }
    
    async deleteManyMessages(executor: Executor, messageIds: types.thread.ThreadMessageId[], checkAccess = true) {
        const resultMap: Map<types.thread.ThreadMessageId, "OK" | "THREAD_MESSAGE_DOES_NOT_EXIST" | "ACCESS_DENIED"> = new Map();
        for (const id of messageIds) {
            resultMap.set(id, "THREAD_MESSAGE_DOES_NOT_EXIST");
        }
        
        const result = await this.repositoryFactory.withTransaction(async session => {
            const threadMessageRepository = this.repositoryFactory.createThreadMessageRepository(session);
            const messages = await threadMessageRepository.getMany(messageIds);
            if (messages.length === 0) {
                return {context: null, toNotify: [], thread: null, threadStats: null};
            }
            const threadRepository = this.repositoryFactory.createThreadRepository();
            const threadId = messages[0].threadId;
            const thread = await threadRepository.get(threadId);
            if (!thread) {
                throw new DbInconsistencyError(`Thread=${threadId} does not exist, message=${messages[0].id}`);
            }
            const contextId = thread.contextId;
            let additionalAccessCheck: ((message: db.thread.ThreadMessage) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                if (checkAccess) {
                    this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessageDeleteMany", ["threadId=" + threadId]);
                }
                additionalAccessCheck = message => this.policy.canDeleteItem(user, context, thread, message);
            });
            const toDelete: types.thread.ThreadMessageId[] = [];
            const toNotify: db.thread.ThreadMessage[] = [];
            for (const message of messages) {
                if (message.threadId !== threadId) {
                    throw new AppException("MESSAGES_BELONGS_TO_DIFFERENT_THREADS");
                }
                if (!additionalAccessCheck(message)) {
                    resultMap.set(message.id, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(message.id, "OK");
                    toDelete.push(message.id);
                    toNotify.push(message);
                }
            }
            await threadMessageRepository.deleteManyMessages(toDelete);
            const lastMessageDate = await threadMessageRepository.getLastMessageDate(thread.id);
            await threadRepository.decreaseMessageCounter(thread.id, lastMessageDate || thread.createDate, toDelete.length);
            const threadStats = await this.repositoryFactory.createThreadRepository().getThreadStats(thread.id);
            return {context: usedContext, toNotify, thread: thread, threadStats};
        });
        if (result.thread && result.threadStats) {
            this.threadNotificationService.sendThreadStats({...result.thread, ...result.threadStats}, result.context.solution);
            for (const deletedMessage of result.toNotify) {
                this.threadNotificationService.sendDeletedThreadMessage(result.thread, deletedMessage, result.context.solution);
            }
        }
        
        const resultArray: types.thread.ThreadMessageDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({id, status});
        }
        
        return {contextId: result.context ? result.context.id : null, results: resultArray};
    }
    
    async deleteMessagesOlderThan(executor: Executor, threadId: types.thread.ThreadId, timestamp: types.core.Timestamp) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        if (!this.isContextId(executor) && executor.type === "cloud") {
            const {user} = await this.cloudAccessValidator.getUserFromContext(executor, thread.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "thread/threadMessageDeleteOlderThan", ["threadId=" + threadId]);
        }
        const messages = (await this.repositoryFactory.createThreadMessageRepository().getMessagesOlderThan(threadId, timestamp));
        return this.deleteManyMessages(executor, messages.map(message => message.id), false);
    }
    
    async sendCustomNotification(cloudUser: CloudUser, threadId: types.thread.ThreadId, keyId: types.core.KeyId, data: unknown, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, thread.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "thread/threadSendCustomNotification", ["threadId=" + threadId]);
        if (!this.policy.canSendCustomNotification(user, context, thread)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (users && users.some(element => !thread.users.includes(element))) {
            throw new AppException("USER_DOES_NOT_HAVE_ACCESS_TO_CONTAINER");
        }
        this.threadNotificationService.sendThreadCustomEvent(thread, keyId, data, {id: user.userId, pub: user.userPubKey}, customChannelName, users);
        return thread;
    }
    
    private isContextId(x: unknown): x is types.context.ContextId {
        return typeof(x) === "string";
    }
}

class ThreadPolicy extends BasePolicy<db.thread.Thread, db.thread.ThreadMessage> {
    
    protected isItemCreator(user: db.context.ContextUser, message: db.thread.ThreadMessage) {
        return message.author === user.userId;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.thread || {};
    }
}
