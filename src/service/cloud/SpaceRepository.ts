/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as mongodb from "mongodb";
import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import { MongoQueryConverter } from "../../db/mongo/MongoQueryConverter";
import * as types from "../../types";
import * as db from "../../db/Model";

export class SpaceRepository {
    
    static readonly COLLECTION_NAME = "space";
    static readonly COLLECTION_ID_PROP = "id";
    static readonly KEY_COLLECTION_NAME = "spaceKey";
    static readonly STATEMENT_COLLECTION_NAME = "spaceStatement";
    
    constructor(
        private repository: MongoObjectRepository<types.space.SpaceId, db.space.Space>,
        private keys: MongoObjectRepository<string, db.space.SpaceKey>,
        private statements: MongoObjectRepository<string, db.space.SpaceStatementEntry>,
    ) {
    }
    
    static toKeyDoc(spaceId: types.space.SpaceId, entry: types.cloud.SpaceKeyEntry): db.space.SpaceKey {
        const recipient = "groupId" in entry.recipient
            ? {groupId: entry.recipient.groupId, groupKeyVersion: entry.recipient.groupKeyVersion}
            : {userId: entry.recipient.userId};
        return {
            id: `${spaceId}/${entry.keyVersion}/${"groupId" in recipient ? "g:" + recipient.groupId : "u:" + recipient.userId}`,
            spaceId: spaceId,
            keyVersion: entry.keyVersion,
            ...recipient,
            data: entry.data,
            signature: entry.signature,
        };
    }
    
    async get(id: types.space.SpaceId) {
        return this.repository.get(id);
    }
    
    /**
     * @param onlyFor narrows to the spaces this user is a recipient of, directly or through one of the groups.
     * @param groupId narrows to the spaces naming this group.
     */
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.space.Space, onlyFor?: {userId: types.cloud.UserId, groupIds: types.group.GroupId[]},
        groupId?: types.group.GroupId) {
        const mongoQueries = listParams.query ? [MongoQueryConverter.convertQuery(listParams.query)] : [];
        // In the same `$match` as `contextId`, so no query from `listParams` can widen it back.
        const match = {
            contextId: contextId,
            ...(onlyFor === undefined ? {} : {$or: [{"users.userId": onlyFor.userId}, {"groups.groupId": {$in: onlyFor.groupIds}}]}),
            ...(groupId === undefined ? {} : {"groups.groupId": groupId}),
        };
        return this.repository.getMatchingPage([{$match: match}, ...mongoQueries], listParams, sortBy);
    }
    
    async insert(space: db.space.Space, keys: types.cloud.SpaceKeyEntry[]) {
        await this.repository.insert(space);
        await this.insertStatement(space.statement);
        await this.insertKeys(space.id, keys);
    }
    
    /** Append-only: the id is the space and the seq, so one seq holds one statement for good. */
    async insertStatement(statement: types.cloud.SpaceStatement) {
        await this.statements.insert({id: `${statement.spaceId}/${statement.seq}`, spaceId: statement.spaceId, seq: statement.seq, statement});
    }
    
    /** The statements after `fromSeq`, oldest first. */
    async getStatements(spaceId: types.space.SpaceId, fromSeq: number, limit: number) {
        const list = await this.statements.collection.find({spaceId: spaceId, seq: {$gt: fromSeq}} as mongodb.Filter<any>, this.statements.getOptions())
            .sort({seq: 1}).limit(limit).toArray();
        return list.map(x => this.statements.convertFromDbObj(x as unknown as db.space.SpaceStatementEntry).statement);
    }
    
    async insertKeys(spaceId: types.space.SpaceId, keys: types.cloud.SpaceKeyEntry[]) {
        if (keys.length > 0) {
            await this.keys.collection.insertMany(keys.map(k => this.keys.convertToDbObj(SpaceRepository.toKeyDoc(spaceId, k))), this.keys.getOptions());
        }
    }
    
    /**
     * The wrapped keys of the given spaces that the caller can open: its own and those of its groups.
     * @param atVersions a space's id to the one key version wanted of it; absent means every version.
     */
    async getKeys(spaceIds: types.space.SpaceId[], userId: types.cloud.UserId, groupIds: types.group.GroupId[], atVersions?: Map<types.space.SpaceId, number>) {
        if (spaceIds.length === 0) {
            return [];
        }
        const mine = [{userId: userId}, {groupId: {$in: groupIds}}];
        const filter = atVersions
            ? {$or: spaceIds.map(id => ({spaceId: id, keyVersion: atVersions.get(id), $or: mine}))}
            : {spaceId: {$in: spaceIds}, $or: mine};
        const list = await this.keys.collection.find(filter as mongodb.Filter<any>, this.keys.getOptions()).sort({keyVersion: 1}).toArray();
        return list.map(x => this.keys.convertFromDbObj(x as unknown as db.space.SpaceKey));
    }
    
    async deleteKeysOf(spaceId: types.space.SpaceId, groupIds: types.group.GroupId[], userIds: types.cloud.UserId[]) {
        await this.keys.collection.deleteMany({spaceId: spaceId, $or: [{groupId: {$in: groupIds}}, {userId: {$in: userIds}}]} as mongodb.Filter<any>, this.keys.getOptions());
    }
    
    /** Compare-and-swap on the document's `version`. False when somebody else wrote first. */
    async update(old: db.space.Space, changes: Partial<db.space.Space>) {
        const result = await this.repository.collection.updateOne(
            {_id: old.id, version: old.version} as mongodb.Filter<any>,
            {$set: {...changes, version: old.version + 1}},
            this.repository.getOptions(),
        );
        return result.matchedCount === 1;
    }
    
    async delete(id: types.space.SpaceId) {
        await this.repository.delete(id);
        await this.keys.deleteMany(q => q.eq("spaceId", id));
        await this.statements.deleteMany(q => q.eq("spaceId", id));
    }
    
    async isGroupReferenced(groupId: types.group.GroupId) {
        return (await this.repository.query(q => q.arrayProp("groups").eq("groupId", groupId)).limit(1).array()).length > 0;
    }
    
    /** Whether a space still holds the group's key at an epoch below `keyVersion`. */
    async isGroupHeldBelow(groupId: types.group.GroupId, keyVersion: number) {
        const filter = {groups: {$elemMatch: {groupId: groupId, groupKeyVersion: {$lt: keyVersion}}}};
        return !!await this.repository.collection.findOne(filter as mongodb.Filter<any>, {...this.repository.getOptions(), projection: {_id: 1}});
    }
    
    async getByGroup(groupId: types.group.GroupId) {
        return this.repository.query(q => q.arrayProp("groups").eq("groupId", groupId)).array();
    }
    
    async getByContext(contextId: types.context.ContextId) {
        return this.repository.findAll(q => q.eq("contextId", contextId));
    }
}
