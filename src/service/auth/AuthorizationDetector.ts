/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as http from "http";
import { Utils } from "../../utils/Utils";
import * as types from "../../types";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { TokenEncryptionService } from "./TokenEncryptionService";
import { DateUtils } from "../../utils/DateUtils";
import { AuthorizationHolder } from "./AuthorizationHolder";
import { RequestSignature } from "../../utils/RequestSignature";
import { SignatureVerificationService } from "./SignatureVerificationService";
import { HttpUtils } from "../../utils/HttpUtils";
import { WebSocketEx } from "../../CommonTypes";
import { AppException } from "../../api/AppException";
import { AuthoriationUtils } from "../../utils/AuthorizationUtils";
import { RequestInfoHolder } from "../../api/session/RequestInfoHolder";

export class AuthorizationDetector {
    
    private tokenFromRequestPayload?: types.auth.ApiAccessToken;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private tokenEncryptionService: TokenEncryptionService,
        private signatureVerificationService: SignatureVerificationService,
        private authorizationHolder: AuthorizationHolder,
        private request: http.IncomingMessage|null,
        private webSocket: WebSocketEx|null,
        private requestInfoHolder: RequestInfoHolder,
    ) {
    }
    
    setTokenFromRequestPayload(token: types.auth.ApiAccessToken) {
        this.tokenFromRequestPayload = token;
    }
    
    async bindAccessTokenToWebsocket(token: types.auth.ApiAccessToken) {
        if (!this.webSocket || !this.webSocket.ex.plainUserInfo) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const res = await this.isApiAccessTokenValid(token);
        if (res === false) {
            throw new AppException("INVALID_TOKEN");
        }
        this.webSocket.ex.plainUserInfo.token = token;
    }
    
    async authorize() {
        if (this.tokenFromRequestPayload) {
            return this.bearerAuthorization(this.tokenFromRequestPayload);
        }
        if (this.webSocket) {
            return this.authorizeByWebsocket();
        }
        if (this.request) {
            return this.authorizeByRequest();
        }
    }
    
    async authorizeByWebsocket() {
        if (this.webSocket && this.webSocket.ex.plainUserInfo && this.webSocket.ex.plainUserInfo.token) {
            return this.bearerAuthorization(this.webSocket.ex.plainUserInfo.token);
        }
    }
    
    async authorizeByRequest() {
        if (!this.request) {
            return;
        }
        const authorizationHeader = this.request.headers.authorization;
        if (!authorizationHeader) {
            return;
        }
        const authHeader = this.parseAuthHeader(authorizationHeader);
        if (authHeader === false) {
            return;
        }
        if (authHeader.type === "Basic") {
            return this.basicAuthorization(authHeader.value);
        }
        if (authHeader.type === "Bearer") {
            return this.bearerAuthorization(authHeader.value as types.auth.ApiAccessToken);
        }
        else if (authHeader.type === RequestSignature.PMX_HMAC_SHA256) {
            return this.signatureAuthorization(this.request, authHeader.value);
        }
    }
    
    private parseAuthHeader(authorizationHeader: string) {
        const values = authorizationHeader.split(" ");
        return values.length === 2 ? {type: values[0], value: values[1]} : false;
    }
    
    private async basicAuthorization(httpBasic: string) {
        const credentials = this.parseHttpBasic(httpBasic);
        if (!credentials) {
            return;
        }
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(credentials.apiKeyId);
        if (!apiKey || !apiKey.enabled || apiKey.publicKey || apiKey.secret !== credentials.apiKeySecret) {
            return;
        }
        const user = await this.repositoryFactory.createApiUserRepository().get(apiKey.user);
        if (!user || !user.enabled) {
            return;
        }
        const ipAddress = AuthoriationUtils.getIpAddressFromScope(apiKey.scopes);
        if (ipAddress && this.requestInfoHolder.ip !== ipAddress) {
            return;
        }
        this.authorizationHolder.authorize(user, apiKey, null);
    }
    
    private parseHttpBasic(httpBasic: string) {
        const credentials = Utils.try(() => atob(httpBasic));
        if (credentials.success === false) {
            return null;
        }
        const values = credentials.result.split(":");
        if (values.length !== 2) {
            return null;
        }
        const [apiKeyId, apiKeySecret] = values;
        return {apiKeyId: apiKeyId as types.auth.ApiKeyId, apiKeySecret: apiKeySecret as types.auth.ApiKeySecret};
    }
    
    private async bearerAuthorization(token: types.auth.ApiAccessToken) {
        const res = await this.isApiAccessTokenValid(token);
        if (res == false) {
            return;
        }
        this.authorizationHolder.authorize(res.user, res.apiKey, res.session);
    }
    
    private async isApiAccessTokenValid(token: types.auth.ApiAccessToken) {
        const tokenData = await this.tokenEncryptionService.decryptToken(token);
        if (!tokenData || tokenData.type !== "accessToken") {
            return false;
        }
        const session = await (async () => {
            if (tokenData.connectionId) {
                return this.webSocket && this.webSocket.ex.plainUserInfo && this.webSocket.ex.plainUserInfo.connectionId === tokenData.connectionId ? this.webSocket.ex.plainUserInfo.session : null;
            }
            return this.repositoryFactory.createTokenSessionRepository().get(tokenData.sessionId);
        })();
        if (!session || session.expiry < DateUtils.now()) {
            return false;
        }
        if (tokenData.expires < DateUtils.now()) {
            return false;
        }
        if (session.seq !== tokenData.seq) {
            return false;
        }
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(session.apiKey);
        if (!apiKey || !apiKey.enabled || apiKey.user !== session.user) {
            return false;
        }
        const user = await this.repositoryFactory.createApiUserRepository().get(session.user);
        if (!user || !user.enabled) {
            return false;
        }
        if (session.ipAddress && this.requestInfoHolder.ip !== session.ipAddress) {
            return false;
        }
        return {tokenData, session: {scopes: session.scopes}, apiKey, user};
    }
    
    private async signatureAuthorization(request: http.IncomingMessage, pmxSignature: string) {
        const info = await this.parsePmxHmacSig(pmxSignature);
        if (info === false) {
            return;
        }
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(info.apiKeyId);
        if (!apiKey || !apiKey.enabled) {
            return;
        }
        const user = await this.repositoryFactory.createApiUserRepository().get(apiKey.user);
        if (!user || !user.enabled) {
            return;
        }
        const verifed = await this.signatureVerificationService.verify({
            apiKey: apiKey,
            request: request,
            nonce: info.nonce,
            timestamp: info.timestamp as types.core.Timestamp,
            requestBody: await HttpUtils.readBody(request),
            signature: info.signature,
        });
        if (!verifed) {
            return;
        }
        const ipAddress = AuthoriationUtils.getIpAddressFromScope(apiKey.scopes);
        if (ipAddress && this.requestInfoHolder.ip !== ipAddress) {
            return;
        }
        this.authorizationHolder.authorize(user, apiKey, null);
    }

    private async parsePmxHmacSig(value: string) {
        const info = RequestSignature.parseHeader(value);
        if (info === false || info.version !== "1") {
            return false;
        }
        return info;
    }
}
