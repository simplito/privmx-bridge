/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export interface ServerConfig {
    serverVersion: types.core.Version;
    requestChunkSize: number;
}

export interface BasePacket {
    type: string;
}

export interface EcdheRequestPacket extends BasePacket {
    type: "ecdhe";
    key: ByteBuffer;
    agent: types.core.UserAgent;
    solution?: types.cloud.SolutionId;
    challenge?: types.core.Nonce;
}

export interface EcdheResponsePacket extends BasePacket {
    type: "ecdhe";
    agent: types.core.UserAgent;
    config: ServerConfig;
    key: ByteBuffer;
    signature?: {
        challenge: string;
        timestamp: types.core.Timestamp;
    }
}

export interface EcdhexRequestPacket extends BasePacket {
    type: "ecdhex";
    key: ByteBuffer;
    nonce: types.core.Nonce;
    timestamp: types.core.TimestampStr;
    signature: types.core.EccSignature;
    agent: types.core.UserAgent;
    solution?: types.cloud.SolutionId;
    plain?: boolean;
    challenge?: types.core.Nonce;
}

export interface EcdhexResponsePacket extends BasePacket {
    type: "ecdhex";
    agent: types.core.UserAgent;
    config: ServerConfig;
    key: ByteBuffer;
    host: types.core.Host;
    signature?: {
        challenge: string;
        timestamp: types.core.Timestamp;
    }
}

export interface SessionRequestPacket extends BasePacket {
    type: "session";
    sessionId: types.core.SessionId;
    sessionKey: types.core.EccPubKey;
    nonce: types.core.Nonce;
    timestamp: types.core.TimestampStr;
    signature: types.core.EccSignature;
}

export interface SessionResponsePacket extends BasePacket {
    type: "session";
    agent: types.core.UserAgent;
    config: ServerConfig;
    key: ByteBuffer;
}

export interface EcdhefRequestPacket extends BasePacket {
    type: "ecdhef";
    key_id: ByteBuffer;
    key: ByteBuffer;
    agent: types.core.UserAgent;
}

export interface TicketPacket extends BasePacket {
    type: "ticket";
    ticket_id: ByteBuffer;
    client_random: ByteBuffer;
    plain?: boolean;
}

export interface TicketsRequestPacket extends BasePacket {
    type: "ticket_request";
    count: number;
}

export interface TicketsResponsePacket extends BasePacket {
    type: "ticket_response";
    tickets: ByteBuffer[];
    ttl: number;
}

export interface SrpInitRequestPacket extends BasePacket {
    type: "srp_init";
    I: types.core.Username;
    host: types.core.Host;
    agent: types.core.UserAgent;
    properties?: types.user.LoginProperties;
}

export interface SrpInitResponsePacket extends BasePacket {
    type: "srp_init";
    agent: types.core.UserAgent;
    config: ServerConfig;
    s: types.core.Hex;
    B: types.core.Hex;
    N: types.core.Hex;
    g: types.core.Hex;
    k: types.core.Hex;
    loginData: types.user.SrpParams;
    sessionId: types.core.SessionId;
}

export interface SrpExchangeRequestPacket extends BasePacket {
    type: "srp_exchange";
    A: types.core.Hex;
    M1: types.core.Hex;
    sessionId: types.core.SessionId;
    tickets: number;
    sessionKey?: types.core.EccPubKey;
}

export interface SrpExchangeResponsePacket extends BasePacket {
    type: "srp_exchange";
    agent?: types.core.UserAgent;
    tickets: ByteBuffer[];
    ttl: number;
    M2: types.core.Hex;
    additionalLoginStep?: any;
}

export interface KeyInitRequestPacket extends BasePacket {
    type: "key_init";
    agent?: types.core.UserAgent;
    pub: types.core.EccPubKey;
    properties: types.user.LoginProperties;
}

export interface KeyInitResponsePacket extends BasePacket {
    type: "key_init";
    sessionId: types.core.SessionId;
    I: types.core.Username;
    pub: types.core.EccPubKey;
    agent: types.core.UserAgent;
    config: ServerConfig;
}

export interface KeyExchangeRequestPacket extends BasePacket {
    type: "key_exchange";
    sessionId: types.core.SessionId;
    nonce: types.core.Nonce;
    timestamp: types.core.TimestampStr;
    signature: types.core.EccSignature;
    K: types.core.Base64;
    tickets: number;
    sessionKey?: types.core.EccPubKey;
}

export interface KeyExchangeResponsePacket extends BasePacket {
    type: "key_exchange";
    tickets: ByteBuffer[];
    ttl: number;
    additionalLoginStep?: any;
}
