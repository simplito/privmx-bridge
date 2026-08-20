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
import { AclFunctionNameX, CloudAclChecker } from "./CloudAclChecker";
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
        let ownGroupIds: types.group.GroupId[]|undefined;
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, async (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbGet", ["kvdbId=" + kvdbId]);
            ownGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canReadContainer(user, context, this.withGroupMembership(kvdb, user.userId, ownGroupIds))) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        const groupEpochs = await this.getGroupEpochs(kvdb.contextId, [kvdb]);
        return {kvdb, ownGroupIds, groupEpochs};
    }
    
    async getMyKvdbs(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, listParams: types.core.ListModel, sortBy: keyof db.kvdb.Kvdb, scope: types.core.ContainerAccessScope) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbList", []);
        if (scope === "ALL") {
            if (!this.policy.canListAllContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        else {
            if (!this.policy.canListMyContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        const ownGroupIds = await this.getCallerGroupIds(context.id, user.userId);
        const kvdbs = await this.repositoryFactory.createKvdbRepository().getPageByContextAndUser(contextId, type, user.userId, cloudUser.solutionId, listParams, sortBy, scope, ownGroupIds);
        const groupEpochs = await this.getGroupEpochs(contextId, kvdbs.list);
        return {user, kvdbs, ownGroupIds, groupEpochs};
    }
    
    async getAllKvdbs(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, listParams: types.core.ListModel, sortBy: keyof db.kvdb.Kvdb) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbListAll", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const ownGroupIds = await this.getCallerGroupIds(context.id, user.userId);
        const kvdbs = await this.repositoryFactory.createKvdbRepository().getAllKvdbs(contextId, type, listParams, sortBy);
        const groupEpochs = await this.getGroupEpochs(contextId, kvdbs.list);
        return {user, kvdbs, ownGroupIds, groupEpochs};
    }
    
    async createKvdb(cloudUser: CloudUser, resourceId: types.core.ClientResourceId, contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.kvdb.KvdbData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerPolicy, groups: types.cloud.GroupGrant[] = [], groupKeys: types.cloud.GroupKeyEntrySet[] = []) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        const newGroupKeys = await this.cloudKeyService.checkGroupKeysAndGrantees(contextId, [keyId], [], groupKeys, keyId, groups.map(g => g.groupId));
        try {
            const kvdb = await this.repositoryFactory.createKvdbRepository().createKvdb(contextId, resourceId, type, user.userId, managers, users, data, keyId, newKeys, policy, {groups, groupKeys: newGroupKeys});
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
    
    async updateKvdb(cloudUser: CloudUser, id: types.kvdb.KvdbId, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.kvdb.KvdbData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.kvdb.KvdbVersion, force: boolean, policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId, groups: types.cloud.GroupGrant[] = [], groupKeys: types.cloud.GroupKeyEntrySet[] = []) {
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
            const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            this.policy.makeUpdateContainerCheck(user, context, this.withGroupMembership(oldKvdb, user.userId, userGroupIds), managers, policy);
            const currentVersion = <types.kvdb.KvdbVersion>oldKvdb.history.length;
            if (currentVersion !== version && !force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            const availableKeyIds = [...oldKvdb.history.map(x => x.keyId), keyId];
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldKvdb.contextId, availableKeyIds, oldKvdb.keys, keys, keyId, users, managers);
            const newGroupKeys = await this.cloudKeyService.checkGroupKeysAndGrantees(oldKvdb.contextId, availableKeyIds, oldKvdb.groupKeys || [], groupKeys, keyId, groups.map(g => g.groupId));
            if (oldKvdb.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            const kvdb = await kvdbRepository.updateKvdb(oldKvdb, user.userId, managers, users, data, keyId, newKeys, policy, {groups, groupKeys: newGroupKeys});
            return {kvdb, context, oldKvdb};
        });
        const updatedStoreUsers = rKvdb.managers.concat(rKvdb.users);
        const deletedUsers = old.managers.concat(old.users).filter(u => !updatedStoreUsers.includes(u));
        const additionalUsersToNotify = await this.getUsersWithStatus(deletedUsers, usedContext.id, usedContext.solution);
        this.kvdbNotificationService.sendKvdbUpdated(rKvdb, usedContext.solution, additionalUsersToNotify);
        return rKvdb;
    }
    
    async rotateKvdbKeys(cloudUser: CloudUser, id: types.kvdb.KvdbId, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], groupKeys: types.cloud.GroupKeyEntrySet[], version: types.kvdb.KvdbVersion, force: boolean) {
        const {kvdb: rKvdb, context: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const kvdbRepository = this.repositoryFactory.createKvdbRepository(session);
            const oldKvdb = await kvdbRepository.get(id);
            if (!oldKvdb) {
                throw new AppException("KVDB_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldKvdb.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbRotateKeys", ["kvdbId=" + id]);
            const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canRotateContainerKeys(user, context, this.withGroupMembership(oldKvdb, user.userId, userGroupIds))) {
                throw new AppException("ACCESS_DENIED");
            }
            const currentVersion = <types.kvdb.KvdbVersion>oldKvdb.history.length;
            if (currentVersion !== version && !force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            const availableKeyIds = [...oldKvdb.history.map(x => x.keyId), keyId];
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldKvdb.contextId, availableKeyIds, oldKvdb.keys, keys, keyId, oldKvdb.users, oldKvdb.managers);
            const newGroupKeys = await this.cloudKeyService.checkGroupKeysAndGrantees(oldKvdb.contextId, availableKeyIds, oldKvdb.groupKeys || [], groupKeys, keyId, (oldKvdb.groups || []).map(g => g.groupId));
            const kvdb = await kvdbRepository.updateKvdb(oldKvdb, user.userId, oldKvdb.managers, oldKvdb.users, oldKvdb.data, keyId, newKeys, undefined, {groups: oldKvdb.groups || [], groupKeys: newGroupKeys});
            return {kvdb, context};
        });
        this.kvdbNotificationService.sendKvdbUpdated(rKvdb, usedContext.solution, []);
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
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, oldKvdb.contextId, async (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbDelete", ["kvdbId=" + id]);
                const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
                if (!this.policy.canDeleteContainer(user, context, this.withGroupMembership(oldKvdb, user.userId, userGroupIds))) {
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
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, async (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbDeleteMany", []);
                const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
                additionalAccessCheck = kvdb => this.policy.canDeleteContainer(user, context, this.withGroupMembership(kvdb, user.userId, userGroupIds));
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
        this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbEntrySet", ["kvdbId=" + kvdbId, "entryKey=" + kvdbEntryKey]);
        if (kvdb.keyId !== keyId) {
            throw new AppException("INVALID_KEY_ID");
        }
        await this.checkGroupEpochs(kvdb, this.policy.isForwardSecrecyEnforced(context, kvdb));
        const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
        const groupAwareKvdb = this.withGroupMembership(kvdb, user.userId, userGroupIds);
        const item = await (async () => {
            const entryRepository = this.repositoryFactory.createKvdbEntryRepository();
            const entry = await entryRepository.get(kvdbId, kvdbEntryKey);
            
            if (!entry && (version === 0 || force)) {
                if (!this.policy.canCreateItem(user, context, groupAwareKvdb)) {
                    throw new AppException("ACCESS_DENIED");
                }
                return await entryRepository.createEntry(kvdbEntryKey, user.userId, kvdbId, kvdbEntryValue, keyId);
            }
            if (!entry) {
                throw new AppException("INVALID_VERSION", "Creating a new entry without the 'force' option is only allowed when the version is 0 or not specified.");
            }
            if (!force && entry.version !== version) {
                throw new AppException("INVALID_VERSION", "Version missmatch");
            }
            if (!this.policy.canUpdateItem(user, context, groupAwareKvdb, entry)) {
                throw new AppException("ACCESS_DENIED");
            }
            return await entryRepository.updateEntry(entry, user.userId, kvdbEntryValue, keyId);
        })();
        
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
        const result = await this.tryGetKvdbEntry(executor, kvdbId, entryKey, "kvdb/kvdbEntryGet");
        if (!result) {
            throw new AppException("KVDB_ENTRY_DOES_NOT_EXIST");
        }
        return result;
    }
    
    async findKvdbEntry(executor: Executor, kvdbId: types.kvdb.KvdbId, entryKey: types.kvdb.KvdbEntryKey) {
        return this.tryGetKvdbEntry(executor, kvdbId, entryKey, "kvdb/kvdbEntryFind");
    }
    
    private async tryGetKvdbEntry(executor: Executor, kvdbId: types.kvdb.KvdbId, entryKey: types.kvdb.KvdbEntryKey, aclFunction: AclFunctionNameX) {
        const item = await this.repositoryFactory.createKvdbEntryRepository().get(kvdbId, entryKey);
        if (!item) {
            return null;
        }
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(item.kvdbId);
        if (!kvdb) {
            throw new DbInconsistencyError(`kvdb=${item.kvdbId} does not exist, from item=${entryKey}`);
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, async (user, context) => {
            const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canReadItem(user, context, this.withGroupMembership(kvdb, user.userId, userGroupIds), item)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, aclFunction, ["kvdbId=" + kvdb.id, "entryKey=" + entryKey]);
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
        const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, async (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbEntryDelete", ["itemId=" + entryKey, "kvdbId=" + kvdb.id]);
            const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canDeleteItem(user, context, this.withGroupMembership(kvdb, user.userId, userGroupIds), item)) {
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
        let ownGroupIds: types.group.GroupId[]|undefined;
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, async (user, context) => {
            ownGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canListAllItems(user, context, this.withGroupMembership(kvdb, user.userId, ownGroupIds))) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbListKeys", ["kvdbId=" + kvdbId]);
        });
        listParams.lastId = listParams.lastId ? `${kvdbId}:${listParams.lastId}` : undefined;
        const items = await this.repositoryFactory.createKvdbEntryRepository().getPageByKvdb(kvdbId, listParams);
        const groupEpochs = await this.getGroupEpochs(kvdb.contextId, [kvdb]);
        return {kvdb, items, ownGroupIds, groupEpochs};
    }
    
    async getKvdbEntriesKeysWithListModel2(executor: Executor, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel2<types.kvdb.KvdbEntryKey>) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, async (user, context) => {
            const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canListAllItems(user, context, this.withGroupMembership(kvdb, user.userId, userGroupIds))) {
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
    
    async getKvdbEntries(executor: CloudUser, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel, sortBy: keyof db.kvdb.KvdbEntry) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        let ownGroupIds: types.group.GroupId[]|undefined;
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, async (user, context) => {
            ownGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canListAllItems(user, context, this.withGroupMembership(kvdb, user.userId, ownGroupIds))) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "kvdb/getKvdbEntries", ["kvdbId=" + kvdbId]);
        });
        listParams.lastId = listParams.lastId ? `${kvdbId}:${listParams.lastId}` : undefined;
        const items = await this.repositoryFactory.createKvdbEntryRepository().getPageByKvdbWithPrefix(kvdbId, listParams, sortBy);
        const groupEpochs = await this.getGroupEpochs(kvdb.contextId, [kvdb]);
        return {kvdb, items, ownGroupIds, groupEpochs};
    }
    
    async getKvdbEntriesWithPlainUser(executor: Executor, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel2<types.kvdb.KvdbEntryKey>, prefix: string|undefined) {
        const kvdb = await this.repositoryFactory.createKvdbRepository().get(kvdbId);
        if (!kvdb) {
            throw new AppException("KVDB_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, kvdb.contextId, async (user, context) => {
            const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
            if (!this.policy.canListAllItems(user, context, this.withGroupMembership(kvdb, user.userId, userGroupIds))) {
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
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, async (user, context) => {
                if (checkAccess) {
                    this.cloudAclChecker.verifyAccess(user.acl, "kvdb/kvdbEntryDeleteMany", ["kvdbId=" + kvdbId]);
                }
                const userGroupIds = await this.getCallerGroupIds(context.id, user.userId);
                const groupAwareKvdb = this.withGroupMembership(kvdb, user.userId, userGroupIds);
                additionalAccessCheck = item => this.policy.canDeleteItem(user, context, groupAwareKvdb, item);
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
