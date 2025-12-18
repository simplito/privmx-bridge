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
import { AppException } from "../../api/AppException";
import { KnownPublicKeyRepository } from "./KnownPublicKeyRepository";
import { MongoQueryConverter } from "../../db/mongo/MongoQueryConverter";
import { ContextRepository } from "./ContextRepository";

export class ContextUserRepository {
    
    static readonly COLLECTION_NAME = "contextUser";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<db.context.ContextUserId, db.context.ContextUser>,
    ) {
    }
    
    async get(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        return this.repository.get(this.getUserId(contextId, userId));
    }
    
    async exists(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        return this.repository.exists(this.getUserId(contextId, userId));
    }
    
    async insertOrUpdate(contextId: types.context.ContextId, userId: types.cloud.UserId, userPubKey: types.cloud.UserPubKey, acl: types.cloud.ContextAcl) {
        const oldUser = await this.getUserFromContext(userPubKey, contextId);
        if (oldUser) {
            if (oldUser.userId === userId) {
                return oldUser;
            }
            throw new AppException("PUB_KEY_ALREADY_IN_USE");
        }
        const user: db.context.ContextUser = {
            id: this.getUserId(contextId, userId),
            created: DateUtils.now(),
            acl: acl,
            userId: userId,
            contextId: contextId,
            userPubKey: userPubKey,
        };
        await this.repository.update(user);
        return user;
    }
    
    async updateAcl(contextId: types.context.ContextId, userId: types.cloud.UserId, acl:  types.cloud.ContextAcl) {
        await this.repository.collection.updateOne({_id: this.getUserId(contextId, userId)}, {$set: {acl: acl}});
    }
    
    async remove(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        await this.repository.delete(this.getUserId(contextId, userId));
    }
    
    async getAllByContextAndUserPubKey(contextId: types.context.ContextId, userPubKey: types.cloud.UserPubKey) {
        return this.repository.findAll(q => q.and(q.eq("contextId", contextId), q.eq("userPubKey", userPubKey)));
    }
    
    async removeAllByUserPub(contextId: types.context.ContextId, userPubKey: types.cloud.UserPubKey) {
        await this.repository.deleteMany(q => q.and(q.eq("contextId", contextId), q.eq("userPubKey", userPubKey)));
    }
    
    async removeAllByContextId(contextId: types.context.ContextId) {
        await this.repository.deleteMany(q => q.eq("contextId", contextId));
    }
    
    async getAllByUserPubKey(userPubKey: types.cloud.UserPubKey) {
        return this.repository.findAll(q => q.eq("userPubKey", userPubKey));
    }
    
    async userPubKeyExists(userPubKey: types.cloud.UserPubKey) {
        const elements = await this.repository.count(q => q.eq("userPubKey", userPubKey));
        return elements > 0;
    }
    
    async getUserFromContext(userPubKey: types.cloud.UserPubKey, contextId: types.context.ContextId) {
        return this.repository.find(q => q.and(q.eq("contextId", contextId), q.eq("userPubKey", userPubKey)));
    }
    
    async getUsers(contextId: types.context.ContextId, users: types.cloud.UserId[]) {
        return this.repository.findAll(q => q.in("id", users.map(x => this.getUserId(contextId, x))));
    }
    
    async getAllContextUsers(contextId: types.context.ContextId) {
        return this.repository.findAll(q => q.eq("contextId", contextId));
    }
    
    async getUsersPageFromContext(contextId: types.context.ContextId, model: types.core.ListModel) {
        return this.repository.matchX({contextId: contextId}, model, "created");
    }
    
    async getUserContexts(userPubKey: types.cloud.UserPubKey, listParams: types.core.ListModel, solutionId?: types.cloud.SolutionId) {
        const sortBy = "contextObj.created" as keyof db.context.ContextUser;
        const stages: any[] = [
            {
                $match: {
                    userPubKey: userPubKey,
                },
            },
            {
                $lookup: {
                    from: ContextRepository.COLLECTION_NAME,
                    localField: "contextId",
                    foreignField: "_id",
                    as: "contextObj",
                },
            },
            {
                $unwind: "$contextObj",
            },
        ];
        if (solutionId) {
            stages.push({
                $match: {
                    $or: [
                        {"contextObj.solution": solutionId},
                        {"contextObj.shares": solutionId},
                    ],
                },
            });
        }
        if (listParams.lastId) {
            const temporaryListProperties = {
                limit: listParams.limit,
                skip: 0,
                sortOrder: listParams.sortOrder,
            };
            const additionalCriteria = {
                $match: {
                    "contextId": { [(listParams.sortOrder === "asc") ? "$lt" : "$gt"]: listParams.lastId},
                },
            };
            stages.push(additionalCriteria);
            return await this.repository.aggregationX<db.context.ContextUser&{contextObj: db.context.Context}>(stages, temporaryListProperties, sortBy);
        }
        return this.repository.aggregationX<db.context.ContextUser&{contextObj: db.context.Context}>(stages, listParams, sortBy);
    }
    
    async getUsersPageWithActivityFromContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId, model: types.core.ListModel) {
        const mongoQueries = model.query ? [MongoQueryConverter.convertQuery(model.query)] : [];
        return this.repository.getMatchingPage<db.context.ContextUserWithStatus>([
            {
                $match: {
                    contextId: contextId,
                },
            },
            {
                $lookup: {
                    from: KnownPublicKeyRepository.COLLECTION_NAME,
                    localField: "userPubKey",
                    foreignField: "publicKey",
                    as: "matchedDocs",
                },
            },
            {
                $addFields: {
                    matchedDocs: {
                        $filter: {
                            input: "$matchedDocs",
                            as: "doc",
                            cond: { $eq: ["$$doc.solutionId", solutionId] },
                        },
                    },
                },
            },
            {
                $unwind: {
                    path: "$matchedDocs",
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $addFields: {
                    lastStatusChange: "$matchedDocs.lastStatusChange",
                },
            },
            {
                $project: {
                    matchedDocs: 0,
                },
            },
            ...mongoQueries,
        ], model, "created");
    }
    
    async getCountOfExistingUsersFromList(userId: types.cloud.UserId[], contextId: types.context.ContextId) {
        return this.repository.count(q => q.in("id", userId.map(uId => this.getUserId(contextId, uId))));
    }
    
    private getUserId(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        return `${contextId}-${userId}` as db.context.ContextUserId;
    }
}
