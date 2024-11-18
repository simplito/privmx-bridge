/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseApi } from "../../../api/BaseApi";
import { ManagerApiValidator } from "./ManagerApiValidator";
import * as managerApi from "./ManagerApiTypes";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { AppException } from "../../../api/AppException";
import { ApiMethod } from "../../../api/Decorators";
import { AuthService } from "../../../service/auth/AuthService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import { ApiKeyService } from "../../../service/auth/ApiKeyService";
import { WebSocketEx } from "../../../CommonTypes";

export class ManagerApi extends BaseApi implements managerApi.IManagerApi {
    
    constructor(
        managerApiValidator: ManagerApiValidator,
        private authorizationDetector: AuthorizationDetector,
        private authorizationHolder: AuthorizationHolder,
        private authService: AuthService,
        private apiKeyService: ApiKeyService,
        private webSocketEx: WebSocketEx|null,
    ) {
        super(managerApiValidator);
    }
    
    async validateAccess(method: string) {
        await this.authorizationDetector.authorize();
        if (method !== "auth" && method !== "bindAccessToken" && !this.authorizationHolder.isAuthorized()) {
            throw new AppException("UNAUTHORIZED");
        }
    }
    
    @ApiMethod({errorCodes: ["API_KEY_DOES_NOT_EXIST", "INVALID_CREDENTIALS", "INVALID_TOKEN", "INVALID_SIGNATURE"]})
    async auth(model: managerApi.AuthModel): Promise<managerApi.AuthResult> {
        if (model.grantType === "api_key_credentials") {
            return this.authService.authByApiKeyCredentials(model.apiKeyId, model.apiKeySecret, model.scope);
        }
        if (model.grantType === "refresh_token") {
            return this.authService.authByRefreshToken(model.refreshToken);
        }
        if (model.grantType === "api_key_signature") {
            return this.authService.authByApiKeySignature(model.apiKeyId, model.scope, model.timestamp, model.nonce, model.signature, model.data || "");
        }
        throw new AppException("INVALID_PARAMS", "grantType");
    }
    
    @ApiMethod({errorCodes: ["API_KEYS_LIMIT_EXCEEDED"]})
    async createApiKey(model: managerApi.CreateApiKeyModel): Promise<managerApi.CreateApiKeyResult> {
        this.validateScope("apiKey");
        const apiKey = await this.apiKeyService.createApiKey(this.getAuth().user.id, model.name, model.scope, model.publicKey);
        return {id: apiKey.id, secret: apiKey.secret};
    }
    
    @ApiMethod({errorCodes: ["API_KEY_DOES_NOT_EXIST"]})
    async updateApiKey(model: managerApi.UpdateApiKeyModel): Promise<types.core.OK> {
        this.validateScope("apiKey");
        await this.apiKeyService.updateApiKey(this.getAuth().user.id, model);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["API_KEY_DOES_NOT_EXIST"]})
    async getApiKey(model: managerApi.GetApiKeyModel): Promise<managerApi.GetApiKeyResult> {
        this.validateScope("apiKey");
        const apiKey = await this.apiKeyService.getApiKey(this.getAuth().user.id, model.id);
        return {apiKey: this.convertApiKey(apiKey)};
    }
    
    @ApiMethod({})
    async listApiKeys(): Promise<managerApi.ListApiKeysResult> {
        this.validateScope("apiKey");
        const list = await this.apiKeyService.listApiKeys(this.getAuth().user.id);
        return {list: list.map(x => this.convertApiKey(x))};
    }
    
    @ApiMethod({errorCodes: ["API_KEY_DOES_NOT_EXIST"]})
    async deleteApiKey(model: managerApi.DeleteApiKeyModel): Promise<types.core.OK> {
        this.validateScope("apiKey");
        const auth = this.getAuth();
        if (auth.apiKey.id === model.id) {
            throw new AppException("ACCESS_DENIED", "Cannot remove api key which you aready use");
        }
        await this.apiKeyService.deleteApiKey(auth.user.id, model.id);
        return "OK";
    }
    
    @ApiMethod({errorCodes: []})
    async bindAccessToken(model: managerApi.BindAccessTokenModel): Promise<types.core.OK> {
        await this.authorizationDetector.bindAccessTokenToWebsocket(model.accessToken);
        return "OK";
    }

    @ApiMethod({errorCodes: ["METHOD_CALLABLE_WITH_WEBSOCKET_ONLY"]})
    async subscribeToChannel(model: managerApi.SubscribeToChannelModel): Promise<types.core.OK> {
        if (!this.webSocketEx || !this.webSocketEx.ex.plainUserInfo) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        for (const channel of model.channels) {
            this.validateScope(channel);
        }
        const solutions = this.getSolutionsToWhichUserIsLimited();
        for (const channel of model.channels) {
            const entry = this.webSocketEx.ex.plainUserInfo.plainApiChannels.get(channel);
            if (!entry) {
                this.webSocketEx.ex.plainUserInfo.plainApiChannels.set(channel, new Set(solutions));
            }
            else {
                solutions.forEach(solution => entry.add(solution));
            }
        }
        return "OK";
    }

    @ApiMethod({errorCodes: ["METHOD_CALLABLE_WITH_WEBSOCKET_ONLY"]})
    async unsubscribeFromChannel(model: managerApi.UnsubscribeFromChannelModel): Promise<types.core.OK> {
        if (!this.webSocketEx || !this.webSocketEx.ex.plainUserInfo) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        for (const channel of model.channels) {
            this.validateScope(channel);
        }
        const solutions = this.getSolutionsToWhichUserIsLimited();
        for (const channel of model.channels) {
            const entry = this.webSocketEx.ex.plainUserInfo.plainApiChannels.get(channel);
            if (!entry) {
                continue;
            }
            else {
                solutions.forEach(solution => entry.delete(solution));

            }
        }
        return "OK";
    }
    
    private validateScope(scope: string) {
        const auth = this.authorizationHolder.getAuth();
        if (!auth) {
            throw new AppException("UNAUTHORIZED");
        }
        const scopes = auth.session ? auth.session.scopes : auth.apiKey.scopes;
        if (!scopes.includes(scope as types.auth.Scope)) {
            throw new AppException("INSUFFICIENT_SCOPE", scope);
        }
    }

    private getSolutionsToWhichUserIsLimited() {
        const solutions: types.cloud.SolutionId[] = [];
        const auth = this.authorizationHolder.getAuth();
        if (!auth) {
            throw new AppException("INSUFFICIENT_SCOPE");
        }
        const scopes = auth.session ? auth.session.scopes : auth.apiKey.scopes;
        for (const scope of scopes) {
            if (scope.startsWith("solution:")) {
                solutions.push(scope.substring("solution:".length) as types.cloud.SolutionId);
            }
        }
        return solutions;
    }
    
    private convertApiKey(apiKey: db.auth.ApiKey) {
        const result: managerApi.ApiKey = {
            id: apiKey.id,
            created: apiKey.created,
            enabled: apiKey.enabled,
            name: apiKey.name,
            scope: apiKey.scopes,
            publicKey: apiKey.publicKey,
        };
        return result;
    }
    
    private getAuth() {
        const auth = this.authorizationHolder.getAuth();
        if (!auth) {
            throw new Error("Authorization required");
        }
        return auth;
    }
}
