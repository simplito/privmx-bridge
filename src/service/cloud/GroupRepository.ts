/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as types from "../../types";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";
import { Utils } from "../../utils/Utils";
import { AppException } from "../../api/AppException";

export class GroupRepository {
    
    static readonly COLLECTION_NAME = "group";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.group.GroupId, db.group.Group>,
    ) {
    }
    
    async get(id: types.group.GroupId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.group.GroupId[]) {
        return this.repository.getMulti(ids);
    }
    
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.group.Group) {
        return this.repository.getMatchingPage<db.group.Group>([{$match: {contextId: contextId}}], listParams, sortBy);
    }
    
    /** Groups in the given context the user belongs to (member or manager) — used by Phase 2 grantee resolution. */
    async getGroupsOfUser(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        return this.repository.query(q => q.and(q.eq("contextId", contextId), q.or(q.includes("users", userId), q.includes("managers", userId)))).array();
    }
    
    /** Distinct member userIds across the given groups (union of users+managers) — used to expand grantees for notifications. */
    async getMembersOfGroups(groupIds: types.group.GroupId[]): Promise<types.cloud.UserId[]> {
        if (groupIds.length === 0) {
            return [];
        }
        const groups = await this.repository.getMulti(groupIds);
        const members = new Set<types.cloud.UserId>();
        for (const group of groups) {
            for (const u of group.users) {
                members.add(u);
            }
            for (const m of group.managers) {
                members.add(m);
            }
        }
        return [...members];
    }
    
    /** Verifies that all given groups exist in the given context (mirrors CloudKeyService.checkUsersExistance). */
    async checkGroupsExistence(contextId: types.context.ContextId, groupIds: types.group.GroupId[]) {
        if (groupIds.length === 0) {
            return;
        }
        const groups = await this.repository.getMulti(Utils.unique(groupIds));
        const existing = new Set(groups.filter(g => g.contextId === contextId).map(g => g.id));
        for (const id of groupIds) {
            if (!existing.has(id)) {
                throw new AppException("GROUP_DOES_NOT_EXIST", `group '${id}' does not exist in context`);
            }
        }
    }
    
    async deleteOneByOneByContext(contextId: types.context.ContextId, func: (group: db.group.Group) => Promise<void>) {
        while (true) {
            const groups = await this.repository.query(q => q.eq("contextId", contextId)).limit(100).array();
            if (groups.length === 0) {
                return;
            }
            for (const group of groups) {
                await this.deleteGroup(group.id);
                await func(group);
            }
        }
    }
    
    async createGroup(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId|null, type: types.group.GroupType|undefined,
        groupPubKey: types.cloud.GroupPubKey, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy) {
        const now = DateUtils.now();
        const entry: db.group.GroupHistoryEntry = {
            created: now,
            author: creator,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groupPubKey: groupPubKey,
        };
        const group: db.group.Group = {
            id: this.repository.generateId() as types.group.GroupId,
            contextId: contextId,
            type: type,
            groupPubKey: groupPubKey,
            creator: entry.author,
            createDate: entry.created,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            history: [entry],
            allTimeUsers: Utils.uniqueFromArrays(entry.users, entry.managers),
            policy: policy,
        };
        if (resourceId) {
            group.clientResourceId = resourceId;
        }
        await this.repository.insert(group);
        return group;
    }
    
    async updateGroup(oldGroup: db.group.Group, modifier: types.cloud.UserId, groupPubKey: types.cloud.GroupPubKey, managers: types.cloud.UserId[],
        users: types.cloud.UserId[], data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[],
        policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
        const entry: db.group.GroupHistoryEntry = {
            created: DateUtils.now(),
            author: modifier,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groupPubKey: groupPubKey,
        };
        const updatedGroup: db.group.Group = {
            id: oldGroup.id,
            contextId: oldGroup.contextId,
            type: oldGroup.type,
            groupPubKey: entry.groupPubKey,
            creator: oldGroup.creator,
            createDate: oldGroup.createDate,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            history: [...oldGroup.history, entry],
            allTimeUsers: Utils.uniqueFromArrays(oldGroup.allTimeUsers, entry.users, entry.managers),
            policy: policy === undefined ? oldGroup.policy : policy,
        };
        // A membership/metadata update does NOT rotate the key epoch — carry it forward unchanged.
        // (Rotation is done by generateNewGroupKey, which bumps keyVersion via casRotate.)
        if (oldGroup.keyVersion !== undefined) {
            updatedGroup.keyVersion = oldGroup.keyVersion;
        }
        if (oldGroup.keyHistory !== undefined) {
            updatedGroup.keyHistory = oldGroup.keyHistory;
        }
        if (resourceId && !oldGroup.clientResourceId) {
            updatedGroup.clientResourceId = resourceId;
        }
        else if (oldGroup.clientResourceId) {
            updatedGroup.clientResourceId = oldGroup.clientResourceId;
        }
        await this.repository.update(updatedGroup);
        return updatedGroup;
    }
    
    async deleteGroup(id: types.group.GroupId) {
        return this.repository.delete(id);
    }
    
    getKeyVersion(group: db.group.Group): number {
        return group.keyVersion ?? 1;
    }
    
    async getKeyVersions(contextId: types.context.ContextId, groupIds: types.group.GroupId[]): Promise<Map<types.group.GroupId, number>> {
        if (groupIds.length === 0) {
            return new Map();
        }
        const groups = await this.repository.getMulti(groupIds);
        const map = new Map<types.group.GroupId, number>();
        for (const g of groups) {
            if (g.contextId === contextId) {
                map.set(g.id, this.getKeyVersion(g));
            }
        }
        return map;
    }
    
    /** Atomically replace the group document only if keyVersion matches (compare-and-swap).
     *  Returns the updated group on success, null on CAS miss. */
    async casRotate(oldGroup: db.group.Group, expectedKeyVersion: number, updatedGroup: db.group.Group): Promise<db.group.Group | null> {
        const filter: Record<string, unknown> = {_id: oldGroup.id};
        if (expectedKeyVersion === 1) {
            filter.$or = [{keyVersion: 1}, {keyVersion: {$exists: false}}];
        }
        else {
            filter.keyVersion = expectedKeyVersion;
        }
        const dbDoc: Record<string, unknown> = {};
        for (const key of Object.keys(updatedGroup) as (keyof db.group.Group)[]) {
            dbDoc[key === "id" ? "_id" : key] = updatedGroup[key];
        }
        delete dbDoc.id;
        const result = await this.repository.collection.replaceOne(filter, dbDoc, this.repository.getOptions());
        if (result.matchedCount === 0) {
            return null;
        }
        return updatedGroup;
    }
    
    async generateNewGroupKey(oldGroup: db.group.Group, modifier: types.cloud.UserId, newGroupPubKey: types.cloud.GroupPubKey,
        data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[],
        confirmationTag?: types.core.Base64): Promise<db.group.Group | null> {
        const now = DateUtils.now();
        const entry: db.group.GroupHistoryEntry = {
            created: now,
            author: modifier,
            keyId: keyId,
            data: data,
            users: oldGroup.users,
            managers: oldGroup.managers,
            groupPubKey: newGroupPubKey,
            ...(confirmationTag ? {confirmationTag} : {}),
        };
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
        const updatedGroup: db.group.Group = {
            ...oldGroup,
            groupPubKey: newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: keyId,
            data: data,
            keys: keys,
            history: [...oldGroup.history, entry],
            keyVersion: expectedKeyVersion + 1,
            keyHistory: [...(oldGroup.keyHistory ?? []), {keyVersion: expectedKeyVersion, groupPubKey: oldGroup.groupPubKey}],
        };
        return this.casRotate(oldGroup, expectedKeyVersion, updatedGroup);
    }
}
