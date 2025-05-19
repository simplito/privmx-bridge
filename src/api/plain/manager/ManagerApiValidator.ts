/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../../api/BaseValidator";
import { TypesValidator } from "../../../api/TypesValidator";

export class ManagerApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("auth", this.builder.createOneOf([
            this.builder.createObject({
                grantType: this.builder.createConst("refresh_token"),
                refreshToken: this.tv.apiRefreshToken,
            }),
            this.builder.createObject({
                grantType: this.builder.createConst("api_key_credentials"),
                apiKeyId: this.tv.apiKeyId,
                apiKeySecret: this.tv.apiKeySecret,
                scope: this.builder.optional(this.tv.apiScope),
            }),
            this.builder.createObject({
                grantType: this.builder.createConst("api_key_signature"),
                apiKeyId: this.tv.apiKeyId,
                signature: this.builder.maxLength(this.tv.base64, 128),
                timestamp: this.tv.timestamp,
                nonce: this.tv.nonce,
                scope: this.builder.optional(this.tv.apiScope),
                data: this.builder.optional(this.builder.maxLength(this.builder.string, 1024)),
            }),
        ], "type"));
        
        this.registerMethod("createFirstApiKey", this.builder.createObject({
            initializationToken: this.builder.rangeLength(this.builder.string, 1, 1024),
            name: this.tv.apiKeyName,
            publicKey: this.builder.optional(this.tv.ed25519PemPublicKey),
        }));
        
        this.registerMethod("createApiKey", this.builder.createObject({
            name: this.tv.apiKeyName,
            scope: this.tv.apiScope,
            publicKey: this.builder.optional(this.tv.ed25519PemPublicKey),
        }));
        
        this.registerMethod("getApiKey", this.builder.createObject({
            id: this.tv.apiKeyId,
        }));
        
        this.registerMethod("listApiKeys", this.builder.empty);
        
        this.registerMethod("updateApiKey", this.builder.createObject({
            id: this.tv.apiKeyId,
            name: this.builder.optional(this.tv.apiKeyName),
            scope: this.builder.optional(this.tv.apiScope),
            enabled: this.builder.optional(this.builder.bool),
        }));
        
        this.registerMethod("deleteApiKey", this.builder.createObject({
            id: this.tv.apiKeyId,
        }));
        
        this.registerMethod("bindAccessToken", this.builder.createObject({
            accessToken: this.tv.apiAccessToken,
        }));
        
        this.registerMethod("subscribeToChannel", this.builder.createObject({
            channels: this.builder.createListWithMaxLength(this.tv.plainApiWsChannelName, 16),
        }));
        
        this.registerMethod("unsubscribeFromChannel", this.builder.createObject({
            channels: this.builder.createListWithMaxLength(this.tv.plainApiWsChannelName, 16),
        }));
    }
}
