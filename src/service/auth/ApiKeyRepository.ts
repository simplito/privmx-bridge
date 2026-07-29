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
import * as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";
import { Crypto } from "../../utils/crypto/Crypto";
import * as managerApi from "../../api/plain/manager/ManagerApiTypes";

export class ApiKeyRepository {
    
    static readonly COLLECTION_NAME = "api_key";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.auth.ApiKeyId, db.auth.ApiKey>,
    ) {
    }
    
    async get(id: types.auth.ApiKeyId) {
        return this.repository.get(id);
    }
    
    async getApiKeyCount() {
        return this.repository.col().countDocuments();
    }
    
    async getMasterKey() {
        return this.repository.find(q => q.eq("masterKey", true));
    }
    
    async listForUser(userId: types.auth.ApiUserId) {
        return this.repository.findAll(q => q.eq("user", userId));
    }
    
    async create(userId: types.auth.ApiUserId, name: types.auth.ApiKeyName, scopes: types.auth.Scope[], masterKey: boolean, publicKey: types.core.EccPubKeyPEM|undefined) {
        const apiKey: db.auth.ApiKey = {
            id: this.generateId(),
            created: DateUtils.now(),
            user: userId,
            name: name,
            scopes: scopes,
            enabled: true,
            secret: publicKey ? this.getApiKeySecretFromPubKey(publicKey) : this.generateSecret(),
            publicKey: publicKey,
            masterKey: masterKey,
        };
        await this.repository.insert(apiKey);
        return apiKey;
    }
    
    async update(apiKey: db.auth.ApiKey, model: managerApi.UpdateApiKeyModel) {
        const newApiKey: db.auth.ApiKey = {...apiKey};
        if (model.name !== undefined) {
            newApiKey.name = model.name;
        }
        if (model.enabled !== undefined) {
            newApiKey.enabled = model.enabled;
        }
        if (model.scope !== undefined) {
            newApiKey.scopes = model.scope;
        }
        await this.repository.update(newApiKey);
    }
    
    async setEnabled(apiKeyId: types.auth.ApiKeyId, enabled: boolean) {
        await this.repository.collection.updateOne({_id: apiKeyId}, {$set: {enabled: enabled}});
    }
    
    async delete(id: types.auth.ApiKeyId) {
        await this.repository.delete(id);
    }
    
    private generateId() {
        return Crypto.randomBytes(16).toString("hex") as types.auth.ApiKeyId;
    }
    
    private generateSecret() {
        return Crypto.randomBytes(16).toString("hex") as types.auth.ApiKeySecret;
    }
    
    private getApiKeySecretFromPubKey(pubKey: types.core.EccPubKeyPEM) {
        return Crypto.md5(Buffer.from(pubKey, "utf8")).toString("hex") as types.auth.ApiKeySecret;
    }
}
