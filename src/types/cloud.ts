/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type InstanceId = string&{__instanceId: never};
export type SolutionId = string&{__solutionId: never};
export type SolutionName = string&{__solutionName: never};
export type UserId = string&{__userId: never};
export type ContextAcl = string&{__contextAcl: never};
export type AclFunctionName = string&{__aclFunctionName: never};
export type AclFunctionArgument = string&{__aclFunctionArgument: never};
export type AclFunctions = Record<AclFunctionName, AclFunctionArgument[]>;
export type AclGroupName = string&{__aclGroupName: never};
export type AclGroups =  Record<AclGroupName, AclFunctions>;
export type AppPubKey = types.core.EccPubKey;
export type UserPubKey = types.core.EccPubKey;
export type GroupPubKey = types.core.EccPubKey;

export interface GroupPubKeyAtEpoch {
    keyVersion: number;
    groupPubKey: GroupPubKey;
}
export type KnownKeyId = string&{__knownKeyId: never};
export type KnownKeyStatus = "login"|"logout";
export type ChannelSchemeOptions = Pick<ChannelScheme, "containerType"|"limitedBy"|"objectId">;
export type ChannelSchemeSelectors = "containerId"|"itemId"|"contextId"|"none";

export interface UserIdentity {
    id: UserId;
    pub: UserPubKey;
}
export interface ChannelScheme {
    subscriptionId: types.core.SubscriptionId;
    orgChannel: string;
    path: string;
    limitedBy: string;
    objectId: string;
    version: number;
    containerType?: string;
}

export interface KnownKeyStatusChange {
    action: KnownKeyStatus;
    timestamp: types.core.Timestamp;
}

export interface UserIdentityWithStatus {
    id: UserId;
    pub: UserPubKey;
    status: "active"|"inactive";
}

export interface UserIdentityWithStatusAndAction {
    id: UserId;
    pub: UserPubKey;
    status: "active"|"inactive";
    lastStatusChange: null|KnownKeyStatusChange;
}

export interface UserKeysEntry {
    user: UserId;
    keys: types.core.KeyEntry[];
}

export interface KeyEntrySet {
    user: UserId;
    keyId: types.core.KeyId;
    data: types.core.UserKeyData;
}

/** One container-key blob wrapped to a group's pubkey, tagged with the epoch it was wrapped at. */
export interface GroupKeyEntry {
    keyId: types.core.KeyId;
    data: types.core.UserKeyData;
    groupEpoch?: number;
}

/** Container key blobs distributed to a group grantee (the container key encrypted to the group's pubkey). */
export interface GroupKeysEntry {
    group: types.group.GroupId;
    keys: GroupKeyEntry[];
}

export interface GroupKeyEntrySet {
    group: types.group.GroupId;
    groupEpoch: number;  // required: the group epoch the CK was wrapped to; must equal the group's current keyVersion (Phase 2, BR-5)
    keyId: types.core.KeyId;
    data: types.core.UserKeyData;
}

// ── Hidden key tree ─────────────────────────────────────────────────────────────────────────────────────────
// Every `data` below is a ciphertext addressed to a key only clients hold. The bridge checks the shape only —
// integer arithmetic over node indices, see keytree/TreeMath.ts.

/** Public half of one tree node. Nodes are never deleted, only refreshed into a higher generation. */
export interface GroupTreeNode {
    nodeIndex: number;
    generation: number;
    publicKey: types.core.EccPubKey;
}

export type GroupTreeChildKind = "user"|"node";

/**
 * One edge: `wrap(sk_parent -> pk_child)`, letting a client that reached the child reach the parent.
 *
 * `isGrantEdge` marks the single edge joining the grant keypair to the tree root. That indirection is what
 * keeps tree growth from advancing the epoch.
 */
export interface GroupTreeEdge {
    isGrantEdge?: boolean;
    /** Absent on the grant edge, whose "parent" is the grant keypair rather than a node. */
    parentIndex?: number;
    /** Node generation for an ordinary edge; the epoch (keyVersion) for the grant edge. */
    parentGeneration: number;
    childKind: GroupTreeChildKind;
    childIndex?: number;
    childGeneration?: number;
    childUserId?: UserId;
    data: types.core.UserKeyData;
}

/**
 * A removal expressed as what it changes: the refreshed path and the edges around it, `O(log n)`.
 *
 * Every refreshed node states the generation it was read at. That precondition is what makes the delta safe: a
 * transition computed against a state that has since moved is refused rather than applied to a base it never
 * saw, and a replayed transition is a no-op instead of a second refresh.
 */
export interface GroupTreeTransition {
    /** The epoch the client planned against; must still be the group's current one. */
    baseKeyVersion: number;
    /** Seats being blanked — each removed member must hold one. A batch blanks them all in one epoch. */
    blankedPositions: number[];
    /** The union of the blanked leaves' direct paths, each node with the generation it was read at. Union, not
     *  concatenation: a shared ancestor is refreshed once. */
    refreshedNodes: GroupTreeRefreshedNode[];
    /** Edges to install: the ones out of the refreshed nodes, plus the grant edge at the new epoch. */
    edges: GroupTreeEdge[];
}

export interface GroupTreeRefreshedNode {
    nodeIndex: number;
    /** Generation this node had when the client read it — the precondition. */
    fromGeneration: number;
    /** Must be `fromGeneration + 1`. */
    generation: number;
    /** Must differ from the key it replaces: a bumped generation with the old key revokes nothing. */
    publicKey: types.core.EccPubKey;
}

/** An addition expressed as a delta: the new leaf's path re-keyed, at the same epoch. */
export interface GroupTreeAdditionTransition {
    /** The epoch the client planned against; must still be the group's current one, and does not advance. */
    baseKeyVersion: number;
    /** Seats being taken, one per newcomer and index-aligned with them: a blank, or the next position when the
     *  tree grows. Appends must be contiguous — a skipped seat is one nothing can reuse. */
    positions: number[];
    /** The union of the new leaves' direct paths, in the geometry seating them all produces. */
    seatedNodes: GroupTreeSeatedNode[];
    /** Edges to install: the ones out of the seated nodes, plus the grant edge re-issued to the new root. */
    edges: GroupTreeEdge[];
}

export interface GroupTreeSeatedNode {
    nodeIndex: number;
    /** Generation this node had when the client read it. Absent when growth mints the node. */
    fromGeneration?: number;
    /** `fromGeneration + 1`, or 0 for a minted node. */
    generation: number;
    /** Must differ from the key it replaces, when it replaces one. */
    publicKey: types.core.EccPubKey;
}

/** Complete public tree state of a group. `leafAssignment` uses "" for a blank left by a removal. */
export interface GroupTreeState {
    numLeaves: number;
    leafAssignment: UserId[];
    nodes: GroupTreeNode[];
    edges: GroupTreeEdge[];
}

// ── Epoch Ladder ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One rung: `wrap(sk_targetKeyVersion -> pk_atKeyVersion)`.
 *
 * `targetKeyVersion < atKeyVersion` always — an upward rung would hand a removed member a key from after their
 * removal. Enforced on every write.
 */
export interface GroupArchiveRung {
    atKeyVersion: number;
    targetKeyVersion: number;
    recipientKind?: "epoch"|"user"|"group";
    recipient?: string;
    data: types.core.UserKeyData;
    author?: UserId;
}

/** Role a group grantee holds in a container. */
export type ContainerRole = "user"|"manager";

/** A group granted access to a container, with the role it holds there. */
export interface GroupGrant {
    groupId: types.group.GroupId;
    role: ContainerRole;
}

/** Group grantees passed to a container repository on create/update (Phase 2 group-as-member). */
export interface ContainerGrantees {
    groups?: GroupGrant[];
    groupKeys?: GroupKeysEntry[];
}

export interface Event<T extends string, C extends string, D> {
    type: T;
    channel: C;
    data: D;
    timestamp: types.core.Timestamp;
}

export interface ContainerWithoutItemPolicy extends ItemPolicy {
    /** Determines who can get a container */
    get?: PolicyEntry;
    /** Determines who can list containers created by themselves */
    listMy?: PolicyEntry;
    /** Determines who can list all containers */
    listAll?: PolicyEntry;
    /** Determines who can create a container */
    create?: PolicyEntry;
    /** Determines who can update a container */
    update?: PolicyEntry;
    /** Determines who can update a container */
    delete?: PolicyEntry;
    /** Determines who can rotate container keys */
    rotateKeys?: PolicyEntry;
    /** Determines who can update policy */
    updatePolicy?: PolicyEntry;
    /** Determines whether the creator has to be added to the list of managers */
    creatorHasToBeManager?: PolicyBooleanEntry;
    /** Determines whether the updater can be removed from the list of managers */
    updaterCanBeRemovedFromManagers?: PolicyBooleanEntry;
    /** Determines whether the owner can be removed from the list of managers */
    ownerCanBeRemovedFromManagers?: PolicyBooleanEntry;
    /** Determines whether the policy can be overwritten in container */
    canOverwriteContextPolicy?: PolicyBooleanEntry;
    /** Determines who can send custom notifications */
    sendCustomNotification?: PolicyEntry;
    /** When "yes", item writes are refused while a grantee group's epoch is ahead of the container's key, so
     *  clients must re-key before writing. Advisory: the bridge does not re-key anything itself. */
    forwardSecrecy?: PolicyBooleanEntry;
}

export interface ContainerPolicy extends ContainerWithoutItemPolicy {
    /** Item policy */
    item?: ItemPolicy;
}

export interface ContextInnerPolicy {
    /** Determines who can list users of this context */
    listUsers?: PolicyEntry;
    /** Determines who can send custom notifications */
    sendCustomNotification?: PolicyEntry;
}

/** @doctype string */
export type PolicyEntry = "inherit"|"yes"|"no"|"default"|"none"|"all"|"user"|"owner"|"manager"|"itemOwner"|"itemOwner&user"|"itemOwner&user,manager"|"owner&user"|"manager&owner"|"itemOwner,manager"|"itemOwner,owner"|"itemOwner,manager,owner"|"manager,owner"|(string&{__policyEntry: never});
export type PolicyBooleanEntry = "inherit"|"default"|"yes"|"no";

export interface ItemPolicy {
    /** Determines who can get an item */
    get?: PolicyEntry;
    /** Determines who can list items created by themselves */
    listMy?: PolicyEntry;
    /** Determines who can list all items */
    listAll?: PolicyEntry;
    /** Determines who can create an item */
    create?: PolicyEntry;
    /** Determines who can update an item */
    update?: PolicyEntry;
    /** Determines who can update an item */
    delete?: PolicyEntry;
}
