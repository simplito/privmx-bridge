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
import { DbDuplicateError } from "../../error/DbDuplicateError";
import { LadderArchive } from "./keytree/LadderArchive";

export class SpaceRepository {
    
    static readonly COLLECTION_NAME = "space";
    static readonly COLLECTION_ID_PROP = "id";
    static readonly KEY_COLLECTION_NAME = "spaceKey";
    static readonly STATEMENT_COLLECTION_NAME = "spaceStatement";
    static readonly TOMBSTONE_COLLECTION_NAME = "spaceTombstone";
    static readonly RUNG_COLLECTION_NAME = "spaceRung";
    
    constructor(
        private repository: MongoObjectRepository<types.space.SpaceId, db.space.Space>,
        private keys: MongoObjectRepository<string, db.space.SpaceKey>,
        private statements: MongoObjectRepository<string, db.space.SpaceStatementEntry>,
        private tombstones: MongoObjectRepository<types.space.SpaceId, db.space.SpaceTombstone>,
        private rungs: MongoObjectRepository<string, db.space.SpaceRung>,
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
    
    /** @param onlyFor narrows to the spaces this user is a recipient of, directly or through one of the groups. */
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.space.Space, onlyFor?: {userId: types.cloud.UserId, groupIds: types.group.GroupId[]}) {
        const mongoQueries = listParams.query ? [MongoQueryConverter.convertQuery(listParams.query)] : [];
        // In the same `$match` as `contextId`, so no query from `listParams` can widen it back.
        const match = onlyFor === undefined
            ? {contextId: contextId}
            : {contextId: contextId, $or: [{"users.userId": onlyFor.userId}, {"groups.groupId": {$in: onlyFor.groupIds}}]};
        return this.repository.getMatchingPage([{$match: match}, ...mongoQueries], listParams, sortBy);
    }
    
    async insert(space: db.space.Space, keys: types.cloud.SpaceKeyEntry[]) {
        // A deleted space's id stays taken: a new space under it would pass for the old one.
        if (await this.tombstones.get(space.id)) {
            throw new DbDuplicateError();
        }
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
    
    /** The wraps of versions below `keyVersion`: once a rotation lands, readers reach those versions down the rungs. */
    async deleteKeysBelow(spaceId: types.space.SpaceId, keyVersion: number) {
        await this.keys.collection.deleteMany({spaceId: spaceId, keyVersion: {$lt: keyVersion}} as mongodb.Filter<any>, this.keys.getOptions());
    }
    
    async insertRungs(spaceId: types.space.SpaceId, rungs: types.cloud.SpaceRung[]) {
        if (rungs.length > 0) {
            const docs = rungs.map(r => ({id: `${spaceId}/${r.atKeyVersion}/${r.targetKeyVersion}`, spaceId, atKeyVersion: r.atKeyVersion, targetKeyVersion: r.targetKeyVersion, data: r.data}));
            await this.rungs.collection.insertMany(docs.map(d => this.rungs.convertToDbObj(d)), this.rungs.getOptions());
        }
    }
    
    /** The rungs at key versions `from`..`to`, ascending by `atKeyVersion`. */
    async getRungs(spaceId: types.space.SpaceId, from: number, to: number): Promise<types.cloud.SpaceRung[]> {
        const rungs = await LadderArchive.readRungs(this.rungs, q => q.eq("spaceId", spaceId), {from, to});
        return rungs.map(rung => ({atKeyVersion: rung.atKeyVersion, targetKeyVersion: rung.targetKeyVersion, data: rung.data}));
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
    
    async delete(space: Pick<db.space.Space, "id"|"contextId">) {
        await this.repository.delete(space.id);
        await this.keys.deleteMany(q => q.eq("spaceId", space.id));
        await this.statements.deleteMany(q => q.eq("spaceId", space.id));
        await this.rungs.deleteMany(q => q.eq("spaceId", space.id));
        await this.tombstones.insert({id: space.id, contextId: space.contextId});
    }
    
    /** The tombstones of a deleted context's spaces: nobody can create a space there any more, so they guard nothing. */
    async deleteTombstonesOfContext(contextId: types.context.ContextId) {
        await this.tombstones.deleteMany(q => q.eq("contextId", contextId));
    }
    
    async isGroupReferenced(groupId: types.group.GroupId) {
        return (await this.repository.query(q => q.arrayProp("groups").eq("groupId", groupId)).limit(1).array()).length > 0;
    }
    
    /** Whether a space still holds the group's key at an epoch below `keyVersion`. */
    async isGroupHeldBelow(groupId: types.group.GroupId, keyVersion: number) {
        const filter = {groups: {$elemMatch: {groupId: groupId, groupKeyVersion: {$lt: keyVersion}}}};
        return !!await this.repository.collection.findOne(filter as mongodb.Filter<any>, {...this.repository.getOptions(), projection: {_id: 1}});
    }
    
    private static readonly NOTICE_PROJECTION = {
        contextId: 1, keyVersion: 1, publicMetaVersion: 1, privateMetaVersion: 1, "groups.groupId": 1, "users.userId": 1,
    };
    
    /** Calls `each` with every space naming the group, projected to what a notice needs, a cursor batch at a time. */
    async forEachByGroup(groupId: types.group.GroupId, each: (space: db.space.SpaceNotice) => void|Promise<void>) {
        const cursor = this.repository.collection.find({"groups.groupId": groupId} as mongodb.Filter<any>,
            this.repository.getOptions<mongodb.FindOptions>({projection: SpaceRepository.NOTICE_PROJECTION, batchSize: 100}));
        for await (const doc of cursor) {
            await each(this.repository.convertFromDbObjEx(doc as unknown as db.space.SpaceNotice));
        }
    }
    
    /** The spaces of a context, projected to what their deletion and its notice need. */
    async getByContext(contextId: types.context.ContextId): Promise<db.space.SpaceNotice[]> {
        const list = await this.repository.collection.find({contextId: contextId} as mongodb.Filter<any>,
            this.repository.getOptions<mongodb.FindOptions>({projection: SpaceRepository.NOTICE_PROJECTION})).toArray();
        return list.map(doc => this.repository.convertFromDbObjEx(doc as unknown as db.space.SpaceNotice));
    }
}
