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
import { KvdbNotificationService } from "./KvdbNotificationService";
import { CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbDuplicateError } from "../../error/DbDuplicateError";
import { BasePolicy } from "./BasePolicy";
import { DbInconsistencyError } from "../../error/DbInconsistencyError";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { BaseContainerService } from "./BaseContainerService";

export class KvdbService extends BaseContainerService {
    
    private policy: KvdbPolicy;
    
    constructor(
        repositoryFactory: RepositoryFactory,
        host: types.core.Host,
        activeUsersMap: ActiveUsersMap,
        private cloudKeyService: CloudKeyService,
        private kvdbNotificationService: KvdbNotificationService,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
    ) {
        super(repositoryFactory, activeUsersMap, host);
        this.policy = new KvdbPolicy(this.policyService);
    }
    
    async getKvdb(executor: Executor, kvdbId: types.kvdb.KvdbId, type: types.kvdb.KvdbType|undefined) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb || (type && kvdb.type !== type)) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbGet", ["kvdbId=" + kvdbId]);
            if (!this.policy.canReadContainer(user, context, kvdb)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        return kvdb;
    }
    
    async getMyKvdbs(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, listParams: types.core.ListModel, sortBy: keyof db.kvdb.Kvdb) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbList", []);
        if (!this.policy.canListMyContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const kvdbs = await this.repositoryFactory.createKvdbRepository().getPageByContextAndUser(contextId, type, user.userId, cloudUser.solutionId, listParams, sortBy);
        return {user, kvdbs};
    }
    
    async getAllKvdbs(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, listParams: types.core.ListModel, sortBy: keyof db.kvdb.Kvdb) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbListAll", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const kvdbs = await this.repositoryFactory.createKvdbRepository().getAllKvdbs(contextId, type, listParams, sortBy);
        return {user, kvdbs};
    }
    
    async createKvdb(cloudUser: CloudUser, resourceId: types.core.ClientResourceId, contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.kvdb.KvdbData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerPolicy) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        try {
            const kvdb = await this.repositoryFactory.createKvdbRepository().createKvdb(contextId, resourceId, type, user.userId, managers, users, data, keyId, newKeys, policy);
            this.kvdbNotificationService.sendKvdbCreated(kvdb, context.solution);
            return kvdb;
        }
        catch (err) {
            if (err instanceof DbDuplicateError) {
                throw new AppException("DUPLICATE_RESOURCE_ID");
            }
            throw err;
        }
    }
    
    async updateKvdb(cloudUser: CloudUser, id: types.kvdb.KvdbId, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.kvdb.KvdbData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.kvdb.KvdbVersion, force: boolean, policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        const {kvdb: rKvdb, context: usedContext, oldKvdb: old} = await this.repositoryFactory.withTransaction(async session => {
            const kvdbRepository = this.repositoryFactory.createKvdbRepository(session);
            const oldKvdb = await kvdbRepository.get(id);
            if (!oldKvdb) {
                throw new AppException("KVDB_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldKvdb.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbUpdate", ["kvdbId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldKvdb, managers, policy);
            const currentVersion = <types.kvdb.KvdbVersion>oldKvdb.history.length;
            if (currentVersion !== version && !force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldKvdb.contextId, [...oldKvdb.history.map(x => x.keyId), keyId], oldKvdb.keys, keys, keyId, users, managers);
            if (oldKvdb.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            const kvdb = await kvdbRepository.updateKvdb(oldKvdb, user.userId, managers, users, data, keyId, newKeys, policy);
            return {kvdb, context, oldKvdb};
        });
        const updatedStoreUsers = rKvdb.managers.concat(rKvdb.users);
        const deletedUsers = old.managers.concat(old.users).filter(u => !updatedStoreUsers.includes(u));
        const additionalUsersToNotify = await this.getUsersWithStatus(deletedUsers, usedContext.id, usedContext.solution);
        this.kvdbNotificationService.sendKvdbUpdated(rKvdb, usedContext.solution, additionalUsersToNotify);
        return rKvdb;
    }
    
    async deleteKvdb(executor: Executor, id: types.kvdb.KvdbId) {
        const result = await this.repositoryFactory.withTransaction(async session => {
            const kvdbRepository = this.repositoryFactory.createKvdbRepository(session);
            const kvdbEntryRepository = this.repositoryFactory.createKvdbEntryRepository(session);
            const oldKvdb = await kvdbRepository.get(id);
            if (!oldKvdb) {
                throw new AppException("KVDB_DOES_NOT_EXIST");
            }
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, oldKvdb.contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbDelete", ["kvdbId=" + id]);
                if (!this.policy.canDeleteContainer(user, context, oldKvdb)) {
                    throw new AppException("ACCESS_DENIED");
                }
            });
            await kvdbRepository.deleteKvdb(oldKvdb.id);
            await kvdbEntryRepository.deleteAllFromKvdb(oldKvdb.id);
            return {oldKvdb, context: usedContext};
        });
        this.kvdbNotificationService.sendKvdbDeleted(result.oldKvdb, result.context.solution);
        return result.oldKvdb;
    }
    
    async deleteManyKvdbs(executor: Executor, kvdbIds: types.kvdb.KvdbId[]) {
        const resultMap: Map<types.kvdb.KvdbId, "OK" | "KVDB_DOES_NOT_EXIST" | "ACCESS_DENIED"> = new Map();
        for (const id of kvdbIds) {
            resultMap.set(id, "KVDB_DOES_NOT_EXIST");
        }
        
        const result = await this.repositoryFactory.withTransaction(async session => {
            const kvdbRepository = this.repositoryFactory.createKvdbRepository(session);
            const kvdbEntryRepository = this.repositoryFactory.createKvdbEntryRepository(session);
            const kvdbs = await kvdbRepository.getMany(kvdbIds);
            if (kvdbs.length === 0) {
                return {contextId: null, toNotify: []};
            }
            const contextId = kvdbs[0].contextId;
            let additionalAccessCheck: ((kvdb: db.kvdb.Kvdb) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbDeleteMany", []);
                additionalAccessCheck = kvdb => this.policy.canDeleteContainer(user, context, kvdb);
            });
            const toDelete: types.kvdb.KvdbId[] = [];
            const toNotify: db.kvdb.Kvdb[] = [];
            for (const kvdb of kvdbs) {
                if (kvdb.contextId !== contextId) {
                    throw new AppException("RESOURCES_HAVE_DIFFERENT_CONTEXTS");
                }
                if (!additionalAccessCheck(kvdb)) {
                    resultMap.set(kvdb.id, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(kvdb.id, "OK");
                    toDelete.push(kvdb.id);
                    toNotify.push(kvdb);
                }
            }
            await kvdbRepository.deleteManyKvdbs(toDelete);
            await kvdbEntryRepository.deleteAllFromKvdbs(toDelete);
            return {contextId, toNotify, usedContext};
        });
        if (result.usedContext) {
            for (const deletedKvdb of result.toNotify) {
                this.kvdbNotificationService.sendKvdbDeleted(deletedKvdb, result.usedContext.solution);
            }
        }
        
        const resultArray: types.kvdb.KvdbDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({id, status});
        }
        
        return {contextId: result.contextId, results: resultArray};
    }
    
    async getKvdbsByContext(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel2<types.kvdb.KvdbId>) {
        const ctx = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!ctx) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, ctx, (user, context) => {
            if (!this.policy.canListAllContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbList", []);
        });
        const kvdbs = await this.repositoryFactory.createKvdbRepository().getPage(contextId, listParams);
        return kvdbs;
    }
    
    async setItem(cloudUser: CloudUser, kvdbId: types.kvdb.KvdbId, kvdbEntryKey: types.kvdb.KvdbEntryKey, kvdbEntryValue: types.kvdb.KvdbEntryValue, keyId: types.core.KeyId, version: types.kvdb.KvdbEntryVersion, force: boolean|undefined) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, kvdb.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbEntrySet", ["kvdbId=" + kvdbId]);
        if (!this.policy.canCreateItem(user, context, kvdb)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (kvdb.keyId !== keyId) {
            throw new AppException("INVALID_KEY_ID");
        }
        const item = await this.validateVersionAndUpdateEntry(kvdbEntryKey, user.userId, kvdbId, kvdbEntryValue, keyId, version, !!force);
        await this.repositoryFactory.createKvdbRepository().increaseEntryCounter(kvdb.id, item.createDate);
        if (item.version === 1) {
            this.kvdbNotificationService.sendNewKvdbEntry(kvdb, item, context.solution);
        }
        else {
            this.kvdbNotificationService.sendUpdatedKvdbEntry(kvdb, item, context.solution);
        }
        const kvdbStats = await this.repositoryFactory.createKvdbRepository().getKvdbStats(kvdb.id);
        if (kvdbStats) {
            this.kvdbNotificationService.sendKvdbStats({...kvdb, ...kvdbStats}, context.solution);
        }
        return {kvdb, item};
    }
    
    async getKvdbEntry(executor: Executor, kvdbId: types.kvdb.KvdbId, entryKey: types.kvdb.KvdbEntryKey) {
        const item = await this.repositoryFactory.createKvdbEntryRepository().get(kvdbId, entryKey);
        if (!item) {
            throw new AppException("KVDB_ENTRY_DOES_NOT_EXIST");
        }
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(item.kvdbId);
        if (!kvdb) {
            throw new DbInconsistencyError(`kvdb=${item.kvdbId} does not exist, from item=${entryKey}`);
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, (user, context) => {
            if (!this.policy.canReadItem(user, context, kvdb, item)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbEntryGet", ["kvdbId=" + kvdb.id, "entryKey=" + entryKey]);
        });
        return {kvdb, item};
    }
    
    async deleteItem(executor: Executor, kvdbId: types.kvdb.KvdbId, entryKey: types.kvdb.KvdbEntryKey) {
        const item = await this.repositoryFactory.createKvdbEntryRepository().get(kvdbId, entryKey);
        if (!item) {
            throw new AppException("KVDB_ENTRY_DOES_NOT_EXIST");
        }
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(item.kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbEntryDelete", ["itemId=" + entryKey, "kvdbId=" + kvdb.id]);
            if (!this.policy.canDeleteItem(user, context, kvdb, item)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        await this.repositoryFactory.createKvdbEntryRepository().deleteEntry(kvdbId, entryKey);
        const lastItemDate = await this.repositoryFactory.createKvdbEntryRepository().getLastEntryDate(kvdb.id);
        await this.repositoryFactory.createKvdbRepository().decreaseEntryCounter(kvdb.id, lastItemDate || kvdb.createDate);
        this.kvdbNotificationService.sendDeletedKvdbEntry(kvdb, item, usedContext.solution);
        const kvdbStats = await this.repositoryFactory.createKvdbRepository().getKvdbStats(kvdb.id);
        if (kvdbStats) {
            this.kvdbNotificationService.sendKvdbStats({...kvdb, ...kvdbStats}, usedContext.solution);
        }
        return {kvdb, item};
    }
    
    async getKvdbEntriesKeys(executor: CloudUser, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, kvdb)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbListKeys", ["kvdbId=" + kvdbId]);
        });
        const items = await this.repositoryFactory.createKvdbEntryRepository().getPageByKvdb(kvdbId, listParams);
        return {kvdb, items};
    }
    
    async getKvdbEntriesKeysWithListModel2(executor: Executor, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel2<types.kvdb.KvdbEntryKey>) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, kvdb)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbListKeys", ["kvdbId=" + kvdbId]);
        });
        const kvdbListParams: types.core.ListModel2<types.kvdb.KvdbEntryId> = {
            from: listParams.from ? `${kvdbId}:${listParams.from}` as types.kvdb.KvdbEntryId : null,
            limit: listParams.limit,
            sortOrder: listParams.sortOrder,
        };
        const items = await this.repositoryFactory.createKvdbEntryRepository().getPageByKvdbMatch2(kvdbId, kvdbListParams);
        return {kvdb, items};
    }
    
    async getKvdbEntries(executor: CloudUser, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel, sortBy: keyof db.kvdb.KvdbEntry, lastKey: string|undefined, prefix: string|undefined) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, kvdb)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/getKvdbEntries", ["kvdbId=" + kvdbId]);
        });
        listParams.lastId = lastKey ? `${kvdbId}:${lastKey}` : undefined;
        const items = await this.repositoryFactory.createKvdbEntryRepository().getPageByKvdbWithPrefix(kvdbId, listParams, sortBy, prefix);
        return {kvdb, items};
    }
    
    async getKvdbEntriesWithPlainUser(executor: Executor, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel2<types.kvdb.KvdbEntryKey>, prefix: string|undefined) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, (user, context) => {
            if (!this.policy.canListAllItems(user, context, kvdb)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/getKvdbEntries", ["kvdbId=" + kvdbId]);
        });
        const kvdbListParams: types.core.ListModel2<types.kvdb.KvdbEntryId> = {
            from: listParams.from ? `${kvdbId}:${listParams.from}` as types.kvdb.KvdbEntryId : null,
            limit: listParams.limit,
            sortOrder: listParams.sortOrder,
        };
        const items = await this.repositoryFactory.createKvdbEntryRepository().getPageByKvdbWithPrefixMatch2(kvdbId, kvdbListParams, prefix);
        return {kvdb, items};
    }
    
    async validateVersionAndUpdateEntry(kvdbEntryKey: types.kvdb.KvdbEntryKey, userId: types.cloud.UserId, kvdbId: types.kvdb.KvdbId, kvdbEntryValue: types.kvdb.KvdbEntryValue, keyId: types.core.KeyId, version: types.kvdb.KvdbEntryVersion, force: boolean) {
        const entryRepository = this.repositoryFactory.createKvdbEntryRepository();
        const entry = await entryRepository.get(kvdbId, kvdbEntryKey);
        if (!entry && (version === 0 || force)) {
            return await entryRepository.createEntry(kvdbEntryKey, userId, kvdbId, kvdbEntryValue, keyId);
        }
        if (!entry) {
              throw new AppException("INVALID_VERSION", "Creating a new entry without the 'force' option is only allowed when the version is 0 or not specified.");
        }
        if (!force && entry.version !== version) {
            throw new AppException("INVALID_VERSION", "Version missmatch");
        }
        return await entryRepository.updateEntry(entry, userId, kvdbEntryValue, keyId);
    }
    
    async deleteManyItems(executor: Executor, kvdbId: types.kvdb.KvdbId, entryKeys: types.kvdb.KvdbEntryKey[], checkAccess = true) {
        const resultMap: Map<types.kvdb.KvdbEntryKey, "OK" | "KVDB_ENTRY_DOES_NOT_EXIST" | "ACCESS_DENIED"> = new Map();
        for (const key of entryKeys) {
            resultMap.set(key, "KVDB_ENTRY_DOES_NOT_EXIST");
        }
        const result = await this.repositoryFactory.withTransaction(async session => {
            const kvdbRepository = this.repositoryFactory.createKvdbRepository();
            const kvdb = await kvdbRepository.get(kvdbId);
            if (!kvdb) {
                throw new AppException("KVDB_DOES_NOT_EXIST");
            }
            const kvdbEntryRepository = this.repositoryFactory.createKvdbEntryRepository(session);
            const items = await kvdbEntryRepository.getMany(kvdbId, entryKeys);
            if (items.length === 0) {
                return {context: null, toNotify: [], kvdb: null, kvdbStats: null};
            }
            const contextId = kvdb.contextId;
            let additionalAccessCheck: ((item: db.kvdb.KvdbEntry) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                if (checkAccess) {
                    this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbEntryDeleteMany", ["kvdbId=" + kvdbId]);
                }
                additionalAccessCheck = item => this.policy.canDeleteItem(user, context, kvdb, item);
            });
            const toDelete: types.kvdb.KvdbEntryId[] = [];
            const toNotify: db.kvdb.KvdbEntry[] = [];
            for (const item of items) {
                if (!additionalAccessCheck(item)) {
                    resultMap.set(item.entryKey, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(item.entryKey, "OK");
                    toDelete.push(item.id);
                    toNotify.push(item);
                }
            }
            await kvdbEntryRepository.deleteManyEntries(toDelete);
            const lastItemDate = await kvdbEntryRepository.getLastEntryDate(kvdb.id);
            await kvdbRepository.decreaseEntryCounter(kvdb.id, lastItemDate || kvdb.createDate, toDelete.length);
            const kvdbStats = await this.repositoryFactory.createKvdbRepository().getKvdbStats(kvdb.id);
            return {context: usedContext, toNotify, kvdb: kvdb, kvdbStats};
        });
        if (result.kvdb && result.kvdbStats) {
            this.kvdbNotificationService.sendKvdbStats({...result.kvdb, ...result.kvdbStats}, result.context.solution);
            for (const deletedItem of result.toNotify) {
                this.kvdbNotificationService.sendDeletedKvdbEntry(result.kvdb, deletedItem, result.context.solution);
            }
        }
        
        const resultArray: types.kvdb.KvdbEntryDeleteStatus[] = [];
        for (const [kvdbEntryKey, status] of resultMap) {
            resultArray.push({kvdbEntryKey, status});
        }
        
        return {contextId: result.context ? result.context.id : null, results: resultArray};
    }
}

class KvdbPolicy extends BasePolicy<db.kvdb.Kvdb, db.kvdb.KvdbEntry> {
    
    protected isItemCreator(user: db.context.ContextUser, kvdbEntry: db.kvdb.KvdbEntry) {
        return kvdbEntry.author === user.userId;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.kvdb || {};
    }
}
