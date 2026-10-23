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
    /** Required: the first commit statement names the group by it (see `commit`). */
    resourceId: types.core.ClientResourceId;
    type?: types.group.GroupType;
    groupPubKey: types.cloud.GroupPubKey;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    /** The roster/tree plane's first entry: carries the roster tag and no metadata. */
    data: types.group.GroupData;
    publicMeta: types.group.GroupData;
    privateMeta: types.group.GroupData;
    keyId: types.core.KeyId;
    /**
     * The metadata key wrapped once to the group's own grant public key, at epoch 1. One entry, whatever the
     * group's size: members open it by climbing to a key they can already reach. No `group` — the id does not
     * exist yet, and the server files the entry against the group it is creating.
     */
    groupKeys?: Omit<types.cloud.GroupKeyEntrySet, "group">;
    /**
     * The group's hidden key tree at epoch 1. Every group is tree-backed; members reach the grant key by climbing.
     *
     * Written as the creator's first commit: `nodes` is the creator's keyed path at generation 0 and nothing else,
     * `edges` what those nodes owe plus the grant edge. The creator must be among the members.
     */
    tree: types.cloud.GroupTreeState;
    /** The group's first commit statement (seq 1), signed by the creator. Its `groupId` is this `resourceId` —
     *  the bridge assigns the group's id only once the statement is already signed. */
    commit: types.cloud.GroupTreeCommitStatement;
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
    /** The commit statement for this change, signed by the caller (see `types.cloud.GroupTreeCommitStatement`). */
    commit: types.cloud.GroupTreeCommitStatement;
    /** Guards against computing the tree against a state a concurrent removal has already replaced. */
    expectedKeyVersion: number;
    /**
     * The roster version this write is planned against; the entry lands at `expectedRosterVersion + 1`.
     *
     * `expectedKeyVersion` cannot stand in for it: an addition moves the roster without moving the epoch, so a
     * caller can hold the current epoch and still be planning against a roster that has already grown. The
     * commit statement signs the version it lands at, so a write the bridge renumbered would carry a statement
     * no reader can verify — this is what makes the number the caller predicts the number it gets.
     *
     * Every roster-plane write carries one; the other two point here rather than restating this.
     */
    expectedRosterVersion: number;
}

/**
 * Removes members from a tree-backed group, in a single operation that must do all of it at once: blank the
 * leaves and their keyed paths, re-key the remover's own keyed path, rotate the grant keypair (advancing the
 * epoch **once**), and supply the rungs that keep the older epochs reachable from the new one. The caller cannot
 * be among `userIds`.
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
    /** The commit statement for this change, signed by the caller (see `types.cloud.GroupTreeCommitStatement`). */
    commit: types.cloud.GroupTreeCommitStatement;
    rungs: types.cloud.GroupArchiveRungSubmission[];
    /**
     * The new metadata key wrapped once to the group's own grant public key at the epoch being created.
     *
     * Without this, locking a departing member out of the group's *metadata* would cost one wrap per remaining
     * member — the O(n) the tree exists to remove. With it, a removal is one wrap regardless of group size, and
     * every remaining member opens it by climbing to the grant key they can already reach.
     */
    groupKeys?: types.cloud.GroupKeyEntrySet;
    expectedKeyVersion: number;
    /** @see GroupAddMembersModel.expectedRosterVersion */
    expectedRosterVersion: number;
    /**
     * Removal when the current grant key cannot be recovered: history before the new epoch becomes unreachable.
     * `rungs` must be empty, and the era is cut at the new epoch in the same write, as `groupCutEra` would — so
     * the caller needs `context/groupCutEra` as well, and members get an `eraCut` notification besides
     * `memberRemoved`. Both metadata planes stay at the epoch they were written under, so they become unreadable
     * until a manager rewrites them (`groupUpdatePublicMeta`, `groupUpdatePrivateMeta`).
     */
    abandonHistory?: boolean;
}

/**
 * Re-keys the caller's own keyed path in a tree-backed group, refilling whatever blanks a removal or an addition
 * left on it.
 *
 * Any seated member may call it, for themselves only — the path re-keyed is the caller's, derived by the bridge.
 * It moves neither the epoch nor the roster version, writes no history entry and sends no event: the grant key
 * is unchanged, only the route to it. Rate-limited per member.
 */
export interface GroupSelfUpdateModel {
    id: types.group.GroupId;
    transition: types.cloud.GroupTreeSelfUpdateTransition;
    /** The commit statement for this change, signed by the caller (see `types.cloud.GroupTreeCommitStatement`). */
    commit: types.cloud.GroupTreeCommitStatement;
    /** The epoch the path was planned against; a removal or rotation since then answers `ROTATED_ALREADY`. */
    expectedKeyVersion: number;
}

/**
 * Pages through a group's commit statements — what a client that pinned an older statement fetches to check every
 * step between it and the latest: each signature, contiguous seqs, each committer a member of the roster before it.
 */
export interface GroupGetTreeCommitsModel {
    groupId: types.group.GroupId;
    /** Exclusive: statements with `seq > fromSeq`. */
    fromSeq: number;
    /** Inclusive; defaults to the latest. */
    toSeq?: number;
}

export interface GroupGetTreeCommitsResult {
    /** Ascending by seq, at most 256; ask again from the last one for more. */
    commits: types.cloud.GroupTreeCommitStatement[];
    /** With seq 1: the roster the group was created with, which seq 1 binds by `rosterHash` only. */
    genesisUsers?: types.cloud.UserId[];
    /** With seq 1: see `genesisUsers`. */
    genesisManagers?: types.cloud.UserId[];
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
 * Appends one repair rung to a span an epoch already published: `rung` seals the key of `targetKeyVersion` to the
 * grant key of `atKeyVersion`. Any seated member may call it; the bridge records the caller as the rung's author.
 * Only canonical downward spans at or below the current epoch and at or above the floor are accepted, one rung per
 * span per member, at most four per span; every call is charged to the caller's own repair budget.
 */
export interface GroupRepairRungModel {
    id: types.group.GroupId;
    rung: types.cloud.GroupArchiveRungSubmission;
}

/**
 * Fetches the Epoch Ladder. Kept out of `groupGet` because the archive grows with the group's whole history,
 * while a client needs it only when it is actually reaching for an older epoch.
 */
export interface GroupGetKeyArchiveModel {
    id: types.group.GroupId;
    /** Optional window. With either bound omitted the rungs come a page of at most 256 at a time, ascending by
     *  `atKeyVersion`; ask again from the last one's `atKeyVersion` for the next page. */
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
 * Rewrites the public metadata plane.
 *
 * Structurally cannot carry the private plane's envelope or the policy — which is what makes
 * `context/groupUpdatePublicMeta` an enforceable grant rather than a declarative one.
 *
 * Membership is **not** here either: moving a member moves the tree, so it goes through
 * `groupAddMembers`/`groupRemoveMembers`, which is the only place a seat and its keys change together.
 */
export interface GroupUpdatePublicMetaModel {
    id: types.group.GroupId;
    resourceId?: types.core.ClientResourceId;
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    /** CAS on `publicMetaVersion`, unconditional — there is no `force`. */
    version: types.group.GroupVersion;
}

/** The private plane's mirror, CAS-guarded on `privateMetaVersion`. */
export interface GroupUpdatePrivateMetaModel {
    id: types.group.GroupId;
    resourceId?: types.core.ClientResourceId;
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    version: types.group.GroupVersion;
}

/**
 * Sets the group's container policy, as a signed commit (op `policy`): the rules that govern commits are part of the
 * signed group state, so a policy change is chained, CAS-ed and checked like any other commit (T4-10).
 *
 * Neither metadata plane moves and no epoch advances; the tree and roster stay as they are.
 */
export interface GroupUpdatePolicyModel {
    id: types.group.GroupId;
    /** The policy commit statement: `op: "policy"`, everything but `policyHash` unchanged, and the new policy in
     *  `commit.policy` (`{}` resets every rule to the v3 defaults the statements sign). */
    commit: types.cloud.GroupTreeCommitStatement;
    /** Current epoch (CAS). */
    expectedKeyVersion: number;
    /** Current roster version (CAS). */
    expectedRosterVersion: number;
}

/**
 * Rotates the group's grant keypair without removing anybody — the same epoch advance a removal performs, minus
 * the removal.
 *
 * Node keys are untouched, so this is `O(1)`: one new grant edge wrapping the new grant key to the unchanged
 * root, or to the sole member of a one-leaf tree, the rungs that keep the old epochs reachable, and the metadata key re-wrapped once to the new grant key.
 */
export interface GroupGenerateNewKeyModel {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    /** The new grant edge: the new grant key wrapped to the root node, or to the sole member of a one-leaf tree
     *  (whose root is that member's leaf), at the epoch being created. */
    grantEdge: types.cloud.GroupTreeEdge;
    /** The rotation's commit statement: an empty path, the tree as it stands, the new epoch and grant key. */
    commit: types.cloud.GroupTreeCommitStatement;
    /** One epoch's worth of rungs, so the new epoch can still descend to the old ones. */
    rungs: types.cloud.GroupArchiveRungSubmission[];
    /** The new metadata key wrapped once to the new grant public key. */
    groupKeys?: types.cloud.GroupKeyEntrySet;
    expectedKeyVersion: number;
    /** @see GroupAddMembersModel.expectedRosterVersion */
    expectedRosterVersion: number;
}

/** Where the group's epoch is now. Informational: the loser re-reads and re-verifies before planning again. */
export interface RotatedAlreadyData {
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
}

export interface GroupDeleteModel {
    groupId: types.group.GroupId;
}

/**
 * How much of the tree to serve.
 *
 * `path` — the caller's own climb: the records of their keyed path (filled or blank), the edges addressed to
 * them or to a node on that path, and the grant edge. `O(log n)`; everything a client needs to reach the group
 * key.
 * `plan` — every node record of the group (filled and blank, with generations) plus the same climbing edges.
 * What a client needs to plan a commit: it computes the post state's resolutions locally. Records exist only on
 * keyed nodes, so this is `O(n / 16)`.
 * `full` — the whole structure, for a client that wants to validate it independently. Up to `2n - 1` edges.
 *
 * A caller holding no seat has no path to serve, and gets `full`.
 */
export type GroupTreeScope = "path"|"plan"|"full";

export interface GroupGetModel {
    groupId: types.group.GroupId;
    type?: types.group.GroupType;
    /** Defaults to `path`. */
    scope?: GroupTreeScope;
    /**
     * Also resolve these members' seats, returned in `subjectLeafPositions` — what a removal names as its blanked
     * positions. Serves no extra nodes: planning reads them from `scope: "plan"`.
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
     *
     * Served a page at a time — at most 8 entries, oldest first. Ask again from one past the last version served;
     * the trail ends at `rosterVersion`.
     */
    fromRosterVersion?: number;
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
 * A group as a listing serves it: identity, counters, epoch, policy — every field of constant size, so a page is
 * `O(limit)` whatever the groups' membership and age. No roster (`users`/`managers`), tree, `data`, `history`,
 * `groupKeys` or commit statement: those grow with membership or with every change. Use `groupGet` for them.
 *
 * `groupPubKey` is served as stored and vouched for by nothing here; a client checks it against the signed latest
 * statement `groupGet` serves.
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
    publicMetaVersion: types.group.GroupVersion;
    privateMetaVersion: types.group.GroupVersion;
    rosterVersion: number;
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
    /** The roster version this entry landed at, and the epoch its tag is keyed at. Always both. */
    version: types.group.GroupVersion;
    keyVersion: number;
}

/** One metadata plane's current entry, served alongside the roster head. Instantiated once per plane. */
export interface GroupMetaEntryInfo {
    version: types.group.GroupVersion;
    keyId: types.core.KeyId;
    /** Epoch this entry's key belongs to. Never above the group's; below it when no update followed a rotation. */
    keyVersion: number;
    data: types.group.GroupData;
    created: types.core.Timestamp;
    author: types.cloud.UserId;
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
    /** Roster/tree plane entries. The head attests the roster; none of them carry metadata. */
    data: GroupDataEntry[];
    /**
     * The current entry of each metadata plane. Either may sit at an older epoch than the group — descend the
     * Ladder to its key — and the two may sit at different epochs, since only a write to a plane lifts it.
     */
    publicMeta: GroupMetaEntryInfo;
    privateMeta: GroupMetaEntryInfo;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    /** Public metadata plane counter. Moves only on `groupUpdatePublicMeta`. */
    publicMetaVersion: types.group.GroupVersion;
    /** Private metadata plane counter. Moves only on `groupUpdatePrivateMeta`. */
    privateMetaVersion: types.group.GroupVersion;
    /** Roster plane counter. Moves only on a membership change or a rotation. */
    rosterVersion: number;
    keyVersion: number;
    keyHistory: types.cloud.GroupPubKeyAtEpoch[];
    policy: types.cloud.ContainerPolicy;
    history: GroupHistoryEntryInfo[];
    // ── Tree state ───────────────────────────────────────────────────────────────────────────────────────────
    /** Layout of the tree. 2 for every group the current API creates; anything else is a group from before the
     *  layout changed, which a client must not climb or commit to. */
    treeVersion: number;
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
    /** Which view the tree fields above hold. */
    treeScope: GroupTreeScope;
    /** The group's latest commit statement: what the served state must hash to. Absent only on a group from before
     *  statements existed, which a client must not use. */
    treeCommit?: types.cloud.GroupTreeCommitStatement;
    /** The statements named by `setBy` of the filled nodes in `treeNodes`, ascending and deduplicated — what vouches
     *  for each served key. */
    treeCommits: types.cloud.GroupTreeCommitStatement[];
    /**
     * Scope `"path"` with a seated caller only: hex `CH(c)` for each node of the caller's copath, aligned with
     * `TreeMath.copath(ownLeafPosition, numLeaves)` — with the caller's own path that is enough to recompute the
     * tree hash without the rest of the tree.
     */
    copathHashes?: string[];
    /** Metadata keys addressed to the group itself, one per epoch that rotated it. */
    groupKeys: types.cloud.GroupKeysEntry[];
    eraFloor: number;
    archivePrunedBelow?: number;
}

/** Which operation changed the group, so a client can decide whether the change is worth a `groupGet`. */
export type GroupChangeKind = "created"|"publicMetaUpdated"|"privateMetaUpdated"|"policyUpdated"|"keyRotated"
    |"memberAdded"|"memberRemoved"|"eraCut"|"archivePruned";

/**
 * What a group event carries: enough to tell *which* group changed and *how far* it has moved, and nothing that
 * grows with the group.
 *
 * The state used to travel in here, converted once per recipient — a thousand members meant a thousand copies of
 * the tree and the history, hundreds of megabytes over the socket for one membership change. A client that cares
 * about the change calls `groupGet`; one that does not pays nothing. The four counters are what let it decide
 * without asking — and which plane moved.
 *
 * A `policyUpdated` moves no counter at all: the policy is not inside any signed envelope, so there is nothing
 * for a client to re-verify and no version for it to advance.
 */
export interface GroupChangedEventData {
    groupId: types.group.GroupId;
    contextId: types.context.ContextId;
    publicMetaVersion: types.group.GroupVersion;
    privateMetaVersion: types.group.GroupVersion;
    rosterVersion: number;
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

/**
 * An ephemeral notification sent to the group's members, sealed with the group's own key.
 *
 * `data` is opaque here — a base64 group envelope. Only members can open it, so the bridge neither needs nor gets
 * a per-recipient key: one payload is built once and published once, whatever the group's size. That is the whole
 * reason this exists next to `contextSendCustomEvent`, which wraps a throwaway key per recipient.
 */
export interface GroupSendCustomEventModel {
    groupId: types.group.GroupId;
    channel: types.core.WsChannelName;
    data: unknown;
    /** A subset of the roster. Omitted means every member. */
    users?: types.cloud.UserId[];
}

export type GroupCustomEvent = types.cloud.Event<"custom", `group/${types.group.GroupId}/${types.core.WsChannelName}`, GroupCustomEventData>;

export interface GroupCustomEventData {
    id: types.group.GroupId;
    /** Claimed sender. The envelope's own signature is what actually attests to the author. */
    author: types.cloud.UserIdentity;
    eventData: unknown;
}

export interface IContextApi {
    contextGet(model: ContextGetModel): Promise<ContextGetResult>;
    contextList(model: ContextListModel): Promise<ContextListResult>;
    contextGetUsers(model: ContextGetUsersModel): Promise<ContextGetUserResult>;
    contextListUsers(model: ContextListUsersModel): Promise<ContextListUsersResult>
    contextSendCustomEvent(model: ContextSendCustomEventModel): Promise<types.core.OK>;
    groupCreate(model: GroupCreateModel): Promise<GroupCreateResult>;
    groupUpdatePublicMeta(model: GroupUpdatePublicMetaModel): Promise<types.core.OK>;
    groupUpdatePrivateMeta(model: GroupUpdatePrivateMetaModel): Promise<types.core.OK>;
    groupUpdatePolicy(model: GroupUpdatePolicyModel): Promise<types.core.OK>;
    groupGenerateNewKey(model: GroupGenerateNewKeyModel): Promise<types.core.OK>;
    groupDelete(model: GroupDeleteModel): Promise<types.core.OK>;
    groupGet(model: GroupGetModel): Promise<GroupGetResult>;
    groupList(model: GroupListModel): Promise<GroupListResult>;
    groupAddMembers(model: GroupAddMembersModel): Promise<types.core.OK>;
    groupRemoveMembers(model: GroupRemoveMembersModel): Promise<types.core.OK>;
    groupSelfUpdate(model: GroupSelfUpdateModel): Promise<types.core.OK>;
    groupGetTreeCommits(model: GroupGetTreeCommitsModel): Promise<GroupGetTreeCommitsResult>;
    groupCutEra(model: GroupCutEraModel): Promise<types.core.OK>;
    groupPruneArchive(model: GroupPruneArchiveModel): Promise<types.core.OK>;
    groupRepairRung(model: GroupRepairRungModel): Promise<types.core.OK>;
    groupGetKeyArchive(model: GroupGetKeyArchiveModel): Promise<GroupGetKeyArchiveResult>;
    groupSendCustomEvent(model: GroupSendCustomEventModel): Promise<types.core.OK>;
}
