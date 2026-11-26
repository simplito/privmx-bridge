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
    /**
     * Required: the first commit statement names the group by it (see `commit`). A uuid v4, or the 64 hex digits
     * of a digest when the group's id has to follow from something the application already has.
     *
     * The name is unique within the context only: the same resourceId in another context is another group, and
     * nothing outside the context can take it or learn that it is taken. Inside the context, though, a digest
     * anybody can compute is a name anybody can take first: any user of the context who knows the entity can
     * create "its" group before its owner does. The bridge does not and cannot tell them apart.
     * `DUPLICATE_RESOURCE_ID` therefore means only that a group exists under the name, never that it is the right
     * one - and a client that finds a group under a derived id checks who created it (`creator`, bound by the
     * first statement) against who owns the entity before it trusts the group.
     */
    resourceId: types.core.ClientResourceId;
    type?: types.group.GroupType;
    groupPubKey: types.cloud.GroupPubKey;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    /** Defaults to "members". "context" takes the `context/groupSetVisibility` ACL entry and the `changeVisibility`
     *  rule of the rules being created, for the creator in the roster being created, narrowed by the context's
     *  `updatePolicy`. */
    visibleTo?: GroupVisibility;
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
    /**
     * The group's first commit statement (seq 1), signed by the creator. Its `groupId` is this `resourceId` —
     * the bridge assigns the group's id only once the statement is already signed.
     *
     * `commit.policy` carries the group's rules (`types.cloud.GroupRules`), all eight, each `managers`, `members`
     * or `nobody` (clients default every rule to `managers`), signed by `policyHash` =
     * `SHA-256("pmx-group-rules-v1\0" || lp(creator) || lp(addMembers) || lp(removeMembers) ||
     * lp(replaceMemberKeys) || lp(changeRoles) || lp(changeRules) || lp(changeVisibility) || lp(editPublicMeta) ||
     * lp(editPrivateMeta))`, `lp` a u32 big-endian length prefix. An
     * operation needs every rule whose responsibility it touches, as the rules stand before it:
     *
     * - add a plain member: `addMembers`; add a manager: `addMembers` + `changeRoles`
     * - remove a plain member: `removeMembers`; a manager: `removeMembers` + `changeRoles`; yourself: refused,
     *   another member removes you
     * - reseat (`groupReseat`): `replaceMemberKeys`
     * - set roles: `changeRoles`; change the rules (`groupUpdatePolicy`): `changeRules`; set visibility:
     *   `changeVisibility`
     * - a removal with `abandonHistory`: `changeRules`, `editPublicMeta` and `editPrivateMeta` on top of the
     *   removal's
     * - write the public / private metadata: `editPublicMeta` / `editPrivateMeta`
     * - rotate the key, self-update: any member (rotation rate-limited per member)
     * - delete: any manager
     *
     * A group that has managers keeps at least one (`GROUP_LAST_MANAGER`). The creator holds no privilege, but
     * the context's `policy.group.creatorHasToBeManager` (default "yes") still requires the creator to be among
     * `managers` at creation (`ACCESS_DENIED` otherwise); creation itself is gated by `policy.group.create`. The
     * context's `policy.group` can only narrow: `update` narrows `addMembers`, `removeMembers`,
     * `replaceMemberKeys` and both metadata rules, `updatePolicy` narrows `changeRoles`,
     * `changeRules` and `changeVisibility`, `rotateKeys` rotation and `delete` deletion.
     */
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
     * `rungs` must be empty, and the era is cut at the new epoch in the same write, deleting the rungs and epoch
     * keys below it — so the caller needs the `context/groupCutEra` ACL entry as well, and members get an
     * `eraCut` notification besides `memberRemoved`. Refused with `GROUP_IN_USE` while a space names the group:
     * nobody holding the old key is left to re-key it through the group.
     *
     * Besides the removal's rules it needs `changeRules`: deleting everybody's history is not a removal's to do,
     * and whoever may change the rules could grant itself anything they gate anyway. A key-less remover without
     * it leaves the removal to a member who still holds the key. Both metadata planes end up below the new floor,
     * unreadable until rewritten (`groupUpdatePublicMeta`, `groupUpdatePrivateMeta`), so it needs
     * `editPublicMeta` and `editPrivateMeta` as well.
     */
    abandonHistory?: boolean;
}

/**
 * Changes the role of members already in the group, as a signed `roles` commit. No key moves: a role decides what
 * the bridge and the other members accept from somebody, not what they can read.
 *
 * Needs the `changeRoles` rule. Refused with `GROUP_LAST_MANAGER` when it would leave a group that has
 * managers with none.
 */
export interface GroupSetRolesModel {
    id: types.group.GroupId;
    /** Each member at most once, and at least one of them changing lists. */
    changes: GroupAddMemberEntry[];
    /** The current content key: a role change opens no epoch. */
    keyId: types.core.KeyId;
    /** The roster entry after the change. */
    data: types.group.GroupData;
    /** The statement: op `roles`, the tree as it stands, `addedManagers` and `addedUsers` naming who moved where. */
    commit: types.cloud.GroupTreeCommitStatement;
    expectedKeyVersion: number;
    /** @see GroupAddMembersModel.expectedRosterVersion */
    expectedRosterVersion: number;
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
    /** Optional window, open or closed. The rungs come a page of at most 256 at a time, ascending by `atKeyVersion`
     *  (a full page means there may be more: ask again from the last one's `atKeyVersion`; that epoch's rungs then
     *  come again whole). A database written before the canonical-rung rule may hold more than 256 non-canonical
     *  rungs at one epoch: its page never moves on, so a client stops when a page's last `atKeyVersion` is not past
     *  the one it asked from, and takes what it was served. `keyHistory` is a page of at most 256 epochs from
     *  `fromKeyVersion`, paged by epoch and not aligned with the rung pages: read it on by its own last epoch. */
    fromKeyVersion?: number;
    toKeyVersion?: number;
    /**
     * Instead of a window: only the rungs of these spans (every stored candidate of each, repairs included), and
     * `keyHistory` only for the past epochs they join. At most 128 spans; exclusive with the window. A client
     * descending to one epoch asks for its descent path, O(log distance) spans, not every rung in between.
     */
    spans?: GroupArchiveSpan[];
}

/** One span of the Epoch Ladder: the rungs sealing epoch `target`'s grant key to epoch `at`'s. */
export interface GroupArchiveSpan {
    at: number;
    target: number;
}

/**
 * Looks up past epochs by what an envelope names: a member envelope its `keyId`, an anonymous one its grant key.
 * `groupGet` serves only the current epoch and the ones the metadata heads sit at, so this is how an envelope sealed
 * under any other epoch is opened. At most 32 of each; ids the group never had are left out of the answer.
 */
export interface GroupGetEpochKeysModel {
    id: types.group.GroupId;
    keyIds?: types.core.KeyId[];
    groupPubKeys?: types.cloud.GroupPubKey[];
}

/**
 * The epochs found, in the shapes `groupGet` serves them: `groupKeys` the self-addressed key entries of those
 * epochs, `keyHistory` their grant public keys. Unlike `groupGet`'s `keyHistory` it also lists the current epoch
 * when asked for.
 */
export interface GroupGetEpochKeysResult {
    keyVersion: number;
    groupKeys: types.cloud.GroupKeysEntry[];
    keyHistory: types.cloud.GroupPubKeyAtEpoch[];
}

export interface GroupGetKeyArchiveResult {
    keyVersion: number;
    eraFloor: number;
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
 * Sets the group's rules (`types.cloud.GroupRules`), as a signed commit (op `policy`) under the `changeRules` rule: the
 * rules are part of the signed group state, so a change is chained, CAS-ed and checked like any other commit.
 *
 * Neither metadata plane moves and no epoch advances; the tree and roster stay as they are.
 */
export interface GroupUpdatePolicyModel {
    id: types.group.GroupId;
    /** The policy commit statement: `op: "policy"`, everything but `policyHash` unchanged, and the new rules in
     *  `commit.policy`, all nine. */
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

/**
 * Who may read a group's identity key, roster and statements beside its members. "context" exposes the whole signed
 * membership history (past members, removals, their dates) through `groupGetTreeCommits`; narrowing it later does
 * not retract what was already read.
 */
export type GroupVisibility = "members"|"context";

export interface GroupGetManyModel {
    /** Up to 128 groups, each read as `groupGet` reads it in the "path" scope. */
    groupIds: types.group.GroupId[];
}

/**
 * One result per requested id, in order. A group that cannot be served has its error here and fails nothing else.
 * Past a 32 MiB response the remaining ids are not read and are answered `GROUP_BATCH_SIZE_EXCEEDED`: read those
 * one by one (`groupGet`). The first group is always served.
 */
export type GroupGetManyEntry = {group: GroupInfo}|{error: {code: types.core.ErrorCode, message: types.core.ErrorMessage}};

export interface GroupGetManyResult {
    results: GroupGetManyEntry[];
}

export interface GroupGetPublicKeyModel {
    groupId: types.group.GroupId;
}

/**
 * What somebody outside a group needs to seal to it: the current identity key, and the latest statement with the
 * roster it describes, which is what vouches for that key. No tree, no metadata, no keys.
 */
export interface GroupPublicInfo {
    id: types.group.GroupId;
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    creator: types.cloud.UserId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    rosterVersion: number;
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
    /** The group's signed rules (`types.cloud.GroupRules`); absent for a group stored before the rules format. */
    policy?: types.cloud.GroupRules;
    visibleTo: GroupVisibility;
    /** The latest commit statement. Signed; the client checks it. */
    treeCommit: types.cloud.GroupTreeCommitStatement;
}

export interface GroupGetPublicKeyResult {
    group: GroupPublicInfo;
}

export interface GroupSetVisibilityModel {
    groupId: types.group.GroupId;
    visibleTo: GroupVisibility;
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
    visibleTo: GroupVisibility;
    /** The group's signed rules (`types.cloud.GroupRules`); absent for a group stored before the rules format. */
    policy?: types.cloud.GroupRules;
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
    visibleTo: GroupVisibility;
    keyHistory: types.cloud.GroupPubKeyAtEpoch[];
    /** The group's signed rules (`types.cloud.GroupRules`); absent for a group stored before the rules format. */
    policy?: types.cloud.GroupRules;
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
}

/** Which operation changed the group, so a client can decide whether the change is worth a `groupGet`. */
export type GroupChangeKind = "created"|"publicMetaUpdated"|"privateMetaUpdated"|"policyUpdated"|"keyRotated"
    |"memberAdded"|"memberRemoved"|"eraCut"|"visibilityChanged"|"rolesChanged"|"membersReseated";

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

/**
 * A space as one caller sees it. `keys` are only the entries the caller can open: its own and those of the
 * groups it belongs to.
 */
export interface SpaceInfo {
    id: types.space.SpaceId;
    resourceId: types.core.ClientResourceId;
    contextId: types.context.ContextId;
    creator: types.cloud.UserId;
    createDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    /** `groupKeyVersion`: the group's epoch the current key version was wrapped to; `groupPubKey`: the group's key of that epoch. */
    groups: {groupId: types.group.GroupId; role: types.cloud.ContainerRole; groupKeyVersion: number; groupPubKey: types.cloud.GroupPubKey}[];
    users: {userId: types.cloud.UserId; pubKey: types.cloud.UserPubKey; role: types.cloud.ContainerRole}[];
    keyId: types.core.KeyId;
    keyVersion: number;
    /** The seq of `statement`. */
    seq: number;
    /** The last signed statement of the space's history; the earlier ones come from `spaceGetStatements`. */
    statement: types.cloud.SpaceStatement;
    /** True when a recipient group has moved past the epoch the current key was wrapped to. */
    keyIsStale: boolean;
    keys: types.cloud.SpaceKeyEntry[];
    publicMeta: types.space.SpaceData;
    privateMeta: types.space.SpaceData;
    publicMetaVersion: number;
    privateMetaVersion: number;
}

export interface SpaceCreateModel {
    contextId: types.context.ContextId;
    /** The space's id follows from it, as a group's does: a random uuid, or 64 hex digits of a digest. */
    resourceId: types.core.ClientResourceId;
    recipients: types.cloud.SpaceRecipient[];
    keyId: types.core.KeyId;
    /** Key version 1, one entry per recipient. */
    keys: types.cloud.SpaceKeyEntry[];
    /** At most 64 KiB once base64-decoded: a space is a key holder, and a page of `spaceList` carries both planes. */
    publicMeta: types.space.SpaceData;
    /** At most 64 KiB plus 4 KiB for the envelope it is sealed in, once base64-decoded. */
    privateMeta: types.space.SpaceData;
    /** Statement 1, op `create`: signed by the caller, naming the recipients, each group at its current epoch and key. */
    statement: types.cloud.SpaceStatement;
}

export interface SpaceGetStatementsModel {
    id: types.space.SpaceId;
    /** Statements with a higher seq are served; 0 for the whole history. */
    fromSeq: number;
    /** 1 to 100. */
    limit: number;
}

export interface SpaceGetStatementsResult {
    /** Oldest first. */
    statements: types.cloud.SpaceStatement[];
}

export interface SpaceCreateResult {
    spaceId: types.space.SpaceId;
}

export interface SpaceIdModel {
    id: types.space.SpaceId;
}

export interface SpaceGetResult {
    /** `keys` are those of the current key version only; older versions are reached down the rungs of `spaceGetKeyArchive`. */
    space: SpaceInfo;
}

/**
 * Fetches the rungs of a space's key ladder, a page of key versions at a time. A reader unwraps the current key
 * version and descends: from version a it takes a rung (a -> t) to the lowest t still at or above the version it
 * wants, and repeats. Every key so derived is checked against the `keyCommit` of the signed history.
 */
export interface SpaceGetKeyArchiveModel {
    id: types.space.SpaceId;
    /** The lowest `atKeyVersion` wanted, at least 1; default 1. Version 1 has no rungs. */
    fromKeyVersion?: number;
    /** The highest `atKeyVersion` wanted; defaults to, and is capped at, the space's current key version. */
    toKeyVersion?: number;
    /** Key versions per page, 1 to 256; default 256. */
    limit?: number;
}

export interface SpaceGetKeyArchiveResult {
    /** Every rung at the versions of the page, ascending by `atKeyVersion` (then `targetKeyVersion`). */
    rungs: types.cloud.SpaceRung[];
    /** Set when versions up to `toKeyVersion` remain: ask again with it as `fromKeyVersion`. */
    nextKeyVersion?: number;
}

export interface SpaceListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface SpaceListResult {
    /** `keys` of a listed space are those of its current key version only, as in `spaceGet`; older versions are
     *  reached down the rungs of `spaceGetKeyArchive`. */
    spaces: SpaceInfo[];
    count: number;
}

export interface SpaceAddRecipientsModel {
    id: types.space.SpaceId;
    recipients: types.cloud.SpaceRecipient[];
    /** The current key version only, one entry per new recipient: older versions are reached down the rungs. */
    keys: types.cloud.SpaceKeyEntry[];
    /** The next statement, op `add`: the recipients before, unchanged, and the new ones; the key version and `keyCommit` stay. */
    statement: types.cloud.SpaceStatement;
}

export interface SpaceRotateKeyModel {
    id: types.space.SpaceId;
    keyId: types.core.KeyId;
    /** The next key version, one entry per recipient that stays. Once the rotation lands, the wraps of older
     *  versions are deleted: those versions are reached down the rungs. */
    keys: types.cloud.SpaceKeyEntry[];
    /** The rungs of the next key version v: exactly one to each target of `LadderMath.rungSpansFor(v, 1)` — the unit
     *  rung v -> v-1 and the aligned skips v -> v-2^j (v=2: [1]; v=4: [3,2]; v=8: [7,6,4]), each
     *  `AES-256-GCM(K_v, iv, K_t, aad = "pmx-space-rung\0" || lp(spaceId) || u64be(v) || u64be(t))`. Anything else is
     *  refused with `SPACE_KEYS_INVALID`. */
    rungs: types.cloud.SpaceRung[];
    expectedKeyVersion: number;
    /** The next statement, op `rotate` (or `remove`): whoever stays, each group at its current epoch and key, at the new key version. */
    statement: types.cloud.SpaceStatement;
}

export interface SpaceRemoveRecipientsModel extends SpaceRotateKeyModel {
    groups?: types.group.GroupId[];
    users?: types.cloud.UserId[];
}

export interface SpaceRotateKeyResult {
    keyVersion: number;
}

export interface SpaceUpdateMetaModel {
    id: types.space.SpaceId;
    /** Base64-decoded, at most 64 KiB for the public plane and 64 KiB plus a 4 KiB envelope allowance for the
     *  private one. */
    meta: types.space.SpaceData;
    /** The version of that metadata the caller read. */
    version: number;
}

export type SpaceChangeKind = "created"|"recipientsAdded"|"recipientsRemoved"|"keyRotated"|"keyStale"|"metaUpdated";

export interface SpaceChangedEventData {
    spaceId: types.space.SpaceId;
    contextId: types.context.ContextId;
    keyVersion: number;
    publicMetaVersion: number;
    privateMetaVersion: number;
    changeKind: SpaceChangeKind;
}

export interface SpaceDeletedEventData {
    spaceId: types.space.SpaceId;
    contextId: types.context.ContextId;
}

export type SpaceCreatedEvent = types.cloud.Event<"spaceCreated", "context", SpaceChangedEventData>;
export type SpaceUpdatedEvent = types.cloud.Event<"spaceUpdated", "context", SpaceChangedEventData>;
export type SpaceDeletedEvent = types.cloud.Event<"spaceDeleted", "context", SpaceDeletedEventData>;

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
    /**
     * Re-admits members whose long-term key was replaced: a removal in every respect but one, its subjects keep
     * their seats and their place on the roster. The epoch advances, so whoever still holds a subject's old key
     * reads nothing written afterwards. Takes what `groupRemoveMembers` takes; the statement's op is `reseat` and
     * its `removed` names the subjects. Needs the `replaceMemberKeys` rule.
     * @param model group's id, the members to reseat, the new grant key, the transition, the statement and the rungs
     * @returns "OK"
     */
    groupReseat(model: GroupRemoveMembersModel): Promise<types.core.OK>;
    /**
     * Changes the role of members of a group
     * @param model group's id, the members with their new roles, the roster entry and the statement
     * @returns "OK"
     */
    groupSetRoles(model: GroupSetRolesModel): Promise<types.core.OK>;
    groupSelfUpdate(model: GroupSelfUpdateModel): Promise<types.core.OK>;
    groupGetTreeCommits(model: GroupGetTreeCommitsModel): Promise<GroupGetTreeCommitsResult>;
    /**
     * Reads several groups in one request, for a client opening a list of them.
     * @param model ids of the groups
     * @returns one result per id, in order
     */
    groupGetMany(model: GroupGetManyModel): Promise<GroupGetManyResult>;
    /**
     * A group's current identity key with the statement that vouches for it. For a member, and for any user of the
     * context when the group is visible to the context.
     * @param model id of the group
     * @returns the key, the roster and the latest statement
     */
    groupGetPublicKey(model: GroupGetPublicKeyModel): Promise<GroupGetPublicKeyResult>;
    /**
     * Sets who may read the group's identity key, roster and statements beside its members. Needs the group's
     * `changeVisibility` rule (default: managers), narrowed by the context's `policy.group.updatePolicy`, and the
     * `context/groupSetVisibility` ACL entry. Refused with `ROTATED_ALREADY` when a commit landed since the rules were
     * read.
     * Making a group visible to the context exposes its whole signed membership history (past members, removals,
     * their dates) through `groupGetTreeCommits`; narrowing it later does not retract what was already read.
     * @param model id of the group and the new visibility
     * @returns "OK"
     */
    groupSetVisibility(model: GroupSetVisibilityModel): Promise<types.core.OK>;
    groupRepairRung(model: GroupRepairRungModel): Promise<types.core.OK>;
    groupGetKeyArchive(model: GroupGetKeyArchiveModel): Promise<GroupGetKeyArchiveResult>;
    groupGetEpochKeys(model: GroupGetEpochKeysModel): Promise<GroupGetEpochKeysResult>;
    groupSendCustomEvent(model: GroupSendCustomEventModel): Promise<types.core.OK>;
    /**
     * Creates a space: one key wrapped for several groups and users. The caller has to be one of its managers.
     * @param model context, resource id, recipients, the key's id and its wraps, metadata
     * @returns the space's id
     */
    spaceCreate(model: SpaceCreateModel): Promise<SpaceCreateResult>;
    /**
     * Reads a space. For a recipient: a user it names, or a member of a group it names.
     * @param model id of the space
     * @returns the space with the wrapped keys of its current version the caller can open
     */
    spaceGet(model: SpaceIdModel): Promise<SpaceGetResult>;
    /**
     * Reads a page of the rungs of a space's key ladder, by the key version they sit at. For a recipient, as
     * `spaceGet`; needs the `context/spaceGetKeyArchive` ACL entry (in `context/READ`).
     * @param model id of the space, the key versions wanted and how many per page
     * @returns the rungs, ascending by key version, and where to continue
     */
    spaceGetKeyArchive(model: SpaceGetKeyArchiveModel): Promise<SpaceGetKeyArchiveResult>;
    /**
     * Reads the signed statements of a space's history, oldest first. For a recipient, as `spaceGet`.
     * @param model id of the space, the seq to read after, and how many
     * @returns the statements with a seq above `fromSeq`
     */
    spaceGetStatements(model: SpaceGetStatementsModel): Promise<SpaceGetStatementsResult>;
    /**
     * Lists the spaces of a context the caller is a recipient of.
     * @param model context and paging
     * @returns the spaces, each with the wraps of its current key the caller can open
     */
    spaceList(model: SpaceListModel): Promise<SpaceListResult>;
    /**
     * Deletes a space. Managers only.
     * @param model id of the space
     * @returns "OK"
     */
    spaceDelete(model: SpaceIdModel): Promise<types.core.OK>;
    /**
     * Adds recipients, with the current version of the key wrapped for each. Managers only.
     * @param model id of the space, the new recipients and their wraps
     * @returns "OK"
     */
    spaceAddRecipients(model: SpaceAddRecipientsModel): Promise<types.core.OK>;
    /**
     * Removes recipients and moves the space to a new key they do not get. Managers only. Rate-limited with the
     * limits of `spaceRotateKey` but in a budget of its own, so rotations (a writer re-keying a stale space) never use
     * up a manager's allowance to remove.
     * @param model id of the space, who leaves, the new key's id and its wraps for those who stay
     * @returns the new key version
     */
    spaceRemoveRecipients(model: SpaceRemoveRecipientsModel): Promise<SpaceRotateKeyResult>;
    /**
     * Moves the space to a new key. Any recipient may; it is what clears `keyIsStale`. Each user may rotate one space
     * `PMX_MAX_SPACE_ROTATIONS_PER_MINUTE` times a minute (default 3) and `PMX_MAX_SPACE_ROTATIONS_PER_HOUR` times an
     * hour (default 60); past either it is refused with `SPACE_ROTATION_RATE_LIMIT`, data `{retryAt}`. A rotation that
     * only replaces a stale key (`keyIsStale`: a recipient group past the epoch the key was wrapped to) is not counted
     * against the hourly limit, only against a per-minute limit of its own (same value).
     * @param model id of the space, the new key's id and its wraps
     * @returns the new key version
     */
    spaceRotateKey(model: SpaceRotateKeyModel): Promise<SpaceRotateKeyResult>;
    /**
     * Replaces the public metadata. Managers only.
     * @param model id of the space, the metadata and the version it replaces
     * @returns "OK"
     */
    spaceUpdatePublicMeta(model: SpaceUpdateMetaModel): Promise<types.core.OK>;
    /**
     * Replaces the private metadata. Managers only.
     * @param model id of the space, the metadata and the version it replaces
     * @returns "OK"
     */
    spaceUpdatePrivateMeta(model: SpaceUpdateMetaModel): Promise<types.core.OK>;
}
