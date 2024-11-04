/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../BaseValidator";
import { TypesValidator } from "../TypesValidator";

export class PacketValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getKey", this.builder.empty);
        
        this.registerMethod("session", this.builder.createObject({
            sessionId: this.tv.sessionId,
            data: this.tv.base64
        }));
        
        this.registerMethod("key", this.builder.createObject({
            key: this.tv.eccPub,
            data: this.tv.base64
        }));
        
        this.registerMethod("handshake_ecdhe", this.builder.createObject({
            type: this.builder.createConst("ecdhe"),
            key: this.builder.maxLength(this.tv.byteBuffer, 100),
            agent: this.tv.userAgentOpt,
            solution: this.builder.optional(this.tv.cloudSolutionId),
        }));
        
        this.registerMethod("handshake_ecdhex", this.builder.createObject({
            type: this.builder.createConst("ecdhex"),
            key: this.builder.maxLength(this.tv.byteBuffer, 100),
            nonce: this.tv.nonce,
            timestamp: this.tv.timestampStr,
            signature: this.tv.eccSignature,
            agent: this.tv.userAgentOpt,
            solution: this.builder.optional(this.tv.cloudSolutionId),
            plain: this.builder.optional(this.builder.bool),
        }));
        
        this.registerMethod("handshake_frame_session", this.builder.createObject({
            type: this.builder.createConst("session"),
            sessionId: this.tv.sessionId,
            sessionKey: this.tv.eccPub,
            nonce: this.tv.nonce,
            timestamp: this.tv.timestampStr,
            signature: this.tv.eccSignature
        }));
        
        this.registerMethod("handshake_ticket_request", this.builder.createObject({
            type: this.builder.createConst("ticket_request"),
            count: this.builder.range(this.builder.int, 0, 1024)
        }));
        
        this.registerMethod("handshake_ticket", this.builder.createObject({
            type: this.builder.createConst("ticket"),
            id: this.builder.nullableOptional(this.builder.maxLength(this.builder.string, 100)),
            ticket_id: this.builder.maxLength(this.tv.byteBuffer, 100),
            client_random: this.builder.maxLength(this.tv.byteBuffer, 1024),
            plain: this.builder.optional(this.builder.bool),
        }));
        
        this.registerMethod("handshake_srp_init", this.builder.createObject({
            type: this.builder.createConst("srp_init"),
            I: this.builder.string,
            host: this.builder.string,
            agent: this.tv.userAgentOpt,
            properties: this.builder.nullableOptional(this.tv.loginProperties)
        }));
        
        this.registerMethod("handshake_srp_exchange", this.builder.createObject({
            type: this.builder.createConst("srp_exchange"),
            sessionId: this.tv.sessionId,
            A: this.tv.bi16,
            M1: this.tv.bi16,
            tickets: this.builder.range(this.builder.int, 0, 1024),
            sessionKey: this.builder.nullableOptional(this.tv.eccPub)
        }));
        
        this.registerMethod("handshake_ecdhef", this.builder.createObject({
            type: this.builder.createConst("ecdhef"),
            key_id: this.builder.maxLength(this.tv.byteBuffer, 256),
            key: this.builder.maxLength(this.tv.byteBuffer, 1024),
            agent: this.tv.userAgentOpt
        }));
        
        this.registerMethod("handshake_key_init", this.builder.createObject({
            type: this.builder.createConst("key_init"),
            agent: this.tv.userAgentOpt,
            pub: this.tv.eccPub,
            properties: this.builder.nullableOptional(this.tv.loginProperties)
        }));
        
        this.registerMethod("handshake_key_exchange", this.builder.createObject({
            type: this.builder.createConst("key_exchange"),
            sessionId: this.tv.sessionId,
            nonce: this.tv.nonce,
            timestamp: this.tv.timestampStr,
            signature: this.tv.eccSignature,
            K: this.tv.base64,
            tickets: this.builder.range(this.builder.int, 0, 1024),
            sessionKey: this.builder.nullableOptional(this.tv.eccPub)
        }));
    }
}
