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
import { Crypto } from "../../utils/crypto/Crypto";
import { ContextUserRepository } from "./ContextUserRepository";

export class ContextRepository {
    
    static readonly COLLECTION_NAME = "context";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.context.ContextId, db.context.Context>,
    ) {
    }
    
    async get(id: types.context.ContextId) {
        return this.repository.get(id);
    }
    
    async getAll() {
        return this.repository.getAll();
    }
    
    async create(solution: types.cloud.SolutionId, contextName: types.context.ContextName, description: types.context.ContextDescription, scope: types.context.ContextScope, policy: types.context.ContextPolicy) {
        const now = DateUtils.now();
        const context: db.context.Context = {
            id: Crypto.uuidv4() as types.context.ContextId,
            created: DateUtils.now(),
            modified: now,
            name: contextName,
            description: description,
            scope: scope,
            solution: solution,
            shares: [],
            policy: policy,
        };
        await this.repository.insert(context);
        return context;
    }
    
    async updateContext(contextId: types.context.ContextId, model: {name?: types.context.ContextName; description?: types.context.ContextDescription; scope?: types.context.ContextScope; policy?: types.context.ContextPolicy;}) {
        await this.repository.collection.updateOne({_id: contextId}, {$set: {modified: DateUtils.now(), ...model}});
    }
    
    async remove(id: types.context.ContextId) {
        await this.repository.delete(id);
    }
    
    async getAllBySolution(solutionId: types.cloud.SolutionId) {
        return this.repository.findAll(q => q.or(
            q.eq("solution", solutionId),
            q.includes("shares", solutionId),
        ));
    }
    
    async addSolutionToContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        await this.repository.collection.updateOne({_id: contextId}, {$addToSet: {shares: solutionId}}, {upsert: true, session: this.repository.getSession()});
    }
    
    async removeSolutionFromContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        await (this.repository.collection as any).updateOne({_id: contextId}, {$pull: {shares: solutionId}}, {upsert: true, session: this.repository.getSession()});
    }
    
    async getPage(model: types.core.ListModel) {
        return this.repository.matchX({}, model, "created");
    }
    
    async getPageForSolutions(solutions: types.cloud.SolutionId[], model: types.core.ListModel) {
        return this.repository.matchX({
            $or: [
                {solution: {$in: solutions}},
                {shares: {$in: solutions}},
            ],
        }, model, "created");
    }
    
    async getPageByUserPubKey(userPubKey: types.cloud.UserPubKey, listParams: types.core.ListModel) {
        const sortBy = "created";
        return this.repository.getMatchingPage<db.context.Context&{users: db.context.ContextUser[]}>([
            {
                $lookup: {
                    from: ContextUserRepository.COLLECTION_NAME,
                    let: {ctxId: "$_id"},
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: [ "$contextId", "$$ctxId" ],
                                },
                                userPubKey: userPubKey,
                            },
                        },
                    ],
                    as: "users",
                },
            },
            {
                $match: {
                    "users.userPubKey": userPubKey,
                },
            },
        ], listParams, sortBy);
    }
    
    async getPageByUserPubKeyAndSolution(userPubKey: types.cloud.UserPubKey, solutionId: types.cloud.SolutionId, listParams: types.core.ListModel) {
        const sortBy = "created";
        return this.repository.getMatchingPage<db.context.Context&{users: db.context.ContextUser[]}>([
            {
                $lookup: {
                    from: ContextUserRepository.COLLECTION_NAME,
                    let: {ctxId: "$_id"},
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: [ "$contextId", "$$ctxId" ],
                                },
                                userPubKey: userPubKey,
                            },
                        },
                    ],
                    as: "users",
                },
            },
            {
                $match: {
                    "users.userPubKey": userPubKey,
                    $or: [
                        {solution: solutionId},
                        {shares: solutionId},
                    ],
                },
            },
        ], listParams, sortBy);
    }
}
