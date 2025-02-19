/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-namespace */

import * as types from "../types";
import { EcdheDataInSession, KeyDataInSession, SessionState, SrpDataInSession } from "../api/session/Session";
import { Subidentity } from "../service/login/UserLoginService";

export namespace request {
    
    export interface Request {
        id: types.request.RequestId;
        created: types.core.Timestamp;
        modified: types.core.Timestamp;
        processing: boolean;
        author: types.core.Username;
        files: FileDefinition[];
    }
    
    export interface FileDefinition {
        id: types.request.FileId;
        seq: number;
        sent: number;
        size: number;
        checksumSize: number;
        checksumSent: number;
        closed: boolean;
    }
}

export namespace session {
    
    export type TicketDataId = types.core.Hex&{__ticketDataId: never;};
    
    export interface Session {
        id: types.core.SessionId;
        data: SessionData;
    }
    
    export interface SessionData {
        state?: SessionState;
        properties?: types.user.LoginProperties;
        srp?: SrpDataInSession;
        username?: types.core.Username;
        type?: types.user.SessionUserType;
        rights?: types.user.UserRightsMap;
        proxy?: types.core.Host;
        keyLogin?: KeyDataInSession;
        subidentity?: Subidentity;
        registered?: boolean;
        primaryKey?: types.core.EccPubKey;
        createdDate?: types.core.Timestamp;
        ecdhe?: EcdheDataInSession;
        restoreKey?: types.core.EccPubKey;
        lastUsage?: types.core.Timestamp;
    }
    
    export interface TicketData {
        id: TicketDataId;
        createDate: types.core.Timestamp;
        sessionId: types.core.SessionId|undefined;
        agent: types.core.UserAgent|undefined;
        masterSecret: types.core.Base64;
    }
}

export namespace nonce {
    
    export interface NonceEntry {
        id: types.core.Nonce;
        timestamp: types.core.Timestamp;
    }
}

export namespace setting {
    
    export type SettingId = string;
    
    export interface SettingsEntry {
        id: SettingId;
        value: string;
    }
}

export namespace system {
    
    export type ServerStatsId = number&{__serverStatsId: never};
    
    export interface ServerStats {
        id: ServerStatsId;
        requests: number;
        errors: number;
        executionTime: number;
        maxTime: number;
        minTime: number;
    }
}

export namespace context {
    
    export type ContextUserId = string&{__contextUserId: never};
    
    export interface Context {
        id: types.context.ContextId;
        created: types.core.Timestamp;
        modified: types.core.Timestamp;
        solution: types.cloud.SolutionId;
        shares: types.cloud.SolutionId[];
        name: types.context.ContextName;
        description: types.context.ContextDescription;
        scope: types.context.ContextScope;
        policy?: types.context.ContextPolicy;
    }
    
    export interface ContextUser {
        id: ContextUserId;
        created: types.core.Timestamp;
        contextId: types.context.ContextId;
        userId: types.cloud.UserId;
        userPubKey: types.cloud.UserPubKey;
        acl: types.cloud.ContextAcl;
    }
    
    export type ContextUserWithStatus = ContextUser&{status: "active"|"inactive"};
}

export namespace solution {
    export interface Solution {
        id: types.cloud.SolutionId;
        created: types.core.Timestamp;
        name: types.cloud.SolutionName;
    }
}

export namespace thread {
    
    export interface Thread {
        id: types.thread.ThreadId;
        contextId: types.context.ContextId;
        type?: types.thread.ThreadType;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        keyId: types.core.KeyId;
        data: types.thread.ThreadData;
        allTimeUsers: types.cloud.UserId[];
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        keys: types.cloud.UserKeysEntry[];
        history: ThreadHistoryEntry[];
        policy?: types.cloud.ContainerPolicy;
        // state
        lastMsgDate: types.core.Timestamp;
        messages: number;
    }
    
    export interface ThreadHistoryEntry {
        keyId: types.core.KeyId;
        data: types.thread.ThreadData;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
    
    export interface ThreadMessage {
        id: types.thread.ThreadMessageId;
        threadId: types.thread.ThreadId;
        createDate: types.core.Timestamp;
        author: types.cloud.UserId;
        data: types.thread.ThreadMessageData;
        keyId: types.core.KeyId;
        updates?: types.thread.ThreadMessageUpdate[];
    }
}

export namespace store {
    
    export interface Store {
        id: types.store.StoreId;
        contextId: types.context.ContextId;
        type?: types.store.StoreType;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        keyId: types.core.KeyId;
        data: types.store.StoreData;
        allTimeUsers: types.cloud.UserId[];
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        keys: types.cloud.UserKeysEntry[];
        history: StoreHistoryEntry[];
        policy?: types.cloud.ContainerPolicy;
        // state
        lastFileDate: types.core.Timestamp;
        files: number;
    }
    
    export interface StoreHistoryEntry {
        keyId: types.core.KeyId;
        data: types.store.StoreData;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
    
    export interface StoreFile {
        id: types.store.StoreFileId;
        fileId: types.request.FileId;
        storeId: types.store.StoreId;
        createDate: types.core.Timestamp;
        author: types.cloud.UserId;
        meta: types.store.StoreFileMeta;
        size: types.core.SizeInBytes;
        checksumSize: types.core.SizeInBytes;
        keyId: types.core.KeyId;
        thumb?: {
            fileId: types.request.FileId;
            size: types.core.SizeInBytes;
            checksumSize: types.core.SizeInBytes;
        };
        updates?: types.store.StoreFileUpdate[];
    }
}

export namespace resource {
    
    export interface Resource {
        id: types.resource.ResourceId;
        type: types.resource.ResourceType;
        contextId: types.context.ContextId;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        acl: types.resource.ResourceAcl;
        last: types.resource.ResourceHistoryEntry;
        history: types.resource.ResourceHistoryEntry[];
        stats: types.resource.ResourceStats;
    }
}

export namespace inbox {
    
    export interface Inbox {
        id: types.inbox.InboxId;
        contextId: types.context.ContextId;
        type?: types.inbox.InboxType;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        keyId: types.core.KeyId;
        data: types.inbox.InboxMeta;
        allTimeUsers: types.cloud.UserId[];
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        keys: types.cloud.UserKeysEntry[];
        history: InboxHistoryEntry[];
        policy?: types.cloud.ContainerWithoutItemPolicy;
    }
    
    export interface InboxHistoryEntry {
        keyId: types.core.KeyId;
        data: types.inbox.InboxData;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
}

export namespace stream {
    
    export interface StreamRoom {
        id: types.stream.StreamRoomId;
        contextId: types.context.ContextId;
        type?: types.stream.StreamRoomType;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        keyId: types.core.KeyId;
        data: types.stream.StreamRoomData;
        allTimeUsers: types.cloud.UserId[];
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        keys: types.cloud.UserKeysEntry[];
        history: StreamRoomHistoryEntry[];
        policy?: types.cloud.ContainerWithoutItemPolicy;
    }
    
    export interface StreamRoomHistoryEntry {
        keyId: types.core.KeyId;
        data: types.stream.StreamRoomData;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
}

export namespace auth {
    
    export type TokenSessionId = string&{__tokenSessionId: never};
    export type TokenSessionName = string&{__tokenSessionName: never};
    
    export interface ApiUser {
        id: types.auth.ApiUserId;
        created: types.core.Timestamp;
        enabled: boolean;
    }
    
    export interface ApiKey {
        id: types.auth.ApiKeyId;
        created: types.core.Timestamp;
        user: types.auth.ApiUserId;
        enabled: boolean;
        name: types.auth.ApiKeyName;
        secret: types.auth.ApiKeySecret;
        scopes: types.auth.Scope[];
        masterKey: boolean;
        publicKey?: types.core.EccPubKeyPEM;
    }
    
    export interface TokenSession {
        id: TokenSessionId;
        created: types.core.Timestamp;
        expiry: types.core.Timestamp;
        name?: TokenSessionName;
        user: types.auth.ApiUserId;
        seq: number;
        scopes: types.auth.Scope[];
        apiKey: types.auth.ApiKeyId;
        ipAddress?: types.core.IPAddress;
        solutions: types.cloud.SolutionId[];
    }
    
    export type ApiTokenData = AccessTokenData|RefreshTokenData;
    
    export interface AccessTokenData {
        type: "accessToken";
        created: types.core.Timestamp;
        expires: types.core.Timestamp;
        sessionId: TokenSessionId;
        seq: number;
        connectionId?: types.core.WsConnectionId;
    }
    
    export interface RefreshTokenData {
        type: "refreshToken";
        created: types.core.Timestamp;
        expires: types.core.Timestamp;
        sessionId: TokenSessionId;
        seq: number;
        connectionId?: types.core.WsConnectionId;
        accessTokenTTL?: types.core.Timespan;
    }
    
    export type TokenEncryptionKeyId = types.core.Hex&{__tokenEncryptionKeyId: never};
    
    export interface TokenEncryptionKey {
        id: TokenEncryptionKeyId;
        key: types.core.EncryptionKey;
        created: types.core.Timestamp;
        usageExpiryDate: types.core.Timestamp;
        expiryDate: types.core.Timestamp;
        refreshTokenTTL: types.core.Timespan;
    }
}
