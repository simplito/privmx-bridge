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

export class KvdbEntryRepository {
    
    static readonly COLLECTION_NAME = "kvdbEntry";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.kvdb.KvdbEntryId, db.kvdb.KvdbEntry>,
    ) {
    }
    
    async get(kvdbId: types.kvdb.KvdbId, entryKey: types.kvdb.KvdbEntryKey) {
        return this.repository.get(`${kvdbId}:${entryKey}` as types.kvdb.KvdbEntryId);
    }
    
    async getMany(kvdbId: types.kvdb.KvdbId, entryKeys: types.kvdb.KvdbEntryKey[]) {
        return this.repository.getMulti(entryKeys.map(key => `${kvdbId}:${key}` as types.kvdb.KvdbEntryId));
    }
    
    async getEntriesOlderThan(id: types.kvdb.KvdbId, timestamp: types.core.Timestamp) {
        return this.repository.findAll(q => q.and(
            q.lt("createDate", timestamp),
            q.eq("kvdbId", id),
        ));
    }
    
    async getPageByKvdbAndUser(userId: types.cloud.UserId, kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel) {
        const sortBy = "createDate";
        const match: Record<string, unknown> = {
            $and: [
                {
                    kvdbId: kvdbId,
                },
                {
                    author: userId,
                },
            ],
        };
        return this.repository.matchX(match, listParams, sortBy);
    }
    
    async getPageByKvdb(kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel) {
        const sortBy = "entryKey";
        return this.repository.matchX({kvdbId: kvdbId}, listParams, sortBy);
    }
    
    async getPageByKvdbWithPrefix(kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel, sortBy: keyof db.kvdb.KvdbEntry, prefix: string|undefined) {
        const stage: {
            kvdbId: types.kvdb.KvdbId;
            entryKey?: any;
        } = {
            kvdbId: kvdbId,
        };
        if (prefix) {
            stage.entryKey =  {
                $gte: prefix,           // Faster and more secure than regex
                $lt: prefix + "\uffff", //
            };
        }
        return this.repository.matchX(stage, listParams, sortBy);
    }
    
    async getPageByKvdbWithPrefixMatch2(kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel2<types.kvdb.KvdbEntryId>, prefix: string|undefined) {
        const stage: {
            kvdbId: types.kvdb.KvdbId;
            entryKey?: any;
        } = {
            kvdbId: kvdbId,
        };
        if (prefix) {
            stage.entryKey =  {
                $gte: prefix,           // Faster and more secure than regex
                $lt: prefix + "\uffff", //
            };
        }
        return this.repository.matchX2(stage, listParams);
    }
    
    async getPageByKvdbMatch2(kvdbId: types.kvdb.KvdbId, listParams: types.core.ListModel2<types.kvdb.KvdbEntryId>) {
        return this.repository.matchX2({kvdbId: kvdbId}, listParams);
    }
    
    async createEntry(entryKey: types.kvdb.KvdbEntryKey, userId: types.cloud.UserId, kvdbId: types.kvdb.KvdbId, data: types.kvdb.KvdbEntryValue, keyId: types.core.KeyId) {
        const now = DateUtils.now();
        const entry: db.kvdb.KvdbEntry = {
            id: `${kvdbId}:${entryKey}` as types.kvdb.KvdbEntryId,
            entryValue: data,
            keyId: keyId,
            lastModificationDate: now,
            lastModifier: userId,
            entryKey: entryKey,
            author: userId,
            createDate: now,
            kvdbId: kvdbId,
            version: 1 as types.kvdb.KvdbEntryVersion,
        };
        await this.repository.insert(entry);
        return entry;
    }
    
    async updateEntry(oldEntry: db.kvdb.KvdbEntry, modifier: types.cloud.UserId, data: types.kvdb.KvdbEntryValue, keyId: types.core.KeyId) {
        const now = DateUtils.now();
        const entry: db.kvdb.KvdbEntry = {
            id: oldEntry.id,
            kvdbId: oldEntry.kvdbId,
            createDate: oldEntry.createDate,
            author: oldEntry.author,
            entryValue: data,
            entryKey: oldEntry.entryKey,
            keyId: keyId,
            lastModificationDate: now,
            lastModifier: modifier,
            version: oldEntry.version + 1 as types.kvdb.KvdbEntryVersion,
        };
        await this.repository.update(entry);
        return entry;
    }
    
    async upsertEntryWithForce(entryKey: types.kvdb.KvdbEntryKey, userId: types.cloud.UserId, kvdbId: types.kvdb.KvdbId, data: types.kvdb.KvdbEntryValue, keyId: types.core.KeyId) {
        const now = DateUtils.now();
        const entry = {
            entryValue: data,
            keyId: keyId,
            lastModificationDate: now,
            lastModifier: userId,
        };
        const result = await this.repository.col<db.kvdb.KvdbEntry>().findOneAndUpdate(
            {
                _id: `${kvdbId}:${entryKey}` as types.kvdb.KvdbEntryId,
            },
            {
                $inc: {
                    version: 1,
                },
                $set: {
                    ...entry,
                },
                $setOnInsert: {
                    entryKey: entryKey,
                    author: userId,
                    createDate: now,
                    kvdbId: kvdbId,
                },
            },
            {
                upsert: true,
                returnDocument: "after",
            },
        );
        return result as db.kvdb.KvdbEntry;
    }
    
    async deleteAllFromKvdb(kvdbId: types.kvdb.KvdbId) {
        await this.repository.deleteMany(q => q.eq("kvdbId", kvdbId));
    }
    
    async deleteAllFromKvdbs(kvdbIds: types.kvdb.KvdbId[]) {
        await this.repository.deleteMany(q => q.in("kvdbId", kvdbIds));
    }
    
    async deleteEntry(kvdbId: types.kvdb.KvdbId, entryKey: types.kvdb.KvdbEntryKey) {
        await this.repository.delete(`${kvdbId}:${entryKey}` as types.kvdb.KvdbEntryId);
    }
    
    async deleteManyEntries(ids: types.kvdb.KvdbEntryId[]) {
        return this.repository.deleteMany(q => q.in("id", ids));
    }
    
    async getLastEntryDate(kvdbId: types.kvdb.KvdbId) {
        const list = await this.repository.query(q => q.eq("kvdbId", kvdbId)).props("createDate").sort("createDate", false).limit(1).array();
        return list.length === 0 ? null : list[0].createDate;
    }
}
