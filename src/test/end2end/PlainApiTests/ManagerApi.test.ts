/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode, Test, verifyResponseFor } from "../BaseTestSet";
import * as types from "../../../types";
import { testData } from "../../datasets/testData";
import * as assert from "assert";
import { ClientSignatureJsonRpcClient } from "../../../utils/ClientSignatureClient";
import { ManagementContextApiClient } from "../../../api/plain/context/ManagementContextApiClient";
import { Crypto } from "../../../utils/crypto/Crypto";
import { WebSocketClient, WebSocketJsonRpcRequester } from "../../../utils/WebSocketJsonRpcClient";
import { ManagerApiClient } from "../../../api/plain/manager/ManagerApiClient";
import { PromiseUtils } from "../../../utils/PromiseUtils";
import { DateUtils } from "../../../utils/DateUtils";
import { RequestSignature } from "../../../utils/RequestSignature";

export class ManagerApiTests extends BaseTestSet {

    private accessToken?: types.auth.ApiAccessToken;
    private refreshToken?: types.auth.ApiRefreshToken;
    private oldAccessToken?: types.auth.ApiAccessToken;
    private oldRefreshToken?: types.auth.ApiRefreshToken;
    private newApiKeyId?: types.auth.ApiKeyId;
    private newApiKeySecret?: types.auth.ApiKeySecret;
    private plainContextApi?: ManagementContextApiClient;
    private apiKeyPublicKey?: types.core.EccPubKeyPEM;
    private apiKeyPrivateKey?: string;
    private wsManagerApi?: ManagerApiClient;
    private websocket?: WebSocketJsonRpcRequester;

    @Test()
    async shouldCreateApiKeyAndBeAbleToSendRequest() {
        await this.loginForToken();
        await this.addApiKeyWithSecretUsingToken();
        await this.listAllApiKeys();
        await this.getApiKey();
        await this.getContextWithApiKeyClientCredentials();
        await this.getContextWithApiKeyClientHmacSignature();
        await this.deleteNewApiKey();
        await this.validateIfApiKeyWasDeleted();
    }

    @Test()
    async shouldNotBeAbleToSendRequestAfterApiKeyDisable() {
        await this.loginForToken();
        await this.addApiKeyWithSecretUsingToken();
        await this.getContextWithApiKeyClientCredentials();
        await this.disableApiKey();
        await this.tryGetContextWithApiKeyAndFail();
    }

    @Test()
    async shouldCreateApiKeyWithPublicKeyAndBeAbleToSendRequest() {
        await this.loginForToken();
        await this.addApiKeyWithPublicKeyUsingToken();
        await this.getContextWithApiKeyEddsaSignature();
    }

    @Test()
    async shouldCreateAccessTokenFromApiKeyAndBeAbleToSendRequest() {
        await this.loginForToken();
        await this.getContextWithAccessToken();
        await this.refreshAccessToken();
        await this.tryGetContextWithOldTokenAndFail();
        await this.tryRefreshWithOldRefreshTokenAndFail();
        await this.getContextWithAccessToken();
        await this.tryCreateSolutionAndFail();
        await this.disableApiKeyThatTokenWasDerivedFrom();
        await this.tryGetContextWithAccessTokenDerivedFromDisabledApiKey();
    }

    @Test()
    async shouldReceiveNotificationFromSubscribedChannel() {
        await this.loginForToken();
        await this.establishWebsocketConnection();
        await this.bindAccessToken();
        await this.createNewThread();
        await this.shouldNotReceiveNotification();
        await this.subscribeOnThreadChannelChannel();
        await this.createNewThread();
        await this.shouldReceiveNotification();
    }

    @Test()
    async shouldCreateAccessTokenUsingSignature() {
        await this.authBySignature();
    }

    @Test()
    async shouldCreateAccessTokenUsingSignatureInWebsocket() {
        await this.establishWebsocketConnection();
        await this.authBySignatureInWebsocket();
    }

    async establishWebsocketConnection() {
        const ws = await WebSocketClient.connectToWs("ws://" + this.config.server.hostname + ":" + this.config.server.port + "/api");
        this.websocket = ws;
        this.wsManagerApi = new ManagerApiClient(ws);
    }

    async bindAccessToken() {
        if (!this.accessToken || !this.wsManagerApi) {
            throw new Error("Access token or managerApi not initialized yet");
        }
        const res = await this.wsManagerApi.bindAccessToken({
            accessToken: this.accessToken,
        });
        assert(res === "OK", "bindAccessToken invalid response, got: " + JSON.stringify(res, null, 2));
    }

    async subscribeOnThreadChannelChannel() {
        if(!this.wsManagerApi) {
            throw new Error("Access token not initialized yet");
        }

        const res = await this.wsManagerApi.subscribeToChannel({
            channels: ["thread"],
        });

        assert(res === "OK", "subscribeToChannel invalid response, got: " + JSON.stringify(res, null, 2));
    }

    async shouldReceiveNotification() {
        await PromiseUtils.wait(1000);
        if (!this.websocket) {
            throw new Error("Websocket not initialized");
        }
        const notifications = this.websocket.popAllNotifications();
        assert(notifications.length === 1 && notifications[0].type === "threadCreated", "Invalid number or type of notifications");
    }

    async shouldNotReceiveNotification() {
        await PromiseUtils.wait(1000);
        if (!this.websocket) {
            throw new Error("Websocket not initialized");
        }
        const notifications = this.websocket.popAllNotifications();
        assert(notifications.length === 0, "Expected notifications length: 0, received: " + notifications.length);
    }

    async createNewThread() {
        await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
    }

    async loginForToken() {
        this.helpers.authorizePlainApi();
        const token = await this.plainApis.managerApi.auth({
            grantType: "api_key_credentials",
            apiKeyId: testData.apiKeyId,
            apiKeySecret: testData.apiKeySecret,
            scope: ["solution:*", "apiKey", "context", "thread"] as types.auth.Scope[],
        });

        verifyResponseFor("auth", token, ["accessToken", "refreshToken"]);
        this.refreshToken = token.refreshToken;
        this.accessToken = token.accessToken;
    }

    async addApiKeyWithSecretUsingToken() {
        if (!this.accessToken) {
            throw new Error("accessToken not initalized yet!");
        }
        this.plainApis.jsonRpcClient.setHeader("Authorization", "Bearer " + this.accessToken);

        const result = await this.plainApis.managerApi.createApiKey({
            name: "Test Api Key" as types.auth.ApiKeyName,
            scope: ["context"] as types.auth.Scope[],
        });

        verifyResponseFor("createApiKey", result, ["id", "secret"]);

        this.newApiKeyId = result.id;
        this.newApiKeySecret = result.secret;
    }

    async getContextWithApiKeyClientCredentials() {
        if (!this.newApiKeyId || !this.newApiKeySecret) {
            throw new Error("new ApiKey id or secret not initialized yet");
        };

        this.plainApis.jsonRpcClient.setHeader("Authorization", "Basic " + Buffer.from(`${this.newApiKeyId}:${this.newApiKeySecret}`).toString("base64"));
        
        const result = await this.plainApis.contextApi.getContext({
            contextId: testData.contextId,
        });

        verifyResponseFor("getContext", result, ["context"]);
    }

    async getContextWithApiKeyClientHmacSignature() {
        if (!this.newApiKeyId || !this.newApiKeySecret) {
            throw new Error("new ApiKey id or secret not initialized yet");
        };

        const signatureJsonRpcClient = new ClientSignatureJsonRpcClient("http://" + this.config.server.hostname + ":" + this.config.server.port + "/api", {
            "Content-type": "application/json",
        }, this.newApiKeyId, this.newApiKeySecret, "hmac");

        this.plainContextApi = new ManagementContextApiClient(signatureJsonRpcClient);

        const result = await this.plainContextApi.getContext({
            contextId: testData.contextId,
        });

        verifyResponseFor("getContext", result, ["context"]);
    }

    async addApiKeyWithPublicKeyUsingToken() {
        if (!this.accessToken) {
            throw new Error("accessToken not initalized yet!");
        }
        this.plainApis.jsonRpcClient.setHeader("Authorization", "Bearer " + this.accessToken);

        const {privateKey, publicKey} = Crypto.genKeyPair();
        
        this.apiKeyPrivateKey = privateKey;
        this.apiKeyPublicKey = publicKey as types.core.EccPubKeyPEM;

        const result = await this.plainApis.managerApi.createApiKey({
            name: "Test Api Key" as types.auth.ApiKeyName,
            scope: ["context"] as types.auth.Scope[],
            publicKey: this.apiKeyPublicKey,
        });

        verifyResponseFor("createApiKey", result, ["id", "secret"]);

        this.newApiKeyId = result.id;
    }

    async getContextWithApiKeyEddsaSignature() {
        if (!this.newApiKeyId || !this.apiKeyPrivateKey) {
            throw new Error("new ApiKeyId or private key not initialized yet");
        };

        const signatureJsonRpcClient = new ClientSignatureJsonRpcClient("http://" + this.config.server.hostname + ":" + this.config.server.port + "/api", {
            "Content-type": "application/json",
        }, this.newApiKeyId, this.apiKeyPrivateKey, "eddsa");

        this.plainContextApi = new ManagementContextApiClient(signatureJsonRpcClient);

        const result = await this.plainContextApi.getContext({
            contextId: testData.contextId,
        });

        verifyResponseFor("getContext", result, ["context"]);
    }

    async disableApiKey() {
        if (!this.newApiKeyId) {
            throw new Error("new ApiKeyId not initialized yet");
        }
        this.helpers.authorizePlainApi();
        
        const result = await this.plainApis.managerApi.updateApiKey({
            id: this.newApiKeyId,
            enabled: false,
        });

        assert(result === "OK", "updateApiKey() invalid response, got: " + JSON.stringify(result, null, 2));
    }

    async tryGetContextWithApiKeyAndFail() {
        if (!this.newApiKeyId || !this.newApiKeySecret) {
            throw new Error("new ApiKey id or secret not initialized yet");
        };

        this.plainApis.jsonRpcClient.setHeader("Authorization", "Basic " + Buffer.from(`${this.newApiKeyId}:${this.newApiKeySecret}`).toString("base64"));
        
        await shouldThrowErrorWithCode(async () => this.plainApis.contextApi.getContext({
            contextId: testData.contextId,
        }), "UNAUTHORIZED");
    }

    async getContextWithAccessToken() {
        if (!this.accessToken) {
            throw new Error("accessToken not initalized yet!");
        }
        this.plainApis.jsonRpcClient.setHeader("Authorization", "Bearer " + this.accessToken);

        const result = await this.plainApis.contextApi.getContext({
            contextId: testData.contextId,
        });

        verifyResponseFor("getContext", result, ["context"]);
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error("Refresh token not initialized yet!");
        }

        const result = await this.plainApis.managerApi.auth({
            grantType: "refresh_token",
            refreshToken: this.refreshToken,
        });

        verifyResponseFor("auth", result, ["accessToken", "refreshToken"]);

        this.oldAccessToken = this.accessToken;
        this.oldRefreshToken = this.refreshToken;
        this.accessToken = result.accessToken;
        this.refreshToken = result.refreshToken;
    }

    async tryGetContextWithOldTokenAndFail() {
        if (!this.oldAccessToken) {
            throw new Error("oldAccessToken not initalized yet!");
        }
        this.plainApis.jsonRpcClient.setHeader("Authorization", "Bearer " + this.oldAccessToken);
        
        await shouldThrowErrorWithCode(async () => this.plainApis.contextApi.getContext({
            contextId: testData.contextId,
        }), "UNAUTHORIZED");
    }

    async tryRefreshWithOldRefreshTokenAndFail() {
        const oldRefreshToken = this.oldRefreshToken;
        if (!oldRefreshToken) {
            throw new Error("Old refresh token not initialized yet!");
        }
        
        await shouldThrowErrorWithCode(async () => this.plainApis.managerApi.auth({
            grantType: "refresh_token",
            refreshToken: oldRefreshToken,
        }), "INVALID_TOKEN");
    }

    async tryCreateSolutionAndFail() {
        if (!this.accessToken) {
            throw new Error("accessToken not initalized yet!");
        }
        this.plainApis.jsonRpcClient.setHeader("Authorization", "Bearer " + this.accessToken);

        await shouldThrowErrorWithCode(() => this.plainApis.solutionApi.createSolution({
            name: "new solution2" as types.cloud.SolutionName,
        }), "INSUFFICIENT_SCOPE");
    }

    async tryGetContextWithAccessTokenDerivedFromDisabledApiKey() {
        if (!this.accessToken) {
            throw new Error("accessToken not initalized yet!");
        }
        this.plainApis.jsonRpcClient.setHeader("Authorization", "Bearer " + this.accessToken);

        await shouldThrowErrorWithCode(async () => this.plainApis.contextApi.getContext({
            contextId: testData.contextId,
        }), "UNAUTHORIZED");
    }

    async disableApiKeyThatTokenWasDerivedFrom() {
        this.helpers.authorizePlainApi();
        
        const result = await this.plainApis.managerApi.updateApiKey({
            id: testData.apiKeyId,
            enabled: false,
        });

        assert(result === "OK", "updateApiKey() invalid response, got: " + JSON.stringify(result, null, 2));
    }

    async listAllApiKeys() {
        this.helpers.authorizePlainApi();

        const result = await this.plainApis.managerApi.listApiKeys();
        assert(!!result && "list" in result, "listApiKeys() invalid response, got: " + JSON.stringify(result, null, 2));
        verifyResponseFor("listApiKeys", result, ["list"]);
    }

    async getApiKey() {
        if (!this.newApiKeyId) {
            throw new Error("newApiKeyId not initialized yet");
        }
        this.helpers.authorizePlainApi();

        const result = await this.plainApis.managerApi.getApiKey({
            id: this.newApiKeyId,
        });
        
        verifyResponseFor("getApiKey", result, ["apiKey"]);
    }

    async deleteNewApiKey() {
        if (!this.newApiKeyId) {
            throw new Error("newApiKeyId not initialized yet");
        }
        this.helpers.authorizePlainApi();

        const result = await this.plainApis.managerApi.deleteApiKey({
            id: this.newApiKeyId,
        });
        
        assert(result === "OK", "deleteApiKey() invalid response, got: " + JSON.stringify(result, null, 2));
    }

    async validateIfApiKeyWasDeleted() {
        if (!this.newApiKeyId) {
            throw new Error("newApiKeyId not initialized yet");
        }

        this.helpers.authorizePlainApi();
    
        const result = await this.plainApis.managerApi.listApiKeys();

        verifyResponseFor("listApiKeys", result, ["list"]);
        const apiKey = result.list.find(apikey => apikey.id === this.newApiKeyId);
        assert(!apiKey, "Api key that should be deleted was found");
    }

    async authBySignature() {
        this.helpers.authorizePlainApi();
        const now = DateUtils.now();
        const nonce = Crypto.randomBytes(32).toString("base64");
        const result = await this.plainApis.managerApi.auth({
            grantType: "api_key_signature",
            apiKeyId: testData.apiKeyId,
            nonce,
            timestamp: now,
            signature: RequestSignature.signHmac({
                apiKeyId: testData.apiKeyId,
                apiKeySecret: testData.apiKeySecret,
                httpMethod: "",
                nonce,
                requestBody: Buffer.from(""),
                timestamp: now,
                urlPath: "",
            }) as types.core.Base64,
            data: "",
        });

        verifyResponseFor("auth", result, ["accessToken", "refreshToken"]);
    }

    async authBySignatureInWebsocket() {
        if (!this.websocket) {
            throw new Error("websocket not initialized yet!");
        }

        this.wsManagerApi = new ManagerApiClient(this.websocket);
        const now = DateUtils.now();
        const nonce = Crypto.randomBytes(32).toString("base64");
        const result = await this.wsManagerApi.auth({
            grantType: "api_key_signature",
            apiKeyId: testData.apiKeyId,
            nonce,
            timestamp: now,
            signature: RequestSignature.signHmac({
                apiKeyId: testData.apiKeyId,
                apiKeySecret: testData.apiKeySecret,
                httpMethod: "",
                nonce,
                requestBody: Buffer.from(""),
                timestamp: now,
                urlPath: "",
            }) as types.core.Base64,
            data: "",
        });
        verifyResponseFor("auth", result, ["accessToken", "refreshToken"]);
    }

}