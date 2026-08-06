/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface ContextGetModel {
    id: types.context.ContextId;
}

export interface ContextGetResult {
    context: ContextInfo;
}

export interface ContextInfo {
    userId: types.cloud.UserId;
    contextId: types.context.ContextId;
    acl: types.cloud.ContextAcl;
    policy: types.context.ContextPolicy;
    created: types.core.Timestamp;
    modified: types.core.Timestamp;
    name: types.context.ContextName;
    description: types.context.ContextDescription;
    scope: types.context.ContextScope;
}

export type ContextListModel = types.core.ListModel;

export interface ContextListResult {
    contexts: ContextInfo[];
    count: number;
}

export interface ContextGetUsersModel{
    contextId: types.context.ContextId;
}

export interface ContextGetUserResult {
    users: types.cloud.UserIdentityWithStatus[];
}

export interface ContextListUsersModel extends types.core.ListModel{
    contextId: types.context.ContextId;
}

export interface ContextListUsersResult {
    users: types.cloud.UserIdentityWithStatusAndAction[];
    count: number;
}

export interface ContextSendCustomEventModel {
    contextId: types.context.ContextId;
    channel: types.core.WsChannelName;
    data: unknown;
    users: {
        id: types.cloud.UserId;
        key: types.core.UserKeyData;
    }[];
}

export type ContextCustomEvent = types.cloud.Event<"custom", `context/${types.context.ContextId}/${types.core.WsChannelName}`, ContextCustomEventData>;

export interface ContextCustomEventData {
    id: types.context.ContextId;
    eventData: unknown;
    key: types.core.UserKeyData;
    author: types.cloud.UserIdentity;
};

export type ContextUserAddedEvent = types.cloud.Event<"contextUserAdded", "context", ContextUserAddedEventData>;

export interface ContextUserAddedEventData {
    contextId: types.context.ContextId;
    userId: types.cloud.UserId;
    pubKey: types.core.EccPubKey;
}

export type ContextUserRemovedEvent = types.cloud.Event<"contextUserRemoved", "context", ContextUserRemovedEventData>;

export interface ContextUserRemovedEventData {
    contextId: types.context.ContextId;
    userId: types.cloud.UserId;
    pubKey: types.core.EccPubKey;
}

export type ContextUsersStatusChange = types.cloud.Event<"contextUserStatusChanged", "context", ContextUsersStatusChangeData>;

export interface ContextUsersStatusChangeData {
    contextId: types.context.ContextId;
    users: {
        userId: types.cloud.UserId,
        pubKey: types.core.EccPubKey,
        action: "login"|"logout",
    }[],
}

// ===================
//        GROUP
// ===================

export interface GroupCreateModel {
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.group.GroupType;
    groupPubKey: types.cloud.GroupPubKey;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerPolicy;
    /**
     * Hidden key tree for the group. Passing it makes the group tree-backed: members reach the grant key by
     * climbing, so `keys` need not carry an entry per member. Omitting it creates a flat group, unchanged.
     */
    tree?: types.cloud.GroupTreeState;
}

/**
 * Adds one member to a tree-backed group. Deliberately *not* an update to `users`: the point of the tree is
 * that a member can be added without advancing the epoch, and that is only checkable against a named seat.
 */
export interface GroupAddMemberModel {
    id: types.group.GroupId;
    userId: types.cloud.UserId;
    role: types.cloud.ContainerRole;
    /** Leaf position the newcomer takes — a blank left by a removal, or the next free position. */
    position: number;
    keyId: types.core.KeyId;
    data: types.group.GroupData;
    tree: types.cloud.GroupTreeState;
    /**
     * Key entries for the newcomer at the group's current `keyId`.
     *
     * The tree distributes the *grant* key; the group's own metadata is encrypted under an ordinary container
     * key, and the newcomer needs one entry for it. That is a single wrap and no rotation, so it does not make
     * the addition expensive.
     */
    keys?: types.cloud.KeyEntrySet[];
    /** Guards against computing the tree against a state a concurrent removal has already replaced. */
    expectedKeyVersion: number;
}

/**
 * Removes one member from a tree-backed group, in a single operation that must do all of it at once: blank the
 * leaf, refresh the leaf's direct path, rotate the grant keypair (advancing the epoch), and supply the rungs
 * that keep the older epochs reachable from the new one.
 */
export interface GroupRemoveMemberModel {
    id: types.group.GroupId;
    userId: types.cloud.UserId;
    groupPubKey: types.cloud.GroupPubKey;
    keyId: types.core.KeyId;
    data: types.group.GroupData;
    tree: types.cloud.GroupTreeState;
    rungs: types.cloud.GroupArchiveRung[];
    /**
     * Fresh key entries for the remaining members at `keyId`.
     *
     * The tree takes care of the grant key, but the group's own metadata is encrypted under an ordinary
     * container key. A caller that wants the departing member locked out of *metadata* too must supply a new
     * `keyId` with entries for everyone who stays; omitting them leaves the metadata key as it was.
     */
    keys?: types.cloud.KeyEntrySet[];
    expectedKeyVersion: number;
    confirmationTag?: types.core.Base64;
}

/** Closes the current era: nothing below `newFloor` may be reached by descending the ladder again. */
export interface GroupCutEraModel {
    id: types.group.GroupId;
    newFloor: number;
    expectedKeyVersion: number;
}

/** Deletes rungs below `belowEpoch`, recording a watermark so clients can tell pruning from tampering. */
export interface GroupPruneArchiveModel {
    id: types.group.GroupId;
    belowEpoch: number;
    expectedKeyVersion: number;
}

/**
 * Fetches the Epoch Ladder. Kept out of `groupGet` because the archive grows with the group's whole history,
 * while a client needs it only when it is actually reaching for an older epoch.
 */
export interface GroupGetKeyArchiveModel {
    id: types.group.GroupId;
    /** Optional window; omitted bounds mean "everything reachable". */
    fromKeyVersion?: number;
    toKeyVersion?: number;
}

export interface GroupGetKeyArchiveResult {
    keyVersion: number;
    eraFloor: number;
    archivePrunedBelow?: number;
    keyHistory: types.cloud.GroupPubKeyAtEpoch[];
    rungs: types.cloud.GroupArchiveRung[];
}

export interface GroupCreateResult {
    groupId: types.group.GroupId;
}

export interface GroupUpdateModel {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    resourceId?: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.group.GroupVersion;
    force: boolean;
    policy?: types.cloud.ContainerPolicy;
}

export interface GroupGenerateNewKeyModel {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    expectedKeyVersion: number;
    confirmationTag?: types.core.Base64;
}

export interface RotatedAlreadyData {
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
    winnerKeyEntry: types.core.KeyEntry;
}

export interface GroupDeleteModel {
    groupId: types.group.GroupId;
}

export interface GroupGetModel {
    groupId: types.group.GroupId;
    type?: types.group.GroupType;
}

export interface GroupGetResult {
    group: GroupInfo;
}

export interface GroupListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface GroupListResult {
    groups: GroupInfo[];
    count: number;
}

export interface GroupDataEntry {
    keyId: types.core.KeyId;
    data: types.group.GroupData;
}

/** A group version record. The membership signature + chain link is committed inside the opaque `data`
 *  (endpoint DIO) and verified client-side; the bridge stores it but does not interpret it. */
export interface GroupHistoryEntryInfo {
    keyId: types.core.KeyId;
    groupPubKey: types.cloud.GroupPubKey;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    created: types.core.Timestamp;
    author: types.cloud.UserId;
    confirmationTag?: types.core.Base64;
}

export interface GroupInfo {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.group.GroupType;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: GroupDataEntry[];
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.group.GroupVersion;
    keyVersion: number;
    keyHistory: types.cloud.GroupPubKeyAtEpoch[];
    policy: types.cloud.ContainerPolicy;
    history: GroupHistoryEntryInfo[];
    // ── Tree state, present only on a tree-backed group. Flat groups serve none of it and behave as before. ──
    numLeaves?: number;
    leafAssignment?: types.cloud.UserId[];
    /**
     * The caller's own leaf. The bridge fills this in because it knows who is asking — the same reason it
     * already filters `keys` — which saves the client from having to know its own user id to find its seat.
     */
    ownLeafPosition?: number;
    treeNodes?: types.cloud.GroupTreeNode[];
    treeEdges?: types.cloud.GroupTreeEdge[];
    eraFloor?: number;
    archivePrunedBelow?: number;
}

export type GroupCreatedEvent = types.cloud.Event<"groupCreated", "context", GroupInfo>;
export type GroupUpdatedEvent = types.cloud.Event<"groupUpdated", "context", GroupInfo>;
export type GroupDeletedEvent = types.cloud.Event<"groupDeleted", "context", GroupDeletedEventData>;

export interface GroupDeletedEventData {
    groupId: types.group.GroupId;
    contextId: types.context.ContextId;
}

export interface IContextApi {
    contextGet(model: ContextGetModel): Promise<ContextGetResult>;
    contextList(model: ContextListModel): Promise<ContextListResult>;
    contextGetUsers(model: ContextGetUsersModel): Promise<ContextGetUserResult>;
    contextListUsers(model: ContextListUsersModel): Promise<ContextListUsersResult>
    contextSendCustomEvent(model: ContextSendCustomEventModel): Promise<types.core.OK>;
    groupCreate(model: GroupCreateModel): Promise<GroupCreateResult>;
    groupUpdate(model: GroupUpdateModel): Promise<types.core.OK>;
    groupGenerateNewKey(model: GroupGenerateNewKeyModel): Promise<types.core.OK>;
    groupDelete(model: GroupDeleteModel): Promise<types.core.OK>;
    groupGet(model: GroupGetModel): Promise<GroupGetResult>;
    groupList(model: GroupListModel): Promise<GroupListResult>;
    groupAddMember(model: GroupAddMemberModel): Promise<types.core.OK>;
    groupRemoveMember(model: GroupRemoveMemberModel): Promise<types.core.OK>;
    groupCutEra(model: GroupCutEraModel): Promise<types.core.OK>;
    groupPruneArchive(model: GroupPruneArchiveModel): Promise<types.core.OK>;
    groupGetKeyArchive(model: GroupGetKeyArchiveModel): Promise<GroupGetKeyArchiveResult>;
}
