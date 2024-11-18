/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import { RepositoryFactory } from "../../db/RepositoryFactory";
import * as types from "../../types";
import * as db from "../../db/Model";
import * as inboxApi from "../../api/main/inbox/InboxApiTypes";
import { CloudUser, Executor } from "../../CommonTypes";
import { AppException } from "../../api/AppException";
import { CloudKeyService } from "./CloudKeyService";
import { InboxNotificationService } from "./InboxNotificationService";
import { IStorageService } from "../misc/StorageService";
import { StoreNotificationService } from "./StoreNotificationService";
import { ThreadNotificationService } from "./ThreadNotificationService";
import { CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { BasePolicy } from "./BasePolicy";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbInconsistencyError } from "../../error/DbInconsistencyError";

export interface FileDefinition {
    meta: types.store.StoreFileMeta;
    file: db.request.FileDefinition;
    thumb: db.request.FileDefinition|undefined;
}

export class InboxService {
    
    private policy: InboxPolicy;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private cloudKeyService: CloudKeyService,
        private inboxNotificationService: InboxNotificationService,
        private storageService: IStorageService,
        private storeNotificationService: StoreNotificationService,
        private threadNotificationService: ThreadNotificationService,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
    ) {
        this.policy = new InboxPolicy(this.policyService);
    }
    
    async createInbox(cloudUser: CloudUser, model: inboxApi.InboxCreateModel) {
        const policy = model.policy || {};
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, model.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxCreate", []);
        this.policy.makeCreateContainerCheck(user, context, model.managers, policy);
        await this.validateAccessToThread(model.data.threadId, user);
        await this.validateAccessToStore(model.data.storeId, user);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(model.contextId, model.keys, model.keyId, model.users, model.managers);
        const inbox = await this.repositoryFactory.createInboxRepository().createInbox(model.contextId, model.type, user.userId, model.managers, model.users, model.data, model.keyId, newKeys, policy);
        this.inboxNotificationService.sendInboxCreated(inbox, context.solution);
        return inbox;
    }
    
    async updateInbox(cloudUser: CloudUser, model: inboxApi.InboxUpdateModel) {
        if (model.policy) {
            this.policyService.validateContainerPolicyForContainer("policy", model.policy);
        }
        const {store: rInbox, context: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const inboxRepository = this.repositoryFactory.createInboxRepository(session);
            const oldInbox = await inboxRepository.get(model.id);
            if (!oldInbox) {
                throw new AppException("STORE_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldInbox.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxUpdate", ["inboxId=" + model.id]);
            this.policy.makeUpdateContainerCheck(user, context, oldInbox, model.managers, model.policy);
            const last = oldInbox.history[oldInbox.history.length - 1];
            if (last.data.threadId != model.data.threadId) {
                await this.validateAccessToThread(model.data.threadId, user);
            }
            if (last.data.storeId != model.data.storeId) {
                await this.validateAccessToStore(model.data.storeId, user);
            }
            const currentVersion = <types.inbox.InboxVersion>oldInbox.history.length;
            if (currentVersion !== model.version && !model.force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldInbox.contextId, [...oldInbox.history.map(x => x.keyId), model.keyId], oldInbox.keys, model.keys, model.keyId, model.users, model.managers);
            const store = await inboxRepository.updateInbox(oldInbox, user.userId, model.managers, model.users, model.data, model.keyId, newKeys, model.policy);
            return {store, context};
        });
        this.inboxNotificationService.sendInboxUpdated(rInbox, usedContext.solution);
        return rInbox;
    }
    
    async deleteInbox(executor: Executor, id: types.inbox.InboxId) {
        const {inbox: rInbox, userContext: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const inboxRepository = this.repositoryFactory.createInboxRepository(session);
            const inbox = await inboxRepository.get(id);
            if (!inbox) {
                throw new AppException("INBOX_DOES_NOT_EXIST");
            }
            const userContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, inbox.contextId, (user, context) => {
                if (!this.policy.canDeleteContainer(user, context, inbox)) {
                    throw new AppException("ACCESS_DENIED");
                }
                this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxDelete", ["inboxId=" + id]);
            });
            await inboxRepository.deleteInbox(inbox.id);
            return {inbox, userContext};
        });
        this.inboxNotificationService.sendInboxDeleted(rInbox, usedContext.solution);
        return rInbox;
    }

    async deleteManyInboxes(executor: Executor, inboxIds: types.inbox.InboxId[]) {
        const resultMap: Map<types.inbox.InboxId, "OK" | "INBOX_DOES_NOT_EXIST" | "ACCESS_DENIED"> = new Map();
        for (const id of inboxIds) {
            resultMap.set(id, "INBOX_DOES_NOT_EXIST");
        }

        const result = await this.repositoryFactory.withTransaction(async session => {
            const inboxRepository = this.repositoryFactory.createInboxRepository(session);
            const inboxes = await inboxRepository.getMany(inboxIds);
            if (inboxes.length === 0) {
                return {context: null, toNotify: []};
            }
            const contextId = inboxes[0].contextId;
            let additionalAccessCheck: ((inbox: db.inbox.Inbox) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxDeleteMany", []);
                additionalAccessCheck = inbox => this.policy.canDeleteContainer(user, context, inbox);
            });
            const toDelete: types.inbox.InboxId[] = [];
            const toNotify: db.inbox.Inbox[] = [];
            for (const inbox of inboxes) {
                if (inbox.contextId !== contextId) {
                    throw new AppException("RESOURCES_HAVE_DIFFERENT_CONTEXTS");
                }
                if (!additionalAccessCheck(inbox)) {
                    resultMap.set(inbox.id, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(inbox.id, "OK");
                    toDelete.push(inbox.id);
                    toNotify.push(inbox);
                }
            }
            await inboxRepository.deleteManyInboxes(toDelete);
            return {context: usedContext, toNotify};
        });
        if (result.context) {
            for (const deletedInbox of result.toNotify) {
                this.inboxNotificationService.sendInboxDeleted(deletedInbox, result.context.solution);
            }
        }

        const resultArray: types.inbox.InboxDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({id, status});
        }

        return {contextId: result.context ? result.context.id : null, results: resultArray};
    }
    
    async deleteInboxesByContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const inboxRepository = this.repositoryFactory.createInboxRepository();
        
        await inboxRepository.deleteOneByOneByContext(contextId, async inbox => {
            this.inboxNotificationService.sendInboxDeleted(inbox, solutionId);
        });
    }
    
    async getInbox(executor: Executor, inboxId: types.inbox.InboxId, type: types.inbox.InboxType|undefined) {
        const inbox = await this.repositoryFactory.createInboxRepository().get(inboxId);
        if (!inbox) {
            throw new AppException("INBOX_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, inbox.contextId, (user, context) => {
            if (!this.policy.canReadContainer(user, context, inbox)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxGet", ["inboxId=" + inboxId]);
        });
        if (type && inbox.type !== type) {
            throw new AppException("INBOX_DOES_NOT_EXIST");
        }
        return inbox;
    }
    
    async getInboxWithoutCheckingAccess(inboxId: types.inbox.InboxId) {
        const inbox = await this.repositoryFactory.createInboxRepository().get(inboxId);
        if (!inbox) {
            throw new AppException("INBOX_DOES_NOT_EXIST");
        }
        return inbox;
    }
    
    async getAllInboxes(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.inbox.InboxType|undefined, listParams: types.core.ListModel, sortBy: keyof db.inbox.Inbox) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxListAll", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const inboxes = await this.repositoryFactory.createInboxRepository().getAllInboxes(contextId, type, listParams, sortBy);
        return {user, inboxes};
    }
   
    async getMyInboxes(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.inbox.InboxType|undefined, listParams: types.core.ListModel, sortBy: keyof db.inbox.Inbox) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxList", []);
        if (!this.policy.canListMyContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const inboxes = await this.repositoryFactory.createInboxRepository().getPageByContextAndUser(contextId, type, user.userId, cloudUser.solutionId, listParams, sortBy);
        return {user, inboxes};
    }
    
    async getInboxesByContext(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel2<types.inbox.InboxId>) {
        const ctx = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!ctx) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, ctx, (user, context) => {
            if (!this.policy.canListAllContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "inbox/inboxList", []);
        });
        const inboxes = await this.repositoryFactory.createInboxRepository().getPageByContext(contextId, listParams);
        return {inboxes};
    }

    async send(username: types.core.Username, model: inboxApi.InboxSendModel, solutionId?: types.cloud.SolutionId) {
        const inbox = await this.repositoryFactory.createInboxRepository().get(model.inboxId);
        if (!inbox) {
            throw new AppException("INBOX_DOES_NOT_EXIST");
        }
        const context = await this.repositoryFactory.createContextRepository().get(inbox.contextId);
        if (!context) {
            throw new DbInconsistencyError(`Context=${inbox.contextId} does not exist, inbox=${inbox.id}`);
        }
        if (solutionId && context.solution !== solutionId && !context.shares.includes(solutionId)) {
            throw new AppException("INBOX_DOES_NOT_EXIST");
        }
        if (model.version > inbox.history.length) {
            throw new AppException("INVALID_VERSION");
        }
        const last = inbox.history[inbox.history.length - 1];
        const store = await this.repositoryFactory.createStoreRepository().get(last.data.storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        const thread = await this.repositoryFactory.createThreadRepository().get(last.data.threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        const requestRepository = this.repositoryFactory.createRequestRepository();
        if (model.files.length > 0 && !model.requestId) {
            throw new AppException("REQUEST_DOES_NOT_EXIST");
        }
        const request = model.requestId && model.files.length > 0 ? await requestRepository.getReadyForUser(username, model.requestId) : null;
        const files = this.checkFilesIndexesAndCountAndSize(last.data.fileConfig, request, model);
        await this.commitFiles(files);
        const msgId = this.repositoryFactory.createThreadMessageRepository().generateMsgId();
        const dbFiles = await this.saveFiles(inbox.id, store.id, thread.id, msgId, files);
        if (dbFiles.length > 0) {
            await this.repositoryFactory.createStoreRepository().increaseFilesCounterBy(store.id, dbFiles[dbFiles.length - 1].createDate, dbFiles.length);
        }
        if (request) {
            await this.repositoryFactory.createRequestRepository().delete(request.id);
        }
        const messageDataObj = {
            message: model.message,
            store: store.id,
            files: dbFiles.map(x => x.id),
            version: model.version,
        };
        const messageData = Buffer.from(JSON.stringify(messageDataObj), "utf8").toString("base64") as types.thread.ThreadMessageData;
        const message = await this.repositoryFactory.createThreadMessageRepository().createMessage(msgId, "<anonymous>" as types.cloud.UserId, thread.id, messageData, `<inbox-${inbox.id}>` as types.core.KeyId);
        await this.repositoryFactory.createThreadRepository().increaseMessageCounter(thread.id, message.createDate);
        const solutionForNotification = solutionId ? solutionId : context.solution;
        for (const dbFile of dbFiles) {
            this.storeNotificationService.sendStoreFileCreated(store, dbFile, solutionForNotification);
        }
        if (dbFiles.length > 0) {
            this.storeNotificationService.sendStoreStatsChanged({...store, files: store.files + dbFiles.length, lastFileDate: dbFiles[dbFiles.length - 1].createDate}, solutionForNotification);
        }
        
        this.threadNotificationService.sendNewThreadMessage(thread, message, solutionForNotification);
        return {inbox, thread, message};
    }
    
    // ============================
    
    private async validateAccessToThread(threadId: types.thread.ThreadId, user: db.context.ContextUser) {
        const thread = await this.repositoryFactory.createThreadRepository().get(threadId);
        if (!thread) {
            throw new AppException("THREAD_DOES_NOT_EXIST");
        }
        if (!thread.managers.includes(user.userId)) {
            throw new AppException("ACCESS_DENIED");
        }
    }
    
    private async validateAccessToStore(storeId: types.store.StoreId, user: db.context.ContextUser) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        if (!store.managers.includes(user.userId)) {
            throw new AppException("ACCESS_DENIED");
        }
    }
    
    private checkFilesIndexesAndCountAndSize(fileConfig: types.inbox.InboxFileConfig, request: db.request.Request|null, model: inboxApi.InboxSendModel) {
        if (model.files.length > fileConfig.maxCount) {
            throw new AppException("TOO_MANY_FILES_IN_REQUEST");
        }
        if (model.files.length < fileConfig.minCount) {
            throw new AppException("NOT_ENOUGH_FILES_IN_REQUEST");
        }
        const usedIndexes: number[] = [];
        const result: FileDefinition[] = [];
        for (const file of model.files) {
            if (!request) {
                throw new Error("Request is required");
            }
            const reqFile = request.files[file.fileIndex];
            if (!reqFile) {
                throw new AppException("INVALID_FILE_INDEX");
            }
            if (usedIndexes.includes(file.fileIndex)) {
                throw new AppException("FILE_ALREADY_USED");
            }
            if (reqFile.size > fileConfig.maxFileSize) {
                throw new AppException("REQUEST_FILE_SIZE_EXCEEDED");
            }
            usedIndexes.push(file.fileIndex);
            const reqThumb = typeof(file.thumbIndex) === "number" ? request.files[file.thumbIndex] : undefined;
            if (typeof(file.thumbIndex) === "number") {
                if (!reqThumb) {
                    throw new AppException("INVALID_FILE_INDEX");
                }
                if (usedIndexes.includes(file.thumbIndex)) {
                    throw new AppException("FILE_ALREADY_USED");
                }
                if (reqThumb.size > fileConfig.maxFileSize) {
                    throw new AppException("REQUEST_FILE_SIZE_EXCEEDED");
                }
                usedIndexes.push(file.thumbIndex);
            }
            result.push({meta: file.meta, file: reqFile, thumb: reqThumb});
        }
        const wholeSize = result.reduce((sum, x) => sum + x.file.sent + (x.thumb ? x.thumb.size : 0), 0);
        if (wholeSize > fileConfig.maxWholeUploadSize) {
            throw new AppException("REQUEST_FILE_SIZE_EXCEEDED");
        }
        return result;
    }
    
    private async commitFiles(files: FileDefinition[]) {
        for (const file of files) {
            await this.storageService.commit(file.file.id);
            if (file.thumb) {
                await this.storageService.commit(file.thumb.id);
            }
        }
    }
    
    private async saveFiles(inboxId: types.inbox.InboxId, storeId: types.store.StoreId, threadId: types.thread.ThreadId, msgId: types.thread.ThreadMessageId, files: FileDefinition[]) {
        const result: db.store.StoreFile[] = [];
        for (const file of files) {
            const dbFile = await this.repositoryFactory.createStoreFileRepository().create(storeId, "<anonymous>" as types.cloud.UserId, file.meta, `<inboxmsg-${inboxId}-${threadId}-${msgId}>` as types.core.KeyId, file.file, file.thumb);
            result.push(dbFile);
        }
        return result;
    }
}

class InboxPolicy extends BasePolicy<db.inbox.Inbox, unknown> {
    
    protected isItemCreator() {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.inbox || {};
    }
}
