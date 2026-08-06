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

/** Container key blobs distributed to a group grantee (the container key encrypted to the group's pubkey). */
export interface GroupKeysEntry {
    group: types.group.GroupId;
    groupEpoch?: number;
    keys: types.core.KeyEntry[];
}

export interface GroupKeyEntrySet {
    group: types.group.GroupId;
    groupEpoch: number;  // required: the group epoch the CK was wrapped to; must equal the group's current keyVersion (Phase 2, BR-5)
    keyId: types.core.KeyId;
    data: types.core.UserKeyData;
}

// ── Hidden key tree (documents/nested_groups/09-hidden-key-tree.md) ─────────────────────────────────────────
// The bridge stores and serves this state but cannot read a single key in it: every `data` below is a
// ciphertext addressed to a key only clients hold. What the bridge *can* do — and must — is check the shape,
// which is pure integer arithmetic over node indices (see keytree/TreeMath.ts).

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
 * keeps tree growth from advancing the epoch, and so from staling every container the group can read.
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

/** Complete public tree state of a group. `leafAssignment` uses "" for a blank left by a removal. */
export interface GroupTreeState {
    numLeaves: number;
    leafAssignment: UserId[];
    nodes: GroupTreeNode[];
    edges: GroupTreeEdge[];
}

// ── Epoch Ladder (documents/epoch_key_archive/) ─────────────────────────────────────────────────────────────

/**
 * One rung: `wrap(sk_targetKeyVersion -> pk_atKeyVersion)`.
 *
 * `targetKeyVersion < atKeyVersion` always. That single comparison is the whole security guarantee of this
 * layer — an upward rung would hand a removed member a key from after their removal — and the bridge is the
 * only party positioned to enforce it globally, which is why it does so on every write.
 */
export interface GroupArchiveRung {
    atKeyVersion: number;
    targetKeyVersion: number;
    recipientKind?: "epoch"|"user"|"group";
    recipient?: string;
    data: types.core.UserKeyData;
    author?: UserId;
}

/** Role a group grantee holds in a container. Role-tagged so it generalizes to RBAC (widen this union). */
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
    /** When "yes", the container opts into forward secrecy: clients lazily re-key it (rotateKey) after a
     *  grantee group's epoch advances, so removed members can't read content written afterwards. Bridge stores
     *  this advisory flag (best-effort — it does not force re-key); the endpoint acts on it. */
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
