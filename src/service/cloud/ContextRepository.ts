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
import { MongoQueryConverter } from "../../db/mongo/MongoQueryConverter";

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
    
    static getPaginationFilterForContainer(solutionId: types.cloud.SolutionId, contextId: types.context.ContextId, userId: types.cloud.UserId, query: types.core.Query|undefined, type: string|undefined, scope: types.core.ContainerAccessScope) {
        const mongoQueries = query ? [MongoQueryConverter.convertQuery(query)] : [];
        const match = this.getScopeFilter(scope, contextId, userId);
        if (type) {
            match.type = type;
        }
        return [
            {
                $match: match,
            },
            ...mongoQueries,
            {
                $lookup: {
                    from: ContextRepository.COLLECTION_NAME,
                    localField: "contextId",
                    foreignField: "_id",
                    as: "contextObj",
                },
            },
            {
                $match: {
                    $or: [
                        {"contextObj.solution": solutionId},
                        {"contextObj.shares": solutionId},
                    ],
                },
            },
        ];
    }
    
    private static getScopeFilter(scope: types.core.ContainerAccessScope, contextId: types.context.ContextId, userId: types.cloud.UserId): Record<string, unknown> {
        if (scope === "ALL") {
            return {
                contextId: contextId,
            };
        }
        else if (scope === "MANAGER") {
            return {
                contextId: contextId,
                managers: userId,
            };
        }
        else if (scope === "USER") {
            return {
                contextId: contextId,
                users: userId,
            };
        }
        else if (scope === "OWNER") {
            return {
                contextId: contextId,
                creator: userId,
            };
        }
        else if (scope === "MEMBER") {
            return {
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
                ],
            };
        }
        else {
            throw new Error("Invalid container access scope");
        }
    }
}
