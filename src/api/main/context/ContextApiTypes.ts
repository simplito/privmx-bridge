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
    /**
     * The metadata key wrapped once to the group's own grant public key, at epoch 1. One entry, whatever the
     * group's size: members open it by climbing to a key they can already reach. No `group` — the id does not
     * exist yet, and the server files the entry against the group it is creating.
     */
    groupKeys?: Omit<types.cloud.GroupKeyEntrySet, "group">;
    policy?: types.cloud.ContainerPolicy;
    /** The group's hidden key tree at epoch 1. Every group is tree-backed; members reach the grant key by climbing. */
    tree: types.cloud.GroupTreeState;
}

export interface GroupAddMemberEntry {
    userId: types.cloud.UserId;
    role: types.cloud.ContainerRole;
}

/**
 * Adds members to a tree-backed group. Deliberately *not* an update to `users`: the point of the tree is that a
 * member can be added without advancing the epoch, and that is only checkable against a named seat.
 */
export interface GroupAddMembersModel {
    id: types.group.GroupId;
    /** The newcomers, index-aligned with `transition.positions` — that list is the only place a seat is named.
     *  One or many: seating several at once is not n additions batched, it is one delta over their union. */
    members: GroupAddMemberEntry[];
    keyId: types.core.KeyId;
    data: types.group.GroupData;
    /** The delta: the new leaves' paths re-keyed, `O(k log n)` to build, send and check — and less than that
     *  when the seats are neighbours, because the shared ancestors are re-keyed once. */
    transition: types.cloud.GroupTreeAdditionTransition;
    /** Guards against computing the tree against a state a concurrent removal has already replaced. */
    expectedKeyVersion: number;
}

/**
 * Removes members from a tree-backed group, in a single operation that must do all of it at once: blank the
 * leaves, refresh the union of their direct paths, rotate the grant keypair (advancing the epoch **once**), and
 * supply the rungs that keep the older epochs reachable from the new one.
 *
 * Removing several in one call is not a convenience: done one at a time, each removal advances the epoch on its
 * own, so every container the group can read goes stale `k` times and the group's rotation budget is charged `k`
 * times. One batch is one epoch.
 */
export interface GroupRemoveMembersModel {
    id: types.group.GroupId;
    /** The members leaving. The bridge derives their seats from the roster; the transition only has to agree. */
    userIds: types.cloud.UserId[];
    groupPubKey: types.cloud.GroupPubKey;
    keyId: types.core.KeyId;
    data: types.group.GroupData;
    /**
     * The removal as a delta: the refreshed path and the edges around it, with the generations it was planned
     * against. `O(log n)` instead of the whole tree, which at 16 384 members is ~13 MB in each direction.
     */
    transition: types.cloud.GroupTreeTransition;
    rungs: types.cloud.GroupArchiveRung[];
    /**
     * The new metadata key wrapped once to the group's own grant public key at the epoch being created.
     *
     * Without this, locking a departing member out of the group's *metadata* would cost one wrap per remaining
     * member — the O(n) the tree exists to remove. With it, a removal is one wrap regardless of group size, and
     * every remaining member opens it by climbing to the grant key they can already reach.
     */
    groupKeys?: types.cloud.GroupKeyEntrySet;
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

/**
 * Updates the group's metadata. Membership is **not** here: moving a member moves the tree, so it goes through
 * `groupAddMembers`/`groupRemoveMembers`, which is the only place a seat and its keys change together.
 */
export interface GroupUpdateModel {
    id: types.group.GroupId;
    resourceId?: types.core.ClientResourceId;
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    version: types.group.GroupVersion;
    policy?: types.cloud.ContainerPolicy;
}

/**
 * Rotates the group's grant keypair without removing anybody — the same epoch advance a removal performs, minus
 * the removal.
 *
 * Node keys are untouched, so this is `O(1)`: one new grant edge wrapping the new grant key to the unchanged
 * root, the rungs that keep the old epochs reachable, and the metadata key re-wrapped once to the new grant key.
 */
export interface GroupGenerateNewKeyModel {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    /** The new grant edge: the new grant key wrapped to the root node, at the epoch being created. */
    grantEdge: types.cloud.GroupTreeEdge;
    /** One epoch's worth of rungs, so the new epoch can still descend to the old ones. */
    rungs: types.cloud.GroupArchiveRung[];
    /** The new metadata key wrapped once to the new grant public key. */
    groupKeys?: types.cloud.GroupKeyEntrySet;
    expectedKeyVersion: number;
    confirmationTag?: types.core.Base64;
}

export interface RotatedAlreadyData {
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
    winnerKeyEntry: types.core.KeyEntry;
    /**
     * `HMAC(winner's metadata key, ...)` from the winning version's history entry — what lets the loser tell an
     * honest winner from a bridge steering it onto an epoch of the bridge's choosing. Only a member could have
     * produced it. Absent when the winner was written without one, and a loser that cannot check it must refuse
     * to adopt rather than trust the rest of this payload.
     */
    confirmationTag?: types.core.Base64;
}

export interface GroupDeleteModel {
    groupId: types.group.GroupId;
}

/**
 * How much of the tree to serve.
 *
 * `path` — the caller's own climb: their leaf edge, the edges above it, the grant edge, and the public keys of
 * the path and the copath. `O(log n)`, and everything a client needs to reach the group key or plan a removal.
 * `full` — the whole structure, for a client that wants to validate it independently. At 16 384 members that is
 * 32 767 edges, about 10.5 MB.
 */
export type GroupTreeScope = "path"|"full";

export interface GroupGetModel {
    groupId: types.group.GroupId;
    type?: types.group.GroupType;
    /** Defaults to `path`. */
    scope?: GroupTreeScope;
    /**
     * Also serve the paths and copaths of these members' seats.
     *
     * Planning a removal needs the *subjects'* paths, not the caller's — a manager removing somebody sits
     * elsewhere in the tree. Without this a manager has no `O(log n)` option and has to ask for `full`, which is
     * the cost the path view exists to avoid. A list, because a batch removal is planned against the union of
     * every departing member's path.
     */
    forUserIds?: types.cloud.UserId[];
    /**
     * Ask the bridge to allocate this many seats for newcomers and serve the view an addition to them needs.
     *
     * Returned in `nextFreeSeats`, lowest-blank-first and then appended, which is the only order the tree
     * accepts. Without this a client has to download `leafAssignment` — `O(members)` — purely to find out where
     * a newcomer may sit, then come back for the node window around that seat.
     *
     * The seats can be taken by a concurrent addition before the request that uses them lands; that is what
     * `expectedKeyVersion` is for, and the client retries against the winner's state.
     */
    forNewMembers?: number;
    /**
     * Serve history from this version on — the audit trail, and the only way to ask for it.
     *
     * Absent means the head entry alone, which is everything a read needs: the head carries the current `data`,
     * names the current keyId, and attests the roster. Nothing verifies by replaying what came before, and an
     * older epoch's grant key comes down the Epoch Ladder (`groupGetKeyArchive`), not out of an old entry.
     *
     * The default is deliberately the smallest useful answer rather than everything: a group's history holds one
     * full metadata envelope per version, so serving it all would make every read grow with the group's age.
     */
    fromVersion?: number;
}

export interface GroupGetResult {
    group: GroupInfo;
}

export interface GroupListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface GroupListResult {
    groups: GroupSummary[];
    count: number;
}

/**
 * A group as a listing serves it: identity, roster, epoch, policy. No `data`, `history`, `keys`, `groupKeys` or
 * tree state — those grow with membership and with every change, so a page of them grows as `groups × state`.
 * Use `groupGet` for one group's state.
 */
export interface GroupSummary {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.group.GroupType;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    version: types.group.GroupVersion;
    keyVersion: number;
    policy: types.cloud.ContainerPolicy;
}

export interface GroupDataEntry {
    keyId: types.core.KeyId;
    data: types.group.GroupData;
}

/**
 * A group version record.
 *
 * No roster: the membership change is committed as a signed delta inside the opaque `data` (endpoint DIO) and
 * replayed client-side. The bridge used to denormalise the whole roster onto every entry so a client could
 * cross-check it, which made the history `O(members x versions)` for a value the bridge never reads and has no
 * say in. What it does assert per entry — `keyId`, `groupPubKey` — is still here, and the resulting roster is
 * checked against the head.
 */
export interface GroupHistoryEntryInfo {
    keyId: types.core.KeyId;
    groupPubKey: types.cloud.GroupPubKey;
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
    version: types.group.GroupVersion;
    keyVersion: number;
    keyHistory: types.cloud.GroupPubKeyAtEpoch[];
    policy: types.cloud.ContainerPolicy;
    history: GroupHistoryEntryInfo[];
    /**
     * Version of the first entry in `data` and `history`. Always present, so a client can tell what it was given
     * rather than assuming. Equal to `version` when the response carries the head alone, which is the default;
     * lower when `fromVersion` asked for the audit trail.
     */
    firstServedVersion: types.group.GroupVersion;
    // ── Tree state ───────────────────────────────────────────────────────────────────────────────────────────
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    /**
     * The caller's own leaf. The bridge fills this in because it knows who is asking, which saves the client from
     * having to know its own user id to find its seat. Absent for a caller holding no seat.
     */
    ownLeafPosition?: number;
    /**
     * Where each `forUserIds` entry sits, in the order asked for. The bridge resolves them anyway to serve their
     * paths, so handing them back is what lets a manager plan a removal without reading `leafAssignment` to find
     * the seats itself. Members holding no seat are omitted, so a short list means somebody was not seated.
     */
    subjectLeafPositions?: number[];
    /** Seats the bridge allocated for `forNewMembers`, ascending — what an addition names as its positions. */
    nextFreeSeats?: number[];
    treeNodes: types.cloud.GroupTreeNode[];
    treeEdges: types.cloud.GroupTreeEdge[];
    /** Which of the two views the tree fields above hold. */
    treeScope: GroupTreeScope;
    /** Metadata keys addressed to the group itself, one per epoch that rotated it. */
    groupKeys: types.cloud.GroupKeysEntry[];
    eraFloor: number;
    archivePrunedBelow?: number;
}

/** Which operation changed the group, so a client can decide whether the change is worth a `groupGet`. */
export type GroupChangeKind = "created"|"updated"|"keyRotated"|"memberAdded"|"memberRemoved"|"eraCut"|"archivePruned";

/**
 * What a group event carries: enough to tell *which* group changed and *how far* it has moved, and nothing that
 * grows with the group.
 *
 * The state used to travel in here, converted once per recipient — a thousand members meant a thousand copies of
 * the tree and the history, hundreds of megabytes over the socket for one membership change. A client that cares
 * about the change calls `groupGet`; one that does not pays nothing. `version` and `keyVersion` are what let it
 * decide without asking.
 */
export interface GroupChangedEventData {
    groupId: types.group.GroupId;
    contextId: types.context.ContextId;
    version: types.group.GroupVersion;
    keyVersion: number;
    changeKind: GroupChangeKind;
}

export type GroupCreatedEvent = types.cloud.Event<"groupCreated", "context", GroupChangedEventData>;
export type GroupUpdatedEvent = types.cloud.Event<"groupUpdated", "context", GroupChangedEventData>;
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
    groupAddMembers(model: GroupAddMembersModel): Promise<types.core.OK>;
    groupRemoveMembers(model: GroupRemoveMembersModel): Promise<types.core.OK>;
    groupCutEra(model: GroupCutEraModel): Promise<types.core.OK>;
    groupPruneArchive(model: GroupPruneArchiveModel): Promise<types.core.OK>;
    groupGetKeyArchive(model: GroupGetKeyArchiveModel): Promise<GroupGetKeyArchiveResult>;
}
