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
import * as storeApi from "../../api/main/store/StoreApiTypes";
import { ERROR_CODES, AppException } from "../../api/AppException";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { IStorageService } from "../misc/StorageService";
import { CloudKeyService } from "./CloudKeyService";
import { StoreNotificationService } from "./StoreNotificationService";
import { DateUtils } from "../../utils/DateUtils";
import { CloudUser, Executor } from "../../CommonTypes";
import { JobService } from "../job/JobService";
import { Logger } from "../log/LoggerFactory";
import { CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { BasePolicy } from "./BasePolicy";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbInconsistencyError } from "../../error/DbInconsistencyError";

export class StoreService {
    
    private policy: StorePolicy;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private cloudKeyService: CloudKeyService,
        private storeNotificationService: StoreNotificationService,
        private storageService: IStorageService,
        private jobService: JobService,
        private logger: Logger,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
    ) {
        this.policy = new StorePolicy(this.policyService);
    }
    
    async createStore(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.store.StoreType|undefined, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.store.StoreData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerPolicy) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        const store = await this.repositoryFactory.createStoreRepository().createStore(contextId, type, user.userId, managers, users, data, keyId, newKeys, policy);
        this.storeNotificationService.sendStoreCreated(store, context.solution);
        return store;
    }
    
    async updateStore(cloudUser: CloudUser, id: types.store.StoreId, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.store.StoreData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.store.StoreVersion, force: boolean, policy: types.cloud.ContainerPolicy|undefined) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        const {store: rStore, context: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const storeRepository = this.repositoryFactory.createStoreRepository(session);
            const oldStore = await storeRepository.get(id);
            if (!oldStore) {
                throw new AppException("STORE_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldStore.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeUpdate", ["storeId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldStore, managers, policy);
            const currentVersion = <types.store.StoreVersion>oldStore.history.length;
            if (currentVersion !== version && !force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldStore.contextId, [...oldStore.history.map(x => x.keyId), keyId], oldStore.keys, keys, keyId, users, managers);
            const store = await storeRepository.updateStore(oldStore, user.userId, managers, users, data, keyId, newKeys, policy);
            return {store, context};
        });
        this.storeNotificationService.sendStoreUpdated(rStore, usedContext.solution);
        return rStore;
    }
    
    async deleteStore(executor: Executor, id: types.store.StoreId) {
        const result = await this.repositoryFactory.withTransaction(async session => {
            const storeRepository = this.repositoryFactory.createStoreRepository(session);
            const storeFileRepository = this.repositoryFactory.createStoreFileRepository(session);
            const store = await storeRepository.get(id);
            if (!store) {
                throw new AppException("STORE_DOES_NOT_EXIST");
            }
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "store/storeDelete", ["storeId=" + id]);
                if (!this.policy.canDeleteContainer(user, context, store)) {
                    throw new AppException("ACCESS_DENIED", "policy is not met");
                }
            });
            const inboxes = await this.repositoryFactory.createInboxRepository(session).getInboxesWithStore(id);
            if (inboxes.length > 0) {
                throw new AppException("STORE_BELONGS_TO_INBOX", inboxes[0].id);
            }
            await storeRepository.deleteStore(store.id);
            const files = await storeFileRepository.deleteAllFromStore(store.id);
            return {files, store, usedContext};
        });
        this.storeNotificationService.sendStoreDeleted(result.store, result.usedContext.solution);
        this.clearFilesInStorage(result.files);
        return result.store;
    }
    
    async deleteManyStores(executor: Executor, storeIds: types.store.StoreId[]) {
        const resultMap: Map<types.store.StoreId, "OK" | "STORE_DOES_NOT_EXIST" | "ACCESS_DENIED" | "STORE_BELONGS_TO_INBOX"> = new Map();
        for (const id of storeIds) {
            resultMap.set(id, "STORE_DOES_NOT_EXIST");
        }
        const result = await this.repositoryFactory.withTransaction(async session => {
            const storeRepository = this.repositoryFactory.createStoreRepository(session);
            const storeFileRepository = this.repositoryFactory.createStoreFileRepository(session);
            
            const stores = await storeRepository.getMany(storeIds);
            if (stores.length === 0) {
                return {context: null, toNotify: [], files: []};
            }
            const contextId = stores[0].contextId;
            let additionalAccessCheck: ((store: db.store.Store) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "store/storeDeleteMany", []);
                additionalAccessCheck = store => this.policy.canDeleteContainer(user, context, store);
            });
            const toDelete: types.store.StoreId[] = [];
            const toNotify: db.store.Store[] = [];
            for (const store of stores) {
                if (store.contextId !== contextId) {
                    throw new AppException("RESOURCES_HAVE_DIFFERENT_CONTEXTS");
                }
                if (!additionalAccessCheck(store)) {
                    resultMap.set(store.id, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(store.id, "OK");
                    toDelete.push(store.id);
                    toNotify.push(store);
                }
            }
            await storeRepository.deleteManyStores(toDelete);
            const files = await storeFileRepository.deleteAllFromStores(toDelete);
            return {context: usedContext, toNotify, files};
        });
        if (result.context) {
            for (const deletedStore of result.toNotify) {
                this.storeNotificationService.sendStoreDeleted(deletedStore, result.context.solution);
            }
        }
        this.clearFilesInStorage(result.files);
        
        const resultArray: types.store.StoreDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({id, status});
        }
        
        return {contextId: result.context ? result.context.id : null, results: resultArray};
    }
    
    async deleteStoresByContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const storeRepository = this.repositoryFactory.createStoreRepository();
        const storeFileRepository = this.repositoryFactory.createStoreFileRepository();
        await storeRepository.deleteOneByOneByContext(contextId, async store => {
            const files = await storeFileRepository.deleteAllFromStore(store.id);
            this.storeNotificationService.sendStoreDeleted(store, solutionId);
            this.clearFilesInStorage(files);
        });
    }
    
    async getStore(executor: Executor, storeId: types.store.StoreId, type: types.store.StoreType|undefined) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeGet", ["storeId=" + storeId]);
            if (!this.policy.canReadContainer(user, context, store)) {
                throw new AppException("ACCESS_DENIED", "policy is not met");
            }
        });
        if (type && store.type !== type) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        return store;
    }
    
    async getAllStores(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.store.StoreType|undefined, listParams: types.core.ListModel, sortBy: keyof db.store.Store) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeListAll", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const stores = await this.repositoryFactory.createStoreRepository().getAllStores(contextId, type, listParams, sortBy);
        return {user, stores};
    }
    
    async getMyStores(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.store.StoreType|undefined, listParams: types.core.ListModel, sortBy: keyof db.store.Store) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeList", []);
        if (!this.policy.canListMyContainers(user, context)) {
            throw new AppException("ACCESS_DENIED", "policy is not met");
        }
        const stores = await this.repositoryFactory.createStoreRepository().getPageByContextAndUser(contextId, type, user.userId, cloudUser.solutionId, listParams, sortBy);
        return {user, stores};
    }
    
    async getStoresByContext(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel2<types.store.StoreId>) {
        const ctx = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!ctx) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, ctx, (user, context) => {
            if (!this.policy.canListAllContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeList", []);
        });
        const stores = await this.repositoryFactory.createStoreRepository().getPageByContext(contextId, listParams);
        return {stores};
    }
    
    async getStoreFile(executor: Executor, fileId: types.store.StoreFileId) {
        const file = await this.repositoryFactory.createStoreFileRepository().get(fileId);
        if (!file) {
            throw new AppException("STORE_FILE_DOES_NOT_EXIST");
        }
        const store = await this.repositoryFactory.createStoreRepository().get(file.storeId);
        if (!store) {
            throw new DbInconsistencyError(`store=${file.storeId} does not exist, from file=${fileId}`);
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileGet", ["storeId=" + store.id, "fileId=" + fileId]);
            if (!this.policy.canReadItem(user, context, store, file)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        return {file, store};
    }
    
    async getStoreFileMany(executor: Executor, storeId: types.store.StoreId, fileIds: types.store.StoreFileId[], failOnError: boolean) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileGetMany", ["storeId=" + storeId]);
            if (!this.policy.canListAllItems(user, context, store)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        const files: (db.store.StoreFile|types.store.StoreFileFetchError)[] = [];
        for (const fileId of fileIds) {
            const file = await this.repositoryFactory.createStoreFileRepository().get(fileId);
            if (!file) {
                if (failOnError) {
                    throw new AppException("STORE_FILE_DOES_NOT_EXIST");
                }
                else {
                    const fetchError: types.store.StoreFileFetchError = {
                        id: fileId,
                        error: ERROR_CODES.STORE_FILE_DOES_NOT_EXIST,
                    };
                    files.push(fetchError);
                    continue;
                }
            }
            if (file.storeId != storeId) {
                if (failOnError) {
                    throw new AppException("FILE_DOES_NOT_BELONG_TO_STORE");
                }
                else {
                    const fetchError: types.store.StoreFileFetchError = {
                        id: fileId,
                        error: ERROR_CODES.FILE_DOES_NOT_BELONG_TO_STORE,
                    };
                    files.push(fetchError);
                    continue;
                }
            }
            files.push(file);
        }
        return {store, files};
    }
    
    async getStoreFiles(executor: Executor, storeId: types.store.StoreId, listParams: types.core.ListModel) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, store)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileList", ["storeId=" + storeId]);
        });
        const files = await this.repositoryFactory.createStoreFileRepository().getPageByStore(storeId, listParams);
        return {store, files};
    }
    
    async getMyStoreFiles(executor: CloudUser, storeId: types.store.StoreId, listParams: types.core.ListModel) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
            if (!this.policy.canListMyItems(user, context, store)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileListMy", ["storeId=" + storeId]);
        });
        const files = await this.repositoryFactory.createStoreFileRepository().getPageByStoreAndUser(storeId, executor.getUser(store.contextId), listParams);
        return {store, files};
    }
    
    async getStoreFiles2(executor: Executor, storeId: types.store.StoreId, listParams: types.core.ListModel2<types.store.StoreFileId>) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, store)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileList", ["storeId=" + storeId]);
        });
        const files = await this.repositoryFactory.createStoreFileRepository().getPageByStore2(storeId, listParams);
        return {store, files};
    }
    
    async createStoreFile(cloudUser: CloudUser, model: storeApi.StoreFileCreateModel) {
        const {user, context, store} = await this.getStoreAndUser(cloudUser, model.storeId);
        if (!this.policy.canCreateItem(user, context, store)) {
            throw new AppException("ACCESS_DENIED");
        }
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileCreate", ["storeId=" + model.storeId]);
        if (model.keyId !== store.keyId) {
            throw new AppException("INVALID_KEY");
        }
        const requestRepository = this.repositoryFactory.createRequestRepository();
        const request = await requestRepository.getReadyForUser(cloudUser.pub, model.requestId);
        if (!request.files[model.fileIndex]) {
            throw new AppException("INVALID_FILE_INDEX");
        }
        if (typeof(model.thumbIndex) === "number") {
            if (!request.files[model.thumbIndex]) {
                throw new AppException("INVALID_FILE_INDEX");
            }
            if (model.thumbIndex === model.fileIndex) {
                throw new AppException("FILE_ALREADY_USED");
            }
        }
        const uploadedFile = request.files[model.fileIndex];
        const uploadedThumb = typeof(model.thumbIndex) === "number" ? request.files[model.thumbIndex] : undefined;
        
        await this.storageService.commit(uploadedFile.id);
        if (uploadedThumb) {
            await this.storageService.commit(uploadedThumb.id);
        }
        const file = await this.repositoryFactory.createStoreFileRepository().create(model.storeId, user.userId, model.meta, model.keyId, uploadedFile, uploadedThumb);
        await this.repositoryFactory.createStoreRepository().increaseFilesCounter(store.id, file.createDate);
        if (request) {
            await this.repositoryFactory.createRequestRepository().delete(request.id);
        }
        this.storeNotificationService.sendStoreFileCreated(store, file, context.solution);
        this.storeNotificationService.sendStoreStatsChanged({...store, files: store.files + 1, lastFileDate: file.createDate}, context.solution);
        return {file, store, user};
    }
    
    async writeStoreFile(cloudUser: CloudUser, model: storeApi.StoreFileWriteModel) {
        const oldFile = await this.repositoryFactory.createStoreFileRepository().get(model.fileId);
        if (!oldFile) {
            throw new AppException("STORE_FILE_DOES_NOT_EXIST");
        }
        const {user, context, store} = await this.getStoreAndUser(cloudUser, oldFile.storeId);
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileWrite", ["storeId=" + store.id, "fileId=" + model.fileId]);
        if (!this.policy.canUpdateItem(user, context, store, oldFile)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (model.keyId !== store.keyId) {
            throw new AppException("INVALID_KEY");
        }
        const currentVersion = ((oldFile.updates || []).length + 1) as types.store.StoreFileVersion;
        if (typeof(model.version) === "number" && currentVersion !== model.version && model.force !== true) {
            throw new AppException("ACCESS_DENIED", `version does not match, get: ${model.version}, expected: ${currentVersion}`);
        }
        const requestRepository = this.repositoryFactory.createRequestRepository();
        const request = await requestRepository.getReadyForUser(cloudUser.pub, model.requestId);
        if (!request.files[model.fileIndex]) {
            throw new AppException("INVALID_FILE_INDEX");
        }
        if (typeof(model.thumbIndex) === "number") {
            if (!request.files[model.thumbIndex]) {
                throw new AppException("INVALID_FILE_INDEX");
            }
            if (model.thumbIndex === model.fileIndex) {
                throw new AppException("FILE_ALREADY_USED");
            }
        }
        const uploadedFile = request.files[model.fileIndex];
        const uploadedThumb = typeof(model.thumbIndex) === "number" ? request.files[model.thumbIndex] : undefined;
        
        await this.storageService.commit(uploadedFile.id);
        if (uploadedThumb) {
            await this.storageService.commit(uploadedThumb.id);
        }
        const file = await this.repositoryFactory.createStoreFileRepository().update(oldFile, user.userId, model.meta, model.keyId, uploadedFile, uploadedThumb);
        await this.removeFileFromStorage(oldFile);
        if (request) {
            await this.repositoryFactory.createRequestRepository().delete(request.id);
        }
        this.storeNotificationService.sendStoreFileUpdated(store, file, context.solution);
        return {file, store, user};
    }
    
    async updateStoreFile(cloudUser: CloudUser, model: storeApi.StoreFileUpdateModel) {
        const oldFile = await this.repositoryFactory.createStoreFileRepository().get(model.fileId);
        if (!oldFile) {
            throw new AppException("STORE_FILE_DOES_NOT_EXIST");
        }
        const {user, context, store} = await this.getStoreAndUser(cloudUser, oldFile.storeId);
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileUpdate", ["storeId=" + store.id, "fileId=" + model.fileId]);
        if (!this.policy.canUpdateItem(user, context, store, oldFile)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (model.keyId !== store.keyId) {
            throw new AppException("INVALID_KEY");
        }
        const currentVersion = ((oldFile.updates || []).length + 1) as types.store.StoreFileVersion;
        if (typeof(model.version) === "number" && currentVersion !== model.version && model.force !== true) {
            throw new AppException("ACCESS_DENIED", `version does not match, get: ${model.version}, expected: ${currentVersion}`);
        }
        const file = await this.repositoryFactory.createStoreFileRepository().updateMeta(oldFile, user.userId, model.meta, model.keyId);
        this.storeNotificationService.sendStoreFileUpdated(store, file, context.solution);
        return {file, store, user};
    }
    
    async deleteStoreFile(executor: Executor, fileId: types.store.StoreFileId) {
        const file = await this.repositoryFactory.createStoreFileRepository().get(fileId);
        if (!file) {
            throw new AppException("STORE_FILE_DOES_NOT_EXIST");
        }
        const store = await this.repositoryFactory.createStoreRepository().get(file.storeId);
        if (!store) {
            throw new DbInconsistencyError(`store=${file.storeId} does not exist, from file=${fileId}`);
        }
        const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileDelete", ["storeId=" + store.id, "fileId=" + fileId]);
            if (!this.policy.canDeleteItem(user, context, store, file)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        const deletedAt = DateUtils.now();
        await this.repositoryFactory.createStoreFileRepository().deleteFile(fileId);
        await this.repositoryFactory.createStoreRepository().decreaseFilesCounter(store.id, deletedAt);
        await this.removeFileFromStorage(file);
        this.storeNotificationService.sendStoreFileDeleted(store, file, usedContext.solution);
        this.storeNotificationService.sendStoreStatsChanged({...store, files: store.files - 1, lastFileDate: deletedAt}, usedContext.solution);
        return {file, store};
    }
    
    async deleteManyStoreFiles(executor: Executor, fileIds: types.store.StoreFileId[], checkAccess = true) {
        const resultMap: Map<types.store.StoreFileId, "OK" | "STORE_FILE_DOES_NOT_EXIST" | "ACCESS_DENIED" | "STORE_DOES_NOT_EXIST"> = new Map();
        for (const id of fileIds) {
            resultMap.set(id, "STORE_FILE_DOES_NOT_EXIST");
        }
        
        const result = await this.repositoryFactory.withTransaction(async session => {
            const storeFileRepository = this.repositoryFactory.createStoreFileRepository(session);
            const files = await storeFileRepository.getMany(fileIds);
            if (files.length === 0) {
                return {context: null, filesToDeleteData: [], store: null, deletedAt: null};
            }
            const storeRepository = this.repositoryFactory.createStoreRepository();
            const storeId = files[0].storeId;
            const store = await storeRepository.get(storeId);
            if (!store) {
                throw new DbInconsistencyError(`store=${storeId} does not exist, from file=${files[0].id}`);
            }
            const contextId = store.contextId;
            let additionalAccessCheck: ((file: db.store.StoreFile) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                if (checkAccess) {
                    this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileDeleteMany", ["storeId=" + store.id]);
                }
                additionalAccessCheck = file => this.policy.canDeleteItem(user, context, store, file);
            });
            const toDelete: types.store.StoreFileId[] = [];
            const filesToDeleteData: db.store.StoreFile[] = [];
            for (const file of files) {
                if (file.storeId !== storeId) {
                    throw new AppException("FILES_BELONGS_TO_DIFFERENT_STORES");
                }
                if (!additionalAccessCheck(file)) {
                    resultMap.set(file.id, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(file.id, "OK");
                    toDelete.push(file.id);
                    filesToDeleteData.push(file);
                }
            }
            const deletedAt = DateUtils.now();
            await storeFileRepository.deleteManyFiles(toDelete);
            await this.repositoryFactory.createStoreRepository().decreaseFilesCounter(store.id, deletedAt, toDelete.length);
            this.clearFilesInStorage(filesToDeleteData);
            return {context: usedContext, filesToDeleteData: filesToDeleteData, store: store, deletedAt};
        });
        if (result.store) {
            this.storeNotificationService.sendStoreStatsChanged({...result.store, files: result.store.files - 1, lastFileDate: result.deletedAt}, result.context.solution);
        }
        if (result.store && result.context) {
            for (const deletedFile of result.filesToDeleteData) {
                this.storeNotificationService.sendStoreFileDeleted(result.store, deletedFile, result.context.solution);
            }
        }
        
        const resultArray: types.store.StoreFileDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({id, status});
        }
        
        return {contextId: result.context ? result.context.id : null, results: resultArray};
    }
    
    async deleteFilesOlderThan(executor: Executor, storeId: types.store.StoreId, timestamp: types.core.Timestamp) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, store.contextId, (user) => {
            this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileDeleteOlderThan", ["storeId=" + storeId]);
        });
        const storeFiles = (await this.repositoryFactory.createStoreFileRepository().getFilesOlderThan(storeId, timestamp));
        return this.deleteManyStoreFiles(executor, storeFiles.map(file => file.id), false);
    }
    
    async readStoreFile(cloudUser: CloudUser, fileId: types.store.StoreFileId, thumb: boolean, version: types.store.StoreFileVersion|undefined, range: types.store.BufferReadRange) {
        const file = await this.repositoryFactory.createStoreFileRepository().get(fileId);
        if (!file) {
            throw new AppException("STORE_FILE_DOES_NOT_EXIST");
        }
        const {user, context, store} = await this.getStoreAndUser(cloudUser, file.storeId);
        if (!this.policy.canReadItem(user, context, store, file)) {
            throw new AppException("ACCESS_DENIED");
        }
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeFileRead", ["storeId=" + store.id, "fileId=" + fileId]);
        if (typeof(version) === "number" && this.getFileVersion(file) !== version) {
            throw new AppException("STORE_FILE_VERSION_MISMATCH");
        }
        const fileIdToRead = (() => {
            if (thumb) {
                if (!file.thumb) {
                    throw new AppException("FILES_CONTAINER_FILE_HAS_NOT_THUMB");
                }
                return file.thumb.fileId;
            }
            return file.fileId;
        })();
        const data = await this.storageService.read(fileIdToRead, range);
        return {file, store, user, data};
    }
    
    async sendCustomNotification(cloudUser: CloudUser, storeId: types.store.StoreId, keyId: types.core.KeyId, data: unknown, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, store.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "store/storeSendCustomNotification", ["storeId=" + storeId]);
        if (!this.policy.canSendCustomNotification(user, context, store)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (users && users.some(element => !store.users.includes(element))) {
            throw new AppException("USER_DOES_NOT_HAVE_ACCESS_TO_CONTAINER");
        }
        this.storeNotificationService.sendStoreCustomEvent(store, keyId, data, {id: user.userId, pub: user.userPubKey}, customChannelName, users);
        return store;
    }
    
    private getFileVersion(file: db.store.StoreFile) {
        return (file.updates || []).length + 1;
    }
    
    // ============================
    
    private async getStoreAndUser(cloudUser: CloudUser, storeId: types.store.StoreId) {
        const store = await this.repositoryFactory.createStoreRepository().get(storeId);
        if (!store) {
            throw new AppException("STORE_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, store.contextId);
        return {user, context, store};
    }
    
    private async removeFileFromStorage(file: db.store.StoreFile) {
        await this.storageService.delete(file.fileId);
        if (file.thumb) {
            await this.storageService.delete(file.thumb.fileId);
        }
    }
    
    private clearFilesInStorage(files: db.store.StoreFile[]) {
        this.jobService.addJob(async () => {
            for (const file of files) {
                try {
                    await this.removeFileFromStorage(file);
                }
                catch {
                    this.logger.error(`Error during removing store file ${file.id}`);
                }
            }
        }, "Error during removing files from removed store");
    }
}

class StorePolicy extends BasePolicy<db.store.Store, db.store.StoreFile> {
    
    protected isItemCreator(user: db.context.ContextUser, file: db.store.StoreFile) {
        return file.author === user.userId;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.store || {};
    }
}
