/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as managerApi from "../../api/plain/manager/ManagerApiTypes";
import * as types from "../../types";
import * as db from "../../db/Model";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { AppException } from "../../api/AppException";
import { DateUtils } from "../../utils/DateUtils";
import { ConfigService } from "../config/ConfigService";
import { TokenEncryptionKeyProvider } from "./TokenEncryptionKeyProvider";
import { TokenEncryptionService } from "./TokenEncryptionService";
import { SignatureVerificationService } from "./SignatureVerificationService";
import { WebSocketEx } from "../../CommonTypes";
import { AuthoriationUtils, ParsedScope } from "../../utils/AuthorizationUtils";

export class AuthService {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private configService: ConfigService,
        private tokenEncryptionService: TokenEncryptionService,
        private tokenEncryptionKeyProvider: TokenEncryptionKeyProvider,
        private signatureVerificationService: SignatureVerificationService,
        private webSocket: WebSocketEx|null,
    ) {
    }
    
    async authByApiKeyCredentials(apiKeyId: types.auth.ApiKeyId, apiKeySecret: types.auth.ApiKeySecret, scope: types.auth.Scope[]|undefined): Promise<managerApi.AuthResult> {
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(apiKeyId);
        if (!apiKey || !apiKey.enabled) {
            throw new AppException("API_KEY_DOES_NOT_EXIST");
        }
        const user = await this.repositoryFactory.createApiUserRepository().get(apiKey.user);
        if (!user || !user.enabled) {
            throw new AppException("API_KEY_DOES_NOT_EXIST");
        }
        if (apiKey.secret !== apiKeySecret) {
            throw new AppException("INVALID_CREDENTIALS");
        }
        const key = await this.tokenEncryptionKeyProvider.getCurrentKey();
        const parsedScope = this.prepareScope(apiKey, scope, key.refreshTokenTTL);
        const {session, connectionId} = await this.createSession(user.id, apiKey.id, key.refreshTokenTTL, parsedScope);
        return this.prepareTokenPair(key, session, connectionId);
    }
    
    async authByRefreshToken(refreshToken: types.auth.ApiRefreshToken): Promise<managerApi.AuthResult> {
        const tokenData = await this.tokenEncryptionService.decryptToken(refreshToken);
        if (!tokenData || tokenData.type !== "refreshToken") {
            throw new AppException("INVALID_TOKEN");
        }
        const session = await (async () => {
            if (tokenData.connectionId) {
                return this.webSocket && this.webSocket.ex.plainUserInfo && this.webSocket.ex.plainUserInfo.connectionId === tokenData.connectionId ? this.webSocket.ex.plainUserInfo.session : null;
            }
            return this.repositoryFactory.createTokenSessionRepository().get(tokenData.sessionId);
        })();
        if (!session || session.expiry < DateUtils.now()) {
            throw new AppException("INVALID_TOKEN");
        }
        if (session.seq !== tokenData.seq) {
            throw new AppException("INVALID_TOKEN");
        }
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(session.apiKey);
        if (!apiKey || !apiKey.enabled || apiKey.user !== session.user) {
            throw new AppException("INVALID_TOKEN");
        }
        const user = await this.repositoryFactory.createApiUserRepository().get(session.user);
        if (!user || !user.enabled) {
            throw new AppException("INVALID_TOKEN");
        }
        const key = await this.tokenEncryptionKeyProvider.getCurrentKey();
        if (session.id === "websocket") {
            session.seq++;
        }
        else {
            await this.repositoryFactory.createTokenSessionRepository().increaseSessionSeqAndSetExpiry(session, key.refreshTokenTTL);
        }
        return this.prepareTokenPair(key, session, tokenData.connectionId, tokenData.accessTokenTTL);
    }
    
    async authByApiKeySignature(apiKeyId: types.auth.ApiKeyId, scope: types.auth.Scope[]|undefined, timestamp: types.core.Timestamp, nonce: string, signature: types.core.Base64, data: string) {
        const apiKey = await this.repositoryFactory.createApiKeyRepository().get(apiKeyId);
        if (!apiKey || !apiKey.enabled) {
            throw new AppException("API_KEY_DOES_NOT_EXIST");
        }
        const user = await this.repositoryFactory.createApiUserRepository().get(apiKey.user);
        if (!user || !user.enabled) {
            throw new AppException("API_KEY_DOES_NOT_EXIST");
        }
        if (!await this.isValidClientSignature(apiKey, timestamp, nonce, signature, data)) {
            throw new AppException("INVALID_SIGNATURE");
        }
        const key = await this.tokenEncryptionKeyProvider.getCurrentKey();
        const parsedScope = this.prepareScope(apiKey, scope, key.refreshTokenTTL);
        const {session, connectionId} = await this.createSession(user.id, apiKey.id, key.refreshTokenTTL, parsedScope);
        return this.prepareTokenPair(key, session, connectionId);
    }
    
    private async prepareTokenPair(key: db.auth.TokenEncryptionKey, session: db.auth.TokenSession, connectionId: types.core.WsConnectionId|undefined, accessTokenTTL?: types.core.Timespan) {
        const now = DateUtils.now();
        const accessTokenData: db.auth.AccessTokenData = {
            type: "accessToken",
            created: now,
            expires: DateUtils.add(now, (accessTokenTTL) ? accessTokenTTL : this.configService.values.token.accessTokenLifetime),
            sessionId: session.id,
            seq: session.seq,
            connectionId: connectionId,
        };
        const accessToken = (await this.tokenEncryptionService.encrypt(accessTokenData, key)) as types.auth.ApiAccessToken;
        const refreshTokenData: db.auth.RefreshTokenData = {
            type: "refreshToken",
            created: now,
            expires: DateUtils.add(now, key.refreshTokenTTL),
            sessionId: session.id,
            seq: session.seq,
            connectionId: connectionId,
            accessTokenTTL: accessTokenTTL ? accessTokenTTL : undefined,
        };
        const refreshToken = (await this.tokenEncryptionService.encrypt(refreshTokenData, key)) as types.auth.ApiRefreshToken;
        const result: managerApi.AuthResult = {
            tokenType: "Bearer",
            accessToken: accessToken,
            accessTokenExpiry: accessTokenData.expires,
            refreshToken: refreshToken,
            refreshTokenExpiry: refreshTokenData.expires,
            scope: session.scopes,
        };
        return result;
    }
    
    private async createSession(user: types.auth.ApiUserId, apiKeyId: types.auth.ApiKeyId, ttl: types.core.Timespan, scopes: ParsedScope) {
        if (scopes.connectionLimited) {
            if (!this.webSocket || !this.webSocket.ex.plainUserInfo) {
                throw new AppException("INSUFFICIENT_SCOPE", "connection scope can be used with websocket only");
            }
            const session: db.auth.TokenSession = {
                id: "websocket" as db.auth.TokenSessionId,
                created: DateUtils.now(),
                expiry: DateUtils.nowAdd(DateUtils.days(9999)),
                user: user,
                seq: 0,
                scopes: scopes.scopes,
                apiKey: apiKeyId,
                ipAddress: scopes.ipAddress,
                solutions: scopes.solutions,
            };
            this.webSocket.ex.plainUserInfo.session = session;
            return {session, connectionId: this.webSocket.ex.plainUserInfo.connectionId};
        }
        const repo = this.repositoryFactory.createTokenSessionRepository();
        const sessions = await repo.getAllForUserSortedByCreated(user);
        if (scopes.sessionName) {
            const namedSession = sessions.find(x => x.name === scopes.sessionName);
            if (namedSession) {
                await repo.delete(namedSession.id);
            }
            else if (sessions.length >= 16) {
                await repo.delete(sessions[0].id);
            }
        }
        else {
            if (sessions.length >= 16) {
                await repo.delete(sessions[0].id);
            }
        }
        const session = await repo.create({
            userId: user,
            apiKeyId: apiKeyId,
            scopes: scopes.scopes,
            ttl: ttl,
            ip: scopes.ipAddress,
            name: scopes.sessionName,
            solutions: scopes.solutions,
        });
        return {session, connectionId: undefined};
    }
    
    private async isValidClientSignature(apiKey: db.auth.ApiKey, timestamp: types.core.Timestamp, nonce: string, signature: types.core.Base64, data: string) {
        return this.signatureVerificationService.verify({
            apiKey: apiKey,
            request: null,
            nonce: nonce,
            timestamp: timestamp,
            requestBody: Buffer.from(data),
            signature: signature,
        });
    }
    
    private prepareScope(apiKey: db.auth.ApiKey, scope: types.auth.Scope[]|undefined, refreshTokenTTL: types.core.Timespan) {
        if (scope) {
            const parsedScope = AuthoriationUtils.parseScope(scope, refreshTokenTTL);
            this.verifyScope(apiKey, parsedScope);
            return parsedScope;
        }
        return AuthoriationUtils.parseScope(apiKey.scopes, "ignore");
    }
    
    private verifyScope(apiKey: db.auth.ApiKey, parsedScope: ParsedScope) {
        const apiKeyScope = AuthoriationUtils.parseScope(apiKey.scopes, "ignore");
        for (const s of parsedScope.scopes) {
            if (!apiKeyScope.scopes.includes(s)) {
                throw new AppException("INSUFFICIENT_SCOPE", `Cannot use ${s}`);
            }
        }
        for (const solutionId of parsedScope.solutions) {
            if (!apiKeyScope.solutions.includes(solutionId) && !apiKeyScope.solutions.includes("*" as types.cloud.SolutionId)) {
                throw new AppException("INSUFFICIENT_SCOPE", `Cannot use solution=${solutionId}`);
            }
        }
        if (apiKeyScope.ipAddress && apiKeyScope.ipAddress !== parsedScope.ipAddress) {
            throw new AppException("INSUFFICIENT_SCOPE", "IP address must be the same as in ApiKey");
        }
    }
}
