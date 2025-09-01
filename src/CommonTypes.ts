/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as WebSocket from "ws";
import * as types from "./types";
import { Subidentity } from "./service/login/UserLoginService";
import * as mongodb from "mongodb";
import * as db from "./db/Model";
import { WsChannelName } from "./types/core";
import type { IOC } from "./service/ioc/IOC";

export { mongodb };
export type Whenable<T> = T|Promise<T>;
export type WithLockedSession = <T>(locks: string|string[], func: (session: mongodb.ClientSession) => Promise<T>) => Promise<T>;

export interface Requester {
    request<T>(method: string, params: unknown): Promise<T>;
}

export interface ParsedHashmail {
    hashmail: types.core.Hashmail;
    user: types.core.Username;
    domain: types.core.Host;
}

export interface Deferred<T> {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (e: any) => void;
    promise: Promise<T>;
}

export interface SettleResult<T> {
    status: "rejected"|"fulfilled";
    value?: T;
    reason?: any;
}

export interface StreamInterface {
    write(buffer: Buffer): void;
    read(count: number): Buffer;
    getBuffer(): Buffer;
    getContentsAndClear(): Buffer;
    eof(): boolean;
}

export interface WebSocketSession {
    id: types.core.SessionId;
    host: types.core.Host;
    wsId: types.core.WsId;
    wsChannelId: types.core.WsChannelId;
    addWsChannelId: boolean;
    username: types.core.Username;
    subidentity: Subidentity;
    solution: types.cloud.SolutionId;
    type: types.user.SessionUserType;
    rights: types.user.UserRightsMap;
    proxy: types.core.Host;
    encryptionKey: Buffer;
    deviceId: types.core.DeviceId|null;
    channels: types.cloud.ChannelScheme[];
    instanceHost: types.core.Host;
}

export type SubscribedChannels = Map<WsChannelName, Set<types.cloud.SolutionId>>;

export interface WebSocketInfo {
    connectionId?: string;
    isAlive: boolean;
    sessions: WebSocketSession[];
    plainUserInfo?: {
        connectionId: types.core.WsConnectionId;
        plainApiChannels: SubscribedChannels;
        token?: types.auth.ApiAccessToken;
        session?: db.auth.TokenSession;
    };
    contextFactory: (host: types.core.Host) => Promise<IOC>;
};

export interface WebSocketEx extends WebSocket {
    ex: WebSocketInfo;
}

export type RawMongoX<T, X extends keyof T> = Omit<T, X>&{_id: T[X]};
export type RawMongo<T extends {id: T[X]}, X extends keyof T = "id"> = RawMongoX<T, X>;

export type Immutable<T> = {
    readonly [K in keyof T]: T[K];
};

export type DeepPartial<T> = {
    [K in keyof T]?: DeepPartial<T[K]>;
};

export type Result<T> = {success: true; result: T}|{success: false; error: any};

export class CloudUser {
    
    type = "cloud" as const;
    userMap = new Map<types.context.ContextId, types.cloud.UserId>();
    
    constructor(
        public readonly pub: types.core.EccPubKey,
        public readonly solutionId?: types.cloud.SolutionId,
    ) {
    }
    
    getUser(contextId: types.context.ContextId) {
        const userId = this.userMap.get(contextId);
        if (!userId) {
            throw new Error(`No user for given context=${contextId}`);
        }
        return userId;
    }
    
    setUser(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        this.userMap.set(contextId, userId);
    }
}

export interface PlainUser {
    type: "plain";
    solutions: types.cloud.SolutionId[];
}

export interface ContextExecutor {
    type: "context";
    contextId: types.context.ContextId;
}

export type Executor = CloudUser|PlainUser|ContextExecutor;

export interface ListWithCount<T> {
    list: T[];
    count: number;
}
