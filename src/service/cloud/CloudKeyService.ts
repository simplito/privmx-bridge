/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppException } from "../../api/AppException";
import { Utils } from "../../utils/Utils";
import * as types from "../../types";
import { RepositoryFactory } from "../../db/RepositoryFactory";

export class CloudKeyService {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    checkKeysAndUsersDuringCreation(contextId: types.context.ContextId, inserts: types.cloud.KeyEntrySet[], keyId: types.core.KeyId, users: types.cloud.UserId[], managers: types.cloud.UserId[]) {
        return this.checkKeysAndClients(contextId, [keyId], [], inserts, keyId, users, managers);
    }
    
    async checkKeysAndClients(
        contextId: types.context.ContextId,
        availableKeyIds: types.core.KeyId[],
        oldKeys: types.cloud.UserKeysEntry[],
        inserts: types.cloud.KeyEntrySet[],
        keyId: types.core.KeyId,
        users: types.cloud.UserId[],
        managers: types.cloud.UserId[],
    ) {
        if (!Utils.isUnique(users)) {
            throw new AppException("INVALID_PARAMS", "users not unique");
        }
        if (!Utils.isUnique(managers)) {
            throw new AppException("INVALID_PARAMS", "managers not unique");
        }
        const allUsers = Utils.unique(users.concat(managers));
        if (allUsers.length === 0) {
            throw new AppException("INVALID_PARAMS", "there has to be at least one user or manager");
        }
        const allClients = [...allUsers];
        await this.checkUsersExistance(contextId, allUsers);
        const newKeys = this.buildKeys(availableKeyIds, oldKeys, inserts);
        this.verifyThatOnlyGivenClientsHaveAccess(newKeys, keyId, allClients);
        return newKeys;
    }
    
    buildKeys(availableKeyIds: types.core.KeyId[], oldKeys: types.cloud.UserKeysEntry[], inserts: types.cloud.KeyEntrySet[]) {
        if (!Utils.isUnique(inserts.map(x => x.user + "/" + x.keyId))) {
            throw new AppException("INVALID_PARAMS", "Some key entries are duplicated");
        }
        const newKeys = oldKeys.map(x => {
            const res: types.cloud.UserKeysEntry = {
                user: x.user,
                keys: x.keys.slice(),
            };
            return res;
        });
        for (const insert of inserts) {
            if (!availableKeyIds.includes(insert.keyId)) {
                throw new AppException("INVALID_KEY_ID");
            }
            let userEntry = newKeys.find(x => x.user === insert.user);
            if (!userEntry) {
                userEntry = {user: insert.user, keys: []};
                newKeys.push(userEntry);
            }
            const keyEntry = userEntry.keys.find(x => x.keyId === insert.keyId);
            if (!keyEntry) {
                userEntry.keys.push({keyId: insert.keyId, data: insert.data});
            }
            else {
                keyEntry.data = insert.data;
            }
        }
        return newKeys;
    }
    
    verifyThatOnlyGivenClientsHaveAccess(keys: types.cloud.UserKeysEntry[], keyId: types.core.KeyId, clients: types.cloud.UserId[]) {
        for (const user of clients) {
            const userEntry = keys.find(x => x.user === user);
            if (!userEntry) {
                throw new AppException("INVALID_PARAMS", `user '${user}' has not access to key '${keyId}'`);
            }
            const keyEntry = userEntry.keys.find(x => x.keyId === keyId);
            if (!keyEntry) {
                throw new AppException("INVALID_PARAMS", `user '${user}' has not access to key '${keyId}'`);
            }
        }
        for (const userEntry of keys) {
            const hasAccess = userEntry.keys.some(x => x.keyId === keyId);
            if (hasAccess && !clients.includes(userEntry.user)) {
                throw new AppException("INVALID_PARAMS", `user '${userEntry.user}' should not have access to key '${keyId}'`);
            }
        }
    }
    
    hasRemovedClients(oldClients: types.cloud.UserId[], newClients: types.cloud.UserId[]) {
        return oldClients.some(x => !newClients.includes(x));
    }
    
    /**
     * Verifies and builds the per-group key blobs of a container (the container key encrypted to each
     * group grantee's pubkey). Mirrors checkKeysAndClients but keyed by group instead of user.
     * Also enforces per-epoch coverage (BR-5): the submitted groupEpoch for each grantee must match
     * the group's current keyVersion, preventing re-key to a stale epoch.
     */
    async checkGroupKeysAndGrantees(
        contextId: types.context.ContextId,
        availableKeyIds: types.core.KeyId[],
        oldGroupKeys: types.cloud.GroupKeysEntry[],
        inserts: types.cloud.GroupKeyEntrySet[],
        keyId: types.core.KeyId,
        groupIds: types.group.GroupId[],
    ) {
        if (!Utils.isUnique(groupIds)) {
            throw new AppException("INVALID_PARAMS", "groups not unique");
        }
        await this.repositoryFactory.createGroupRepository().checkGroupsExistence(contextId, groupIds);
        const newGroupKeys = this.buildGroupKeys(availableKeyIds, oldGroupKeys, inserts);
        this.verifyThatOnlyGivenGroupsHaveAccess(newGroupKeys, keyId, groupIds);
        if (groupIds.length > 0) {
            await this.verifyGroupEpochCoverage(contextId, groupIds, inserts, keyId);
        }
        return newGroupKeys;
    }
    
    private async verifyGroupEpochCoverage(
        contextId: types.context.ContextId,
        groupIds: types.group.GroupId[],
        inserts: types.cloud.GroupKeyEntrySet[],
        keyId: types.core.KeyId,
    ) {
        const groupRepo = this.repositoryFactory.createGroupRepository();
        const currentVersions = await groupRepo.getKeyVersions(contextId, groupIds);
        for (const groupId of groupIds) {
            const currentVersion = currentVersions.get(groupId) ?? 1;
            const insert = inserts.find(i => i.group === groupId && i.keyId === keyId);
            if (!insert) {
                // No NEW key entry for this group at this keyId (the keyId is being reused, the group's existing
                // entry stands). Only freshly-submitted entries are epoch-checked. A re-key (new keyId) that
                // omits a grantee fails earlier in verifyThatOnlyGivenGroupsHaveAccess.
                continue;
            }
            if (insert.groupEpoch === undefined) {
                // Mandatory (Option A) — every new group key entry must declare the epoch it was wrapped to, so
                // a grant/re-key can never silently target a stale epoch. The validator also enforces this; this
                // is defense-in-depth for any non-validated caller.
                throw new AppException("INVALID_PARAMS", `groupEpoch is required for group '${groupId}' key entry`);
            }
            if (insert.groupEpoch !== currentVersion) {
                throw new AppException("INVALID_PARAMS", `stale groupEpoch for group '${groupId}': got ${insert.groupEpoch}, current is ${currentVersion}`);
            }
        }
    }
    
    buildGroupKeys(availableKeyIds: types.core.KeyId[], oldGroupKeys: types.cloud.GroupKeysEntry[], inserts: types.cloud.GroupKeyEntrySet[]) {
        if (!Utils.isUnique(inserts.map(x => x.group + "/" + x.keyId))) {
            throw new AppException("INVALID_PARAMS", "Some group key entries are duplicated");
        }
        const newGroupKeys = oldGroupKeys.map(x => ({
            group: x.group,
            keys: x.keys.slice(),
        }));
        for (const insert of inserts) {
            if (!availableKeyIds.includes(insert.keyId)) {
                throw new AppException("INVALID_KEY_ID");
            }
            let groupEntry = newGroupKeys.find(x => x.group === insert.group);
            if (!groupEntry) {
                groupEntry = {group: insert.group, keys: []};
                newGroupKeys.push(groupEntry);
            }
            const keyEntry = groupEntry.keys.find(x => x.keyId === insert.keyId);
            if (!keyEntry) {
                groupEntry.keys.push({keyId: insert.keyId, data: insert.data, groupEpoch: insert.groupEpoch});
            }
            else {
                keyEntry.data = insert.data;
                keyEntry.groupEpoch = insert.groupEpoch;
            }
        }
        return newGroupKeys;
    }
    
    verifyThatOnlyGivenGroupsHaveAccess(groupKeys: types.cloud.GroupKeysEntry[], keyId: types.core.KeyId, groups: types.group.GroupId[]) {
        for (const group of groups) {
            const groupEntry = groupKeys.find(x => x.group === group);
            if (!groupEntry || !groupEntry.keys.some(x => x.keyId === keyId)) {
                throw new AppException("INVALID_PARAMS", `group '${group}' has not access to key '${keyId}'`);
            }
        }
        for (const groupEntry of groupKeys) {
            const hasAccess = groupEntry.keys.some(x => x.keyId === keyId);
            if (hasAccess && !groups.includes(groupEntry.group)) {
                throw new AppException("INVALID_PARAMS", `group '${groupEntry.group}' should not have access to key '${keyId}'`);
            }
        }
    }
    
    async checkUsersExistance(contextId: types.context.ContextId, users: types.cloud.UserId[]) {
        const existingUsersCount = await this.repositoryFactory.createContextUserRepository().getCountOfExistingUsersFromList(users, contextId);
        if (existingUsersCount !== users.length) {
            throw new AppException("USER_DOESNT_EXIST", "at least one of users does not exist");
        }
    }
}
