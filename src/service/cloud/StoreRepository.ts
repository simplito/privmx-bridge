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
import { MongoQueryConverter } from "../../db/mongo/MongoQueryConverter";

export class StoreRepository {
    
    static readonly COLLECTION_NAME = "store";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.store.StoreId, db.store.Store>,
    ) {
    }
    
    async get(id: types.store.StoreId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.store.StoreId[]) {
        return this.repository.getMulti(ids);
    }
    
    async deleteOneByOneByContext(contextId: types.context.ContextId, func: (store: db.store.Store) => Promise<void>) {
        while (true) {
            const stores = await this.repository.query(q => q.eq("contextId", contextId)).limit(100).array();
            if (stores.length === 0) {
                return;
            }
            for (const store of stores) {
                await this.deleteStore(store.id);
                await func(store);
            }
        }
    }
    
    async getPageByContextAndUser(contextId: types.context.ContextId, type: types.store.StoreType|undefined, userId: types.cloud.UserId, solutionId: types.cloud.SolutionId|undefined, listParams: types.core.ListModel, sortBy: keyof db.store.Store) {
        if (!solutionId) {
            return this.repository.matchX({contextId: contextId, users: userId}, listParams, sortBy);
        }
        const mongoQueries = listParams.query ? [MongoQueryConverter.convertQuery(listParams.query)] : [];
        const match: Record<string, unknown> = {
            $and: [
                {
                    contextId: contextId,
                },
                {
                    $or: [
                        {users: userId},
                        {managers: userId},
                    ],
                },
                {
                    $or: [
                        {"contextObj.solution": solutionId},
                        {"contextObj.shares": solutionId},
                    ],
                },
            ],
        };
        if (type) {
            match.type = type;
        }
        return this.repository.getMatchingPage([
            {
                $lookup: {
                    from: ContextRepository.COLLECTION_NAME,
                    localField: "contextId",
                    foreignField: "_id",
                    as: "contextObj",
                },
            },
            {
                $match: match,
            },
            ...mongoQueries,
        ], listParams, sortBy);
    }
    
    async getPageByContext(contextId: types.context.ContextId, listParams: types.core.ListModel2<types.store.StoreId>) {
        return this.repository.matchX2({contextId: contextId}, listParams);
    }
    
    async getAllStores(contextId: types.context.ContextId, type: types.store.StoreType|undefined, listParams: types.core.ListModel, sortBy: keyof db.store.Store) {
        const match: Record<string, unknown> = {
            contextId: contextId,
        };
        if (type) {
            match.type = type;
        }
        return await this.repository.getMatchingPage<db.store.Store>([{$match: match}], listParams, sortBy);
    }
    
    async createStore(resourceId: types.core.ClientResourceId|null, contextId: types.context.ContextId, type: types.store.StoreType|undefined, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.store.StoreData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy) {
        const entry: db.store.StoreHistoryEntry = {
            created: DateUtils.now(),
            author: creator,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
        };
        const store: db.store.Store = {
            id: this.repository.generateId(),
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
            history: [entry],
            allTimeUsers: Utils.uniqueFromArrays(entry.users, entry.managers),
            lastFileDate: entry.created,
            files: 0,
            policy: policy,
        };
        if (resourceId) {
            store.clientResourceId = resourceId;
        }
        await this.repository.insert(store);
        return store;
    }
    
    async updateStore(oldStore: db.store.Store, modifier: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.store.StoreData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
        const entry: db.store.StoreHistoryEntry = {
            created: DateUtils.now(),
            author: modifier,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
        };
        const updatedStore: db.store.Store = {
            id: oldStore.id,
            contextId: oldStore.contextId,
            type: oldStore.type,
            creator: oldStore.creator,
            createDate: oldStore.createDate,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            history: [...oldStore.history, entry],
            allTimeUsers: Utils.uniqueFromArrays(oldStore.allTimeUsers, entry.users, entry.managers),
            lastFileDate: oldStore.lastFileDate,
            files: oldStore.files,
            policy: policy === undefined ? oldStore.policy : policy,
        };
        if (resourceId && !oldStore.clientResourceId) {
            updatedStore.clientResourceId = resourceId;
        }
        else if (oldStore.clientResourceId) {
            updatedStore.clientResourceId = oldStore.clientResourceId;
        }
        await this.repository.update(updatedStore);
        return updatedStore;
    }
    
    async deleteStore(id: types.store.StoreId) {
        await this.repository.delete(id);
    }
    
    async deleteManyStores(ids: types.store.StoreId[]) {
        await this.repository.deleteMany(q => q.in("id", ids));
    }
    
    async increaseFilesCounter(id: types.store.StoreId, lastFileDate: types.core.Timestamp) {
        await this.increaseFilesCounterBy(id, lastFileDate, 1);
    }
    
    async increaseFilesCounterBy(id: types.store.StoreId, lastFileDate: types.core.Timestamp, count: number) {
        await this.repository.collection.updateOne({_id: id}, {$inc: {files: count}, $max: {lastFileDate: lastFileDate}}, {session: this.repository.getSession()});
    }
    
    async decreaseFilesCounter(id: types.store.StoreId, lastFileDate: types.core.Timestamp, decrease?: number) {
        await this.repository.collection.updateOne({_id: id}, {$inc: {files: (decrease) ? -decrease : -1}, $max: {lastFileDate: lastFileDate}}, {session: this.repository.getSession()});
    }
    
    async updateLastFileDate(id: types.store.StoreId, lastFileDate: types.core.Timestamp) {
        await this.repository.collection.updateOne({_id: id}, {$max: {lastFileDate: lastFileDate}}, {session: this.repository.getSession()});
    }
}
