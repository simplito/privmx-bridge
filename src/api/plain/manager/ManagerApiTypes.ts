/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export type AuthModel = AuthByApiKeyCredentialsModel|AuthByRefreshTokenModel|AuthByApiKeySignatureModel;

export interface AuthByRefreshTokenModel {
    /** Token grant type */
    grantType: "refresh_token";
    /** Refresh token from earlier invocation */
    refreshToken: types.auth.ApiRefreshToken;
}

export interface AuthByApiKeyCredentialsModel {
    /** Token grant type */
    grantType: "api_key_credentials";
    /** Api key id */
    apiKeyId: types.auth.ApiKeyId;
    /** Api key secret */
    apiKeySecret: types.auth.ApiKeySecret;
    /** Requested token scope */
    scope?: types.auth.Scope[];
}

export interface AuthByApiKeySignatureModel {
    /** Token grant type */
    grantType: "api_key_signature";
    /** Api key id */
    apiKeyId: types.auth.ApiKeyId;
    /** EdDSA signature or Hash */
    signature: types.core.Base64;
    /** Request timestamp */
    timestamp: types.core.Timestamp;
    /** Random value used to generate signature*/
    nonce: string;
    /** Requested token scope */
    scope?: types.auth.Scope[];
    /** Optional signed data */
    data?: string;
}

export interface AuthResult {
    /** Access token used in authorization*/
    accessToken: types.auth.ApiAccessToken;
    /** Access token expiration timestamp */
    accessTokenExpiry: types.core.Timestamp;
    /** Token type */
    tokenType: "Bearer";
    /** Refresh token that will be used to generate new tokens */
    refreshToken: types.auth.ApiRefreshToken;
    /** Refresh token expiration timestamp */
    refreshTokenExpiry: types.core.Timestamp;
    /** Created token scope */
    scope: types.auth.Scope[];
}

export interface CreateFirstApiKeyModel {
    /** Initialization token */
    initializationToken: types.auth.InitializationToken;
    /** New api key name */
    name: types.auth.ApiKeyName;
    /** ED25519 PEM encoded public key */
    publicKey?: types.core.EccPubKeyPEM;
}

export type CreateFirstApiKeyResult = CreateApiKeyResult;

export interface CreateApiKeyModel {
    /** New api key name */
    name: types.auth.ApiKeyName;
    /** New api key scope */
    scope: types.auth.Scope[];
    /** ED25519 PEM encoded public key */
    publicKey?: types.core.EccPubKeyPEM;
}

export interface CreateApiKeyResult {
    /** New api key id */
    id: types.auth.ApiKeyId;
    /** New api key secret */
    secret: types.auth.ApiKeySecret;
}

export interface DeleteApiKeyModel {
    /** Api key id */
    id: types.auth.ApiKeyId;
}

export interface ListApiKeysResult {
    /** Api key info list */
    list: ApiKey[];
}

export interface ApiKey {
    /** Api key id */
    id: types.auth.ApiKeyId;
    /** Api key creation timestamp */
    created: types.core.Timestamp;
    /** Api key status */
    enabled: boolean;
    /** Api key name */
    name: types.auth.ApiKeyName;
    /** Api key scope */
    scope: types.auth.Scope[];
    /** Api key public key */
    publicKey?: types.core.EccPubKeyPEM;
}

export interface GetApiKeyModel {
    /** Api key id */
    id: types.auth.ApiKeyId;
}

export interface GetApiKeyResult {
    /** Api key info */
    apiKey: ApiKey;
}

export interface UpdateApiKeyModel {
    /** Api key id */
    id: types.auth.ApiKeyId;
    /** Api key name */
    name?: types.auth.ApiKeyName;
    /** Api key scope */
    scope?: types.auth.Scope[];
    /** Api key status */
    enabled?: boolean;
}

export interface BindAccessTokenModel {
    /** Access token */
    accessToken: types.auth.ApiAccessToken;
}

export interface SubscribeToChannelModel {
    /** Channels list */
    channels: types.core.WsChannelName[];
}

export interface UnsubscribeFromChannelModel {
    /** Channels list */
    channels: types.core.WsChannelName[];
}

export interface IManagerApi {
    /**
    *<p>Retrieve an Oauth access token, to be used for authentication of requests.</p>
    <p>Two methods of authentication are supported:</p>
    - ```api_key_credentials``` - using the apikey id and apikey secret<br>
    - ```api_key_signature``` - using the apikey id user generated signature. The signature is calculated using fields provided in the request. Method and URI are ommited in this signature: <br>
                                ```"" + "\n" + "" + "\n" + $dataField + "\n"```<br>
    - ```refresh_token``` - using a refresh token that was received from an earlier invocation<br>
    <br>
    <p>The response will contain an access token, expiration timestamp and a refresh token that can be used to get a new set of tokens.</p>
    * @param model GrantType and credentials
    * @returns accessToken, refreshToken, expiryTime and scope
    */
    auth(model: AuthModel): Promise<AuthResult>;
    /**
    * Adds new ApiKey (up to limit of 10). If you pass a public key you cannot use generated api key secret to authorize
    * @param model api key name, scope and optional public key
    * @returns api key id and secret
    */
    createFirstApiKey(model: CreateFirstApiKeyModel): Promise<CreateFirstApiKeyResult>;
    /**
    * Adds new ApiKey (up to limit of 10). If you pass a public key you cannot use generated api key secret to authorize
    * @param model api key name, scope and optional public key
    * @returns api key id and secret
    */
    createApiKey(model: CreateApiKeyModel): Promise<CreateApiKeyResult>;
    /**
    * returns info about ApiKey
    * @param model api key id
    * @returns api key info
    */
    getApiKey(model: GetApiKeyModel): Promise<GetApiKeyResult>;
    /**
    * lists all ApiKeys
    * @returns list of api keys
    */
    listApiKeys(): Promise<ListApiKeysResult>;
    /**
    * updates given ApiKey
    * @param model api key id, name, scope, status
    * @returns OK
    */
    updateApiKey(model: UpdateApiKeyModel): Promise<types.core.OK>;
    /**
    * Deletes ApiKey
    * @param model api key id
    * @returns OK
    */
    deleteApiKey(model: DeleteApiKeyModel): Promise<types.core.OK>;
    /**
    * Bind Access Token to websocket, request will be executed with the given Token rights.
    * @param model Access Token
    * @returns OK
    */
    bindAccessToken(model: BindAccessTokenModel): Promise<types.core.OK>;
    /**
    * Subscribes to notifications from given channels.
    * @param model List of channels
    * @returns OK
    */
    subscribeToChannel(model: SubscribeToChannelModel): Promise<types.core.OK>
    /**
    * Removes given channels from subscribed.
    * @param model List of channels
    * @returns OK
    */
    unsubscribeFromChannel(model: UnsubscribeFromChannelModel): Promise<types.core.OK>
}
