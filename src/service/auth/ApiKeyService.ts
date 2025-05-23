/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { AppException } from "../../api/AppException";
import * as managerApi from "../../api/plain/manager/ManagerApiTypes";
import { AuthoriationUtils } from "../../utils/AuthorizationUtils";
import { LockHelper } from "../misc/LockHelper";
import { Config } from "../../cluster/common/ConfigUtils";

export class ApiKeyService {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private lockHelper: LockHelper,
        private config: Config,
    ) {
    }
    
    async createFirstApiKey(initializationToken: types.auth.InitializationToken, name: types.auth.ApiKeyName, publicKey: types.core.EccPubKeyPEM|undefined) {
        return this.lockHelper.withLock("first-api-key-creation", async () => {
            const apiKeyCount = await this.repositoryFactory.createApiKeyRepository().getApiKeyCount();
            if (apiKeyCount !== 0) {
                throw new AppException("FIRST_API_KEY_ALREADY_EXISTS");
            }
            if (!this.config.server.initializationToken || initializationToken !== this.config.server.initializationToken) {
                throw new AppException("INITIALIZATION_TOKEN_MISSMATCH");
            }
            const user = await this.repositoryFactory.createApiUserRepository().create();
            return await this.repositoryFactory.createApiKeyRepository().create(user.id, name as types.auth.ApiKeyName, [
                "context", "apiKey", "solution", "solution:*", "inbox", "store", "thread", "stream", "kvdb",
            ] as types.auth.Scope[], true, publicKey);
        });
    }
    
    async createApiKey(userId: types.auth.ApiUserId, name: types.auth.ApiKeyName, scope: types.auth.Scope[], publicKey: types.core.EccPubKeyPEM|undefined) {
        const apiKeys = await this.repositoryFactory.createApiKeyRepository().listForUser(userId);
        if (apiKeys.length > 10) {
            throw new AppException("API_KEYS_LIMIT_EXCEEDED");
        }
        AuthoriationUtils.parseScope(scope, "disabled");
        return this.repositoryFactory.createApiKeyRepository().create(userId, name, scope, false, publicKey);
    }
    
    async updateApiKey(userId: types.auth.ApiUserId, model: managerApi.UpdateApiKeyModel) {
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(model.id);
        if (!apiKey) {
            throw new AppException("API_KEY_DOES_NOT_EXIST");
        }
        if (apiKey.user !== userId) {
            throw new AppException("ACCESS_DENIED");
        }
        if (model.scope) {
            AuthoriationUtils.parseScope(model.scope, "disabled");
        }
        await this.repositoryFactory.createApiKeyRepository().update(apiKey, model);
    }
    
    async deleteApiKey(userId: types.auth.ApiUserId, apiKeyId: types.auth.ApiKeyId) {
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(apiKeyId);
        if (!apiKey) {
            throw new AppException("API_KEY_DOES_NOT_EXIST");
        }
        if (apiKey.user !== userId) {
            throw new AppException("ACCESS_DENIED");
        }
        await this.repositoryFactory.createApiKeyRepository().delete(apiKeyId);
    }
    
    async listApiKeys(userId: types.auth.ApiUserId) {
        return this.repositoryFactory.createApiKeyRepository().listForUser(userId);
    }
    
    async getApiKey(userId: types.auth.ApiUserId, apiKeyId: types.auth.ApiKeyId) {
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(apiKeyId);
        if (!apiKey) {
            throw new AppException("API_KEY_DOES_NOT_EXIST");
        }
        if (apiKey.user !== userId) {
            throw new AppException("ACCESS_DENIED");
        }
        return apiKey;
    }
}
