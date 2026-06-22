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
import { ContextRepository } from "./ContextRepository";

export class KvdbRepository {
    
    static readonly COLLECTION_NAME = "kvdb";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.kvdb.KvdbId, db.kvdb.Kvdb>,
    ) {
    }
    
    async get(id: types.kvdb.KvdbId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.kvdb.KvdbId[]) {
        return this.repository.getMulti(ids);
    }
    
    async deleteOneByOneByContext(contextId: types.context.ContextId, func: (kvdb: db.kvdb.Kvdb) => Promise<void>) {
        while (true) {
            const kvdbs = await this.repository.query(q => q.eq("contextId", contextId)).limit(100).array();
            if (kvdbs.length === 0) {
                return;
            }
            for (const kvdb of kvdbs) {
                await this.deleteKvdb(kvdb.id);
                await func(kvdb);
            }
        }
    }
    
    async getPageByContextAndUser(contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, userId: types.cloud.UserId, solutionId: types.cloud.SolutionId|undefined, listParams: types.core.ListModel, sortBy: keyof db.kvdb.Kvdb, scope: types.core.ContainerAccessScope, userGroupIds: types.group.GroupId[] = []) {
        if (!solutionId) {
            return this.repository.matchX({contextId: contextId, users: userId}, listParams, sortBy);
        }
        return this.repository.getMatchingPage([
            ...ContextRepository.getPaginationFilterForContainer(contextId, userId, listParams.query, type, scope, userGroupIds),
        ], listParams, sortBy);
    }
    
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel2<types.kvdb.KvdbId>) {
        return this.repository.matchX2({contextId: contextId}, listParams);
    }
    
    async getAllKvdbs(contextId: types.context.ContextId, type: types.kvdb.KvdbType|undefined, listParams: types.core.ListModel, sortBy: keyof db.kvdb.Kvdb) {
        const match: Record<string, unknown> = {
            contextId: contextId,
        };
        if (type) {
            match.type = type;
        }
        return await this.repository.getMatchingPage<db.kvdb.Kvdb>([{$match: match}], listParams, sortBy);
    }
    
    async createKvdb(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId, type: types.kvdb.KvdbType|undefined, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.kvdb.KvdbData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy, grantees?: types.cloud.ContainerGrantees) {
        const now = DateUtils.now();
        const groups = grantees?.groups || [];
        const groupManagers = grantees?.groupManagers || [];
        const entry: db.kvdb.KvdbHistoryEntry = {
            created: now,
            author: creator,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groups: groups,
            groupManagers: groupManagers,
        };
        const kvdb: db.kvdb.Kvdb = {
            id: this.repository.generateId(),
            clientResourceId: resourceId,
            contextId: contextId,
            type: type,
            creator: entry.author,
            createDate: entry.created,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            groups: groups,
            groupManagers: groupManagers,
            groupKeys: grantees?.groupKeys || [],
            history: [entry],
            allTimeUsers: Utils.uniqueFromArrays(entry.users, entry.managers),
            policy: policy,
            lastEntryDate: now,
            entries: 0,
        };
        await this.repository.insert(kvdb);
        return kvdb;
    }
    
    async updateKvdb(oldKvdb: db.kvdb.Kvdb, modifier: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.kvdb.KvdbData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy|undefined, grantees?: types.cloud.ContainerGrantees) {
        const groups = grantees?.groups || [];
        const groupManagers = grantees?.groupManagers || [];
        const entry: db.kvdb.KvdbHistoryEntry = {
            created: DateUtils.now(),
            author: modifier,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groups: groups,
            groupManagers: groupManagers,
        };
        const updatedKvdb: db.kvdb.Kvdb = {
            id: oldKvdb.id,
            clientResourceId: oldKvdb.clientResourceId,
            contextId: oldKvdb.contextId,
            type: oldKvdb.type,
            creator: oldKvdb.creator,
            createDate: oldKvdb.createDate,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            groups: groups,
            groupManagers: groupManagers,
            groupKeys: grantees?.groupKeys || [],
            history: [...oldKvdb.history, entry],
            allTimeUsers: Utils.uniqueFromArrays(oldKvdb.allTimeUsers, entry.users, entry.managers),
            entries: oldKvdb.entries,
            lastEntryDate: oldKvdb.lastEntryDate,
            policy: policy === undefined ? oldKvdb.policy : policy,
        };
        await this.repository.update(updatedKvdb);
        return updatedKvdb;
    }
    
    async deleteKvdb(id: types.kvdb.KvdbId) {
        return this.repository.delete(id);
    }
    
    /** True if any kvdb still grants access to the given group (Phase 2 referential integrity). */
    async isGroupReferenced(groupId: types.group.GroupId): Promise<boolean> {
        const found = await this.repository.query(q => q.or(q.includes("groups", groupId), q.includes("groupManagers", groupId))).limit(1).array();
        return found.length > 0;
    }
    
    async deleteManyKvdbs(ids: types.kvdb.KvdbId[]) {
        return this.repository.deleteMany(q => q.in("id", ids));
    }
    
    async increaseEntryCounter(kvdbId: types.kvdb.KvdbId, lastEntryDate: types.core.Timestamp) {
        await this.repository.collection.updateOne({_id: kvdbId}, {$inc: {entries: 1}, $max: {lastEntryDate: lastEntryDate}}, {session: this.repository.getSession()});
    }
    
    async decreaseEntryCounter(kvdbId: types.kvdb.KvdbId, lastEntryDate: types.core.Timestamp, decrease?: number) {
        await this.repository.collection.updateOne({_id: kvdbId}, {$inc: {entries: (decrease) ? -decrease : -1}, $set: {lastEntryDate: lastEntryDate}}, {session: this.repository.getSession()});
    }
    
    async getKvdbStats(kvdbId: types.kvdb.KvdbId) {
        return this.repository.query(q => q.eq("id", kvdbId)).props("id", "entries", "lastEntryDate").one();
    }
}
