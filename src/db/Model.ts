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
import type * as mongo from "mongodb";
import { TargetChannel } from "../service/ws/WebSocketConnectionManager";
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
        supportsRandomWrite?: boolean;
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
    
    export type ContextUserWithStatus = ContextUser&{status: "active"|"inactive", lastStatusChange: types.cloud.KnownKeyStatusChange};
}

export namespace solution {
    export interface Solution {
        id: types.cloud.SolutionId;
        created: types.core.Timestamp;
        name: types.cloud.SolutionName;
    }
    
    export interface KnownPublicKey {
        id: types.cloud.KnownKeyId;
        publicKey: types.cloud.UserPubKey;
        solutionId: types.cloud.SolutionId;
        lastStatusChange: types.cloud.KnownKeyStatusChange
    }
}

export namespace thread {
    
    export interface Thread {
        id: types.thread.ThreadId;
        clientResourceId?: types.core.ClientResourceId;
        contextId: types.context.ContextId;
        type?: types.thread.ThreadType;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        keyId: types.core.KeyId;
        keeper?: types.cloud.UserId;
        data: types.thread.ThreadData;
        allTimeUsers: types.cloud.UserId[];
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        keys: types.cloud.UserKeysEntry[];
        groups?: types.cloud.GroupGrant[];
        groupKeys?: types.cloud.GroupKeysEntry[];
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
        groups?: types.cloud.GroupGrant[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
    
    export interface ThreadMessage {
        id: types.thread.ThreadMessageId;
        clientResourceId?: types.core.ClientResourceId;
        threadId: types.thread.ThreadId;
        createDate: types.core.Timestamp;
        author: types.cloud.UserId;
        data: types.thread.ThreadMessageData;
        keyId: types.core.KeyId;
        updates?: types.thread.ThreadMessageUpdate[];
    }
}

export namespace group {
    
    /**
     * The group document. Everything that grows with the group's lifetime lives in its own collection instead —
     * see `GroupTreeNode`, `GroupTreeEdge`, `GroupHistoryEntry`, `GroupArchiveRung` below.
     */
    export interface Group {
        id: types.group.GroupId;
        clientResourceId?: types.core.ClientResourceId;
        contextId: types.context.ContextId;
        type?: types.group.GroupType;
        groupPubKey: types.cloud.GroupPubKey;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        keyId: types.core.KeyId;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        policy?: types.cloud.ContainerPolicy;
        /** Public metadata plane counter. Moves only on `groupUpdatePublicMeta`, which is CAS-guarded on it —
         *  which is exactly why that plane's entry may commit the version it lands at. Entries live in
         *  `groupPublicMetaEntry`. */
        publicMetaVersion: types.group.GroupVersion;
        /** Private metadata plane counter. Moves only on `groupUpdatePrivateMeta`, CAS-guarded on it, and by
         *  nothing else — a public-plane write leaves it alone, which is what lets the two race and both win. */
        privateMetaVersion: types.group.GroupVersion;
        /** Roster plane counter. Moves only on a membership change or a rotation. A metadata update leaves it
         *  alone, so a concurrent metadata write can no longer strand a tree write at a version it never took. */
        rosterVersion: number;
        /** Current epoch. Every group starts at 1 and only a rotation advances it. */
        keyVersion: number;
        keyHistory?: types.cloud.GroupPubKeyAtEpoch[];
        /** Size of the hidden key tree. Every group is tree-backed, so this is always present. */
        numLeaves: number;
        /**
         * Seat → member, `""` for a blank left by a removal. Stays on the document although it is `O(members)`:
         * ~20 B each and every tree operation reads it, so moving it out costs a query and saves ~2%.
         */
        leafAssignment: types.cloud.UserId[];
        /**
         * The group's own metadata key, wrapped **once** to the group's grant public key per epoch: the group is
         * a grantee of itself, and members open it by climbing.
         *
         * One entry per epoch that rotated the key, so it grows with rotations, never with members. `cutEra`
         * drops the entries below its floor.
         */
        groupKeys?: types.cloud.GroupKeysEntry[];
        /** Oldest epoch reachable by descending: a cut era makes everything below it unreachable by design. */
        eraFloor: number;
        /** Rungs below this epoch were deleted, so the archive stops here even inside the current era. */
        archivePrunedBelow?: number;
    }
    
    /**
     * The fields a listing needs. Named so the projection in `GroupRepository.getPage` and what
     * `convertGroupSummary` serves cannot drift apart: widening one without the other stops compiling.
     */
    export type GroupSummaryFields = Pick<Group,
        "id"|"clientResourceId"|"contextId"|"type"|"groupPubKey"|"createDate"|"creator"
        |"lastModificationDate"|"lastModifier"|"users"|"managers"|"publicMetaVersion"|"privateMetaVersion"
        |"rosterVersion"|"keyVersion"|"policy">;
    
    /**
     * All `GroupRepository.getKeyVersions` reads. Deliberately the three smallest fields on the document: it is
     * asked on every container read and on every item write, and everything it leaves out (`keys`, `groupKeys`,
     * `leafAssignment`) is what grows with the group's membership and history.
     */
    export type GroupEpochFields = Pick<Group, "id"|"contextId"|"keyVersion">;
    
    /**
     * All `GroupRepository.getGranteeView` reads. The rosters it does need, and nothing else: it runs on every
     * item write into a group-granted container, and `leafAssignment` alone is another entry per seat on top of
     * the rosters it would be read beside.
     */
    export type GroupGranteeFields = Pick<Group, "id"|"users"|"managers"|"keyVersion">;
    
    export type GroupTreeNodeId = string&{__groupTreeNodeId: never};
    export type GroupTreeEdgeId = string&{__groupTreeEdgeId: never};
    export type GroupHistoryEntryId = string&{__groupHistoryEntryId: never};
    // Two brands, not one: entry ids are derived from `(groupId, version)` and both planes start at 1, so a
    // head read that forgot which plane it was after would silently return the other's entry. Branding makes
    // that a compile error instead.
    export type GroupPublicMetaEntryId = string&{__groupPublicMetaEntryId: never};
    export type GroupPrivateMetaEntryId = string&{__groupPrivateMetaEntryId: never};
    export type GroupArchiveRungId = string&{__groupArchiveRungId: never};
    
    /** Public half of one tree node. `id` is derived from `(groupId, nodeIndex)`: a refresh updates it in place. */
    export interface GroupTreeNode {
        id: GroupTreeNodeId;
        groupId: types.group.GroupId;
        nodeIndex: number;
        generation: number;
        publicKey: types.core.EccPubKey;
    }
    
    /**
     * One edge of the hidden key tree. `id` is derived from `(groupId, parent, child)`; generations are not part
     * of it, because a refresh replaces the wrap on the same edge rather than making a new one.
     */
    export interface GroupTreeEdge {
        id: GroupTreeEdgeId;
        groupId: types.group.GroupId;
        isGrantEdge?: boolean;
        parentIndex?: number;
        parentGeneration: number;
        childKind: types.cloud.GroupTreeChildKind;
        childIndex?: number;
        childGeneration?: number;
        childUserId?: types.cloud.UserId;
        data: types.core.UserKeyData;
    }
    
    /** One roster-plane entry, `id` derived from `(groupId, rosterVersion)` so appending is an insert. Carries
     *  no metadata: a membership change does not rewrite what it did not change. */
    export interface GroupHistoryEntry {
        id: GroupHistoryEntryId;
        groupId: types.group.GroupId;
        version: types.group.GroupVersion;   // the roster version this entry landed at
        keyId: types.core.KeyId;
        keyVersion: number;                  // epoch the tag is keyed at
        data: types.group.GroupData;         // opaque; carries the endpoint's DIO and the roster tag
        groupPubKey: types.cloud.GroupPubKey;
        created: types.core.Timestamp;
        author: types.cloud.UserId;
        confirmationTag?: types.core.Base64;
    }
    
    /**
     * The body both metadata-plane entries share.
     *
     * `keyVersion` is the epoch its key belongs to and may legitimately lag the group's current epoch — the
     * entry stays where it was written and a later reader descends the Epoch Ladder to open it. That is why
     * `cutEra`/`pruneArchive` have to check it before dropping rungs, or the metadata becomes unreadable. The
     * two planes move independently, so they may sit at different epochs and only one may be stranded.
     *
     * One row per group per plane: `id` is derived from `groupId` and the plane alone, and a write replaces it.
     * Neither plane serves an audit trail, so a version-derived id would only leave rows no reader can reach.
     * `version` is still carried on the row — it is the plane's current counter, just not part of its identity.
     */
    interface GroupMetaEntryFields {
        groupId: types.group.GroupId;
        version: types.group.GroupVersion;
        keyId: types.core.KeyId;
        keyVersion: number;
        data: types.group.GroupData;
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
    
    /** One public-metadata entry, written only by `groupUpdatePublicMeta`. Lives in `groupPublicMetaEntry`. */
    export interface GroupPublicMetaEntry extends GroupMetaEntryFields {
        id: GroupPublicMetaEntryId;
    }
    
    /** One private-metadata entry, written only by `groupUpdatePrivateMeta`. Lives in `groupPrivateMetaEntry`. */
    export interface GroupPrivateMetaEntry extends GroupMetaEntryFields {
        id: GroupPrivateMetaEntryId;
    }
    
    /** One Epoch Ladder rung. Append-only apart from pruning, a range delete over `targetKeyVersion`. */
    export interface GroupArchiveRung {
        id: GroupArchiveRungId;
        groupId: types.group.GroupId;
        atKeyVersion: number;
        targetKeyVersion: number;
        recipientKind?: "epoch"|"user"|"group";
        recipient?: string;
        data: types.core.UserKeyData;
        author?: types.cloud.UserId;
    }
    
    /** A group's out-of-document state, assembled for the read path. */
    export interface GroupState {
        tree: types.cloud.GroupTreeState;
        history: GroupHistoryEntry[];
        /** The current entry of each metadata plane. A read needs both alongside the roster head — three
         *  entries, never O(versions). */
        publicMeta: GroupPublicMetaEntry;
        privateMeta: GroupPrivateMetaEntry;
    }
}

export namespace store {
    
    export interface Store {
        id: types.store.StoreId;
        clientResourceId?: types.core.ClientResourceId;
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
        groups?: types.cloud.GroupGrant[];
        groupKeys?: types.cloud.GroupKeysEntry[];
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
        groups?: types.cloud.GroupGrant[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
    
    export interface StoreFile {
        id: types.store.StoreFileId;
        clientResourceId?: types.core.ClientResourceId;
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
            supportsRandomWrite?: boolean;
        };
        updates?: types.store.StoreFileUpdate[];
        supportsRandomWrite?: boolean;
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
        clientResourceId?: types.core.ClientResourceId,
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
        groups?: types.cloud.GroupGrant[];
        groupKeys?: types.cloud.GroupKeysEntry[];
        history: InboxHistoryEntry[];
        policy?: types.cloud.ContainerWithoutItemPolicy;
    }
    
    export interface InboxHistoryEntry {
        keyId: types.core.KeyId;
        data: types.inbox.InboxData;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        groups?: types.cloud.GroupGrant[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
}

export namespace stream {
    
    export interface StreamRoom {
        id: types.stream.StreamRoomId;
        clientResourceId?: types.core.ClientResourceId;
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
        groups?: types.cloud.GroupGrant[];
        groupKeys?: types.cloud.GroupKeysEntry[];
        history: StreamRoomHistoryEntry[];
        policy?: types.cloud.ContainerWithoutItemPolicy;
        janusRoomId: number;
        state: types.stream.StreamRoomState;
        emptyRoomTtl?: types.core.Timespan;
    }
    
    export interface StreamRoomHistoryEntry {
        keyId: types.core.KeyId;
        data: types.stream.StreamRoomData;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        groups?: types.cloud.GroupGrant[];
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

export namespace MongoFileStorage {
    export type ChunkId = string&{__chunkId: never};
    
    export interface Chunk {
        _id: ChunkId;
        fileMetaData: types.request.FileId;
        index: number;
        binary: mongo.Binary;
    }
    
    export interface FileMetaData {
        _id: types.request.FileId;
        chunks: number;
        lastChunkSize: number;
        seq: number;
        isTemporary: boolean;
        checksumSize: number;
        checksumChunks: number;
    }
}

export namespace kvdb {
    
    export interface Kvdb {
        id: types.kvdb.KvdbId;
        clientResourceId: types.core.ClientResourceId;
        contextId: types.context.ContextId;
        type?: types.kvdb.KvdbType;
        createDate: types.core.Timestamp;
        creator: types.cloud.UserId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        keyId: types.core.KeyId;
        data: types.kvdb.KvdbData;
        allTimeUsers: types.cloud.UserId[];
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        keys: types.cloud.UserKeysEntry[];
        groups?: types.cloud.GroupGrant[];
        groupKeys?: types.cloud.GroupKeysEntry[];
        history: KvdbHistoryEntry[];
        entries: number;
        lastEntryDate: types.core.Timestamp;
        policy?: types.cloud.ContainerPolicy;
    }
    
    export interface KvdbHistoryEntry {
        keyId: types.core.KeyId;
        data: types.kvdb.KvdbData;
        users: types.cloud.UserId[];
        managers: types.cloud.UserId[];
        groups?: types.cloud.GroupGrant[];
        created: types.core.Timestamp;
        author: types.cloud.UserId;
    }
    
    export interface KvdbEntry {
        id: types.kvdb.KvdbEntryId;
        kvdbId: types.kvdb.KvdbId;
        createDate: types.core.Timestamp;
        author: types.cloud.UserId;
        entryKey: types.kvdb.KvdbEntryKey
        entryValue: types.kvdb.KvdbEntryValue;
        keyId: types.core.KeyId;
        lastModificationDate: types.core.Timestamp;
        lastModifier: types.cloud.UserId;
        version: types.kvdb.KvdbEntryVersion;
    }
}

export namespace notification {
    export type NotificationId = string&{__notificationId: never};
    
    export interface Notification {
        id: NotificationId;
        channel: TargetChannel;
        userPubKey: types.cloud.UserPubKey;
        event: types.cloud.Event<string, string, unknown>;
    }
}
