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

export class StreamRoomRepository {
    
    static readonly COLLECTION_NAME = "streamRoom";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.stream.StreamRoomId, db.stream.StreamRoom>,
    ) {
    }
    
    async get(id: types.stream.StreamRoomId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.stream.StreamRoomId[]) {
        return this.repository.getMulti(ids);
    }
    
    async deleteOneByOneByContext(contextId: types.context.ContextId, func: (streamRoom: db.stream.StreamRoom) => Promise<void>) {
        while (true) {
            const streamRooms = await this.repository.query(q => q.eq("contextId", contextId)).limit(100).array();
            if (streamRooms.length === 0) {
                return;
            }
            for (const streamRoom of streamRooms) {
                await this.deleteStreamRoom(streamRoom.id);
                await func(streamRoom);
            }
        }
    }
    
    async getAllStreams(contextId: types.context.ContextId, type: types.stream.StreamRoomType|undefined, listParams: types.core.ListModel, sortBy: keyof db.stream.StreamRoom) {
        const match: Record<string, unknown> = {
            contextId: contextId,
        };
        if (type) {
            match.type = type;
        }
        return await this.repository.getMatchingPage<db.stream.StreamRoom>([{$match: match}], listParams, sortBy);
    }
    
    async getPageByContextAndUser(contextId: types.context.ContextId, type: types.stream.StreamRoomType|undefined, userId: types.cloud.UserId, solutionId: types.cloud.SolutionId|undefined, listParams: types.core.ListModel, sortBy: keyof db.stream.StreamRoom) {
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
    
    async getPageByContext(contextId: types.context.ContextId, listParams: types.core.ListModel2<types.stream.StreamRoomId>) {
        return this.repository.matchX2({contextId: contextId}, listParams);
    }
    
    async createStreamRoom(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId|null, type: types.stream.StreamRoomType|undefined, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[], data: types.stream.StreamRoomData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerWithoutItemPolicy) {
        const entry: db.stream.StreamRoomHistoryEntry = {
            created: DateUtils.now(),
            author: creator,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
        };
        const streamRoom: db.stream.StreamRoom = {
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
            policy: policy,
        };
        if (resourceId) {
            streamRoom.clientResourceId = resourceId;
        }
        await this.repository.insert(streamRoom);
        return streamRoom;
    }
    
    async updateStreamRoom(oldStreamRoom: db.stream.StreamRoom, modifier: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.stream.StreamRoomData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerWithoutItemPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
        const entry: db.stream.StreamRoomHistoryEntry = {
            created: DateUtils.now(),
            author: modifier,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
        };
        const updatedStreamRoom: db.stream.StreamRoom = {
            id: oldStreamRoom.id,
            contextId: oldStreamRoom.contextId,
            type: oldStreamRoom.type,
            creator: oldStreamRoom.creator,
            createDate: oldStreamRoom.createDate,
            lastModifier: entry.author,
            lastModificationDate: entry.created,
            keyId: entry.keyId,
            data: entry.data,
            users: entry.users,
            managers: entry.managers,
            keys: keys,
            history: [...oldStreamRoom.history, entry],
            allTimeUsers: Utils.uniqueFromArrays(oldStreamRoom.allTimeUsers, entry.users, entry.managers),
            policy: policy === undefined ? oldStreamRoom.policy : policy,
        };
        if (resourceId && !oldStreamRoom.clientResourceId) {
            updatedStreamRoom.clientResourceId = resourceId;
        }
        else if (oldStreamRoom.clientResourceId) {
            updatedStreamRoom.clientResourceId = oldStreamRoom.clientResourceId;
        }
        await this.repository.update(updatedStreamRoom);
        return updatedStreamRoom;
    }
    
    async deleteStreamRoom(id: types.stream.StreamRoomId) {
        await this.repository.delete(id);
    }
    
    async deleteManyStreamRooms(ids: types.stream.StreamRoomId[]) {
        await this.repository.deleteMany(q => q.in("id", ids));
    }
}
