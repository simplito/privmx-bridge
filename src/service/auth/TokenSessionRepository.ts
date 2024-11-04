/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";
import * as types from "../../types";

export class TokenSessionRepository {
    
    static readonly COLLECTION_NAME = "token_session";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<db.auth.TokenSessionId, db.auth.TokenSession>,
    ) {
    }
    
    async get(id: db.auth.TokenSessionId) {
        return this.repository.get(id);
    }
    
    async getAllForUserSortedByCreated(userId: types.auth.ApiUserId) {
        return this.repository.query(q => q.eq("user", userId)).sort("created", true).array();
    }
    
    async create(model: {userId: types.auth.ApiUserId, apiKeyId: types.auth.ApiKeyId, name?: db.auth.TokenSessionName, scopes: types.auth.Scope[], ttl: types.core.Timespan, solutions: types.cloud.SolutionId[], ip?: types.core.IPAddress}) {
        const now = DateUtils.now();
        const tokenSession: db.auth.TokenSession = {
            id: this.repository.generateId() as db.auth.TokenSessionId,
            created: now,
            expiry: DateUtils.add(now, model.ttl),
            name: model.name,
            user: model.userId,
            seq: 0,
            scopes: model.scopes,
            apiKey: model.apiKeyId,
            ipAddress: model.ip,
            solutions: model.solutions,
        };
        await this.repository.insert(tokenSession);
        return tokenSession;
    }
    
    async increaseSessionSeqAndSetExpiry(session: db.auth.TokenSession, ttl: types.core.Timespan) {
        session.seq++;
        session.expiry = DateUtils.add(DateUtils.now(), ttl);
        await this.repository.update(session);
    }
    
    async delete(id: db.auth.TokenSessionId) {
        await this.repository.delete(id);
    }
    
    async deleteExpired() {
        await this.repository.deleteMany(q => q.lt("expiry", DateUtils.now()));
    }
    
    async deleteAllByApiKey(apiKeyId: types.auth.ApiKeyId) {
        await this.repository.deleteMany(q => q.eq("apiKey", apiKeyId));
    }
    
    async deleteAllByUser(userId: types.auth.ApiUserId) {
        await this.repository.deleteMany(q => q.eq("user", userId));
    }
}
