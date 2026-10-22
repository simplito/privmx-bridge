/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as mongodb from "mongodb";
import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import { MongoQueryConverter } from "../../db/mongo/MongoQueryConverter";
import * as types from "../../types";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";
import { Utils } from "../../utils/Utils";
import { AppException } from "../../api/AppException";
import { DbDuplicateError } from "../../error/DbDuplicateError";
import { GroupStateRepository } from "./GroupStateRepository";
import type { TreeCommit } from "./keytree/TreeTransitionValidator";
import { TreeMath } from "./keytree/TreeMath";
import { CommitStatement } from "./keytree/CommitStatement";

export class GroupRepository {
    
    static readonly COLLECTION_NAME = "group";
    static readonly COLLECTION_ID_PROP = "id";
    
    /** Mirrors `db.group.GroupSummaryFields`; `_id` comes along by default and is mapped back to `id`. */
    private static readonly SUMMARY_PROJECTION: {[K in Exclude<keyof db.group.GroupSummaryFields, "id">]: 1} = {
        clientResourceId: 1,
        contextId: 1,
        type: 1,
        groupPubKey: 1,
        createDate: 1,
        creator: 1,
        lastModificationDate: 1,
        lastModifier: 1,
        publicMetaVersion: 1,
        privateMetaVersion: 1,
        rosterVersion: 1,
        keyVersion: 1,
        policy: 1,
    };
    
    /** Mirrors `db.group.GroupEpochFields`; see there for why this read is kept this narrow. */
    private static readonly EPOCH_PROJECTION: {[K in Exclude<keyof db.group.GroupEpochFields, "id">]: 1} = {
        contextId: 1,
        keyVersion: 1,
    };
    
    /** Mirrors `db.group.GroupGranteeFields`; see there for why this read is kept this narrow. */
    private static readonly GRANTEE_PROJECTION: {[K in Exclude<keyof db.group.GroupGranteeFields, "id">]: 1} = {
        users: 1,
        managers: 1,
        keyVersion: 1,
    };
    
    constructor(
        private repository: MongoObjectRepository<types.group.GroupId, db.group.Group>,
        /** The group's out-of-document state, in the same session. */
        readonly state: GroupStateRepository,
    ) {
    }
    
    async get(id: types.group.GroupId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.group.GroupId[]) {
        return this.repository.getMulti(ids);
    }
    
    /**
     * A page of groups with only the fields a listing serves, optionally filtered by `listParams.query`.
     *
     * Stage order matters: `contextId` matches first so no query can reach another context, and the query runs
     * before the projection so a field left out of the summary stays filterable.
     */
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.group.Group, onlyForUser?: types.cloud.UserId) {
        const mongoQueries = listParams.query ? [MongoQueryConverter.convertQuery(listParams.query)] : [];
        // `onlyForUser` narrows to the caller's own groups, served off the `{contextId, users}` /
        // `{contextId, managers}` indexes from Migration071. In the same `$match` as `contextId`, so no query
        // from `listParams` can widen it back.
        const match = onlyForUser === undefined
            ? {contextId: contextId}
            : {contextId: contextId, $or: [{users: onlyForUser}, {managers: onlyForUser}]};
        return this.repository.getMatchingPage<db.group.GroupSummaryFields>(
            [{$match: match}, ...mongoQueries, {$project: GroupRepository.SUMMARY_PROJECTION}],
            listParams,
            sortBy,
        );
    }
    
    /** Ids of the groups in the given context the user belongs to (member or manager) — used by Phase 2 grantee
     *  resolution on every container call, so projected to the id: the whole documents carry every roster. */
    async getGroupsOfUser(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        return this.repository.query(q => q.and(q.eq("contextId", contextId), q.or(q.includes("users", userId), q.includes("managers", userId)))).props("id").array();
    }
    
    /**
     * Everything a fan-out over a container's group grantees needs, out of one lookup:
     *
     * - `groupsByUser` — which of the given groups each member belongs to. Keys are the distinct member
     *   userIds, so they double as the recipient list; each value narrows that recipient's `groupKeys`.
     * - `groupEpochs` — each group's current epoch, for the `staleGroups` a `*Get` would serve.
     *
     * Wider than `getKeyVersions`, but still projected: expanding grantees needs the membership lists, and those
     * are all it needs. `leafAssignment` is an entry per seat — not readable from the result, and dragged along by
     * a whole-document read on the path that runs per item write.
     */
    async getGranteeView(groupIds: types.group.GroupId[]): Promise<{groupsByUser: Map<types.cloud.UserId, types.group.GroupId[]>, groupEpochs: Map<types.group.GroupId, number>}> {
        const groupsByUser = new Map<types.cloud.UserId, types.group.GroupId[]>();
        const groupEpochs = new Map<types.group.GroupId, number>();
        if (groupIds.length === 0) {
            return {groupsByUser, groupEpochs};
        }
        const groups = await this.repository.getMultiProjected<db.group.GroupGranteeFields>(groupIds, GroupRepository.GRANTEE_PROJECTION);
        for (const group of groups) {
            groupEpochs.set(group.id, group.keyVersion);
            // A Set over the group's own roster: a user listed as both member and manager must not get it twice.
            for (const member of new Set([...group.users, ...group.managers])) {
                groupsByUser.set(member, [...(groupsByUser.get(member) ?? []), group.id]);
            }
        }
        return {groupsByUser, groupEpochs};
    }
    
    /**
     * Verifies that all given groups exist in the given context (mirrors CloudKeyService.checkUsersExistance).
     *
     * Reuses the epoch projection rather than declaring one for `contextId` alone: an existence check reads an id
     * and a context, and one spare int is cheaper than a fourth projection to keep in step with the document.
     */
    async checkGroupsExistence(contextId: types.context.ContextId, groupIds: types.group.GroupId[]) {
        if (groupIds.length === 0) {
            return;
        }
        const groups = await this.repository.getMultiProjected<db.group.GroupEpochFields>(Utils.unique(groupIds), GroupRepository.EPOCH_PROJECTION);
        const existing = new Set(groups.filter(g => g.contextId === contextId).map(g => g.id));
        for (const id of groupIds) {
            if (!existing.has(id)) {
                throw new AppException("GROUP_DOES_NOT_EXIST", `group '${id}' does not exist in context`);
            }
        }
    }
    
    async deleteOneByOneByContext(contextId: types.context.ContextId, func: (group: db.group.Group) => Promise<void>) {
        while (true) {
            const groups = await this.repository.query(q => q.eq("contextId", contextId)).limit(100).array();
            if (groups.length === 0) {
                return;
            }
            for (const group of groups) {
                await this.deleteGroup(group);
                await func(group);
            }
        }
    }
    
    /**
     * Serialises a repair on the group document: bumps `ladderRev` only while the floors are still those `oldGroup`
     * was read with. Every floor change and every commit writes the same document, so inside a transaction a
     * concurrent one is a write conflict and the repair is re-run against the state that won. The epoch is
     * deliberately not in the filter: a new epoch does not invalidate a repair at an older one.
     *
     * @returns false when the floors moved (nothing written)
     */
    async touchLadder(oldGroup: db.group.Group): Promise<boolean> {
        const filter = {
            _id: oldGroup.id,
            eraFloor: oldGroup.eraFloor,
            archivePrunedBelow: oldGroup.archivePrunedBelow ?? {$exists: false},
        };
        const result = await this.repository.collection.updateOne(filter, {$inc: {ladderRev: 1}}, this.repository.getOptions());
        return result.matchedCount > 0;
    }
    
    /** At most this many reads of a group's state while commits keep landing under it (`getFullState`). */
    static readonly FULL_STATE_ATTEMPTS = 3;
    
    /**
     * Tree, roster history, both metadata heads and the latest commit statement — what a read path needs to serve
     * a whole group — together with the group document they belong to.
     *
     * The reads are not one snapshot, so a commit landing in between could pair its new nodes with the document
     * and statement before it — a state no statement describes, which an honest bridge must never serve. A commit
     * moves `treeCommitSeq` in the same transaction as the nodes, so the document is read again afterwards: if its
     * seq has not moved, nothing read in between can be newer than it; if it has, the whole read starts over from
     * the newer document.
     */
    async getFullState(group: db.group.Group, fromRosterVersion?: number): Promise<{group: db.group.Group, state: db.group.GroupState}> {
        for (let attempt = 1; ; attempt++) {
            const state = await this.readFullState(group, fromRosterVersion);
            const current = await this.repository.get(group.id);
            if (!current) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            if (current.treeCommitSeq === group.treeCommitSeq) {
                return {group, state};
            }
            if (attempt === GroupRepository.FULL_STATE_ATTEMPTS) {
                throw new AppException("INTERNAL_ERROR", `group '${group.id}' kept changing while it was read; try again`);
            }
            group = current;
        }
    }
    
    private async readFullState(group: db.group.Group, fromRosterVersion?: number): Promise<db.group.GroupState> {
        const [tree, history, publicMeta, privateMeta, [treeCommit], epochKeys] = await Promise.all([
            this.state.getTree(group),
            this.state.getHistory(group.id, fromRosterVersion),
            this.state.getPublicMetaHead(group.id),
            this.state.getPrivateMetaHead(group.id),
            group.treeCommitSeq === undefined ? Promise.resolve([]) : this.state.getTreeCommitsAt(group.id, [group.treeCommitSeq]),
            this.state.getEpochKeys(group.id),
        ]);
        // An invariant, not a client error: `createGroup` writes the document and both entries in one
        // transaction, so only a group left over from an older build of this branch can be missing either.
        // Reported the same way as the missing roster counter below — nothing the caller sends changes the
        // answer, and the group has to be recreated. Deliberately not `GROUP_META_UNREACHABLE`: that one means
        // an entry exists but sits below the requested epoch floor, which a metadata rewrite lifts. A missing
        // entry lifts for nothing. This is also what keeps both `GroupState` planes non-nullable, so the
        // converter never has to think about it.
        if (!publicMeta) {
            throw new AppException("INTERNAL_ERROR", `group '${group.id}' has no public metadata entry; it predates the metadata planes and must be recreated`);
        }
        if (!privateMeta) {
            throw new AppException("INTERNAL_ERROR", `group '${group.id}' has no private metadata entry; it predates the metadata planes and must be recreated`);
        }
        return {tree, history, publicMeta, privateMeta, treeCommit: treeCommit ?? null, epochKeys};
    }
    
    // ── writes ───────────────────────────────────────────────────────────────────────────────────────────────
    
    async createGroup(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId, type: types.group.GroupType|undefined,
        groupPubKey: types.cloud.GroupPubKey, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.group.GroupData, publicMeta: types.group.GroupData, privateMeta: types.group.GroupData,
        keyId: types.core.KeyId, policy: types.cloud.ContainerPolicy,
        tree: types.cloud.GroupTreeState, statement: types.cloud.GroupTreeCommitStatement, groupKey?: types.cloud.GroupKeyEntry) {
        const now = DateUtils.now();
        const firstVersion = 1 as types.group.GroupVersion;
        // Derived, not generated: the genesis statement signs only the resourceId, and clients check the id against it.
        const id = CommitStatement.groupId(contextId, resourceId);
        const group: db.group.Group = {
            id: id,
            contextId: contextId,
            clientResourceId: resourceId,
            type: type,
            groupPubKey: groupPubKey,
            creator: creator,
            createDate: now,
            lastModifier: creator,
            lastModificationDate: now,
            keyId: keyId,
            users: users,
            managers: managers,
            publicMetaVersion: firstVersion,
            privateMetaVersion: firstVersion,
            rosterVersion: firstVersion,
            policy: policy,
            // A group starts at epoch 1 with an era floor of 1: there is no earlier epoch to descend to, and the
            // floor is what every later rung is measured against.
            treeVersion: TreeMath.TREE_VERSION,
            treeCommitSeq: statement.seq,
            numLeaves: tree.numLeaves,
            leafAssignment: tree.leafAssignment,
            keyVersion: 1,
            eraFloor: 1,
        };
        // A deleted group's id stays taken: a new group under it would pass for the old one.
        if (await this.state.wasDeleted(id)) {
            throw new DbDuplicateError();
        }
        // The document first: a duplicate resourceId is the one failure that is its own, and failing before any
        // state is written keeps that case clean.
        await this.repository.insert(group);
        // All three planes seeded at 1, under the same epoch-1 key. From here they move independently.
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(group.id, firstVersion),
            groupId: group.id,
            version: firstVersion,
            keyId: keyId,
            keyVersion: 1,
            data: data,
            groupPubKey: groupPubKey,
            created: now,
            author: creator,
        });
        await this.state.writePublicMetaEntry({
            id: GroupStateRepository.publicMetaEntryId(group.id),
            groupId: group.id,
            version: firstVersion,
            keyId: keyId,
            keyVersion: 1,
            data: publicMeta,
            created: now,
            author: creator,
        });
        await this.state.writePrivateMetaEntry({
            id: GroupStateRepository.privateMetaEntryId(group.id),
            groupId: group.id,
            version: firstVersion,
            keyId: keyId,
            keyVersion: 1,
            data: privateMeta,
            created: now,
            author: creator,
        });
        await this.state.writeTree(group.id, tree, statement, {users, managers});
        // The client cannot name the group it is creating, so the entry is filed against the id derived here.
        // Nothing inside the ciphertext depends on it — it binds contextId and resourceId.
        await this.state.writeEpochKey(id, 1, groupPubKey, groupKey);
        return group;
    }
    
    /**
     * Removes one or more members: blank their leaves and paths, re-key the remover's path, advance the epoch
     * once, append the rungs. All under one compare-and-swap on `keyVersion`, so two managers removing
     * concurrently cannot interleave — and a batch cannot half-land the way the same removals done one call at a
     * time can.
     *
     * @returns the updated group, or `null` on a lost CAS race
     */
    async removeMembersWithTransition(params: {
        oldGroup: db.group.Group,
        commit: TreeCommit,
        statement: types.cloud.GroupTreeCommitStatement,
        modifier: types.cloud.UserId,
        removedUsers: types.cloud.UserId[],
        newGroupPubKey: types.cloud.GroupPubKey,
        keyId: types.core.KeyId,
        data: types.group.GroupData,
        rungs: types.cloud.GroupArchiveRungSubmission[],
        groupKey?: types.cloud.GroupKeyEntry,
        /** Close the era at the new epoch in the same write, as `cutEra` would. */
        abandonHistory?: boolean,
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, removedUsers, commit} = params;
        const now = DateUtils.now();
        const leaving = new Set(removedUsers);
        const users = oldGroup.users.filter(u => !leaving.has(u));
        const managers = oldGroup.managers.filter(u => !leaving.has(u));
        const expectedKeyVersion = oldGroup.keyVersion;
        // Roster plane only. `version` is the metadata counter and a removal does not touch metadata.
        const version = this.nextVersionOf(oldGroup, "rosterVersion");
        const changes: Partial<db.group.Group> = {
            groupPubKey: params.newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            users: users,
            managers: managers,
            rosterVersion: version,
            keyVersion: expectedKeyVersion + 1,
            leafAssignment: commit.leafAssignment,
            treeCommitSeq: params.statement.seq,
            ...(params.abandonHistory ? {eraFloor: expectedKeyVersion + 1} : {}),
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes, oldGroup.rosterVersion, oldGroup.treeCommitSeq)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: params.keyId,
            keyVersion: expectedKeyVersion + 1,
            data: params.data,
            groupPubKey: params.newGroupPubKey,
            created: now,
            author: modifier,
        });
        await this.state.applyCommit(oldGroup.id, oldGroup, commit, params.statement);
        await this.state.insertRungs(oldGroup.id, modifier, params.rungs);
        await this.state.writeEpochKey(oldGroup.id, expectedKeyVersion + 1, params.newGroupPubKey, params.groupKey);
        if (params.abandonHistory) {
            await this.state.deleteRungsTargetingBelow(oldGroup.id, expectedKeyVersion + 1);
            await this.state.deleteEpochKeysBelow(oldGroup.id, expectedKeyVersion + 1);
        }
        return {...oldGroup, ...changes};
    }
    
    /**
     * Seats one or more members **without advancing the epoch**, so every container the group can read stays
     * valid.
     *
     * Still a CAS on the unchanged epoch, so an addition racing a removal loses: it was computed against a tree
     * the removal has already replaced.
     *
     * @returns the updated group, or `null` on a lost CAS race
     */
    async addMembersWithTransition(params: {
        oldGroup: db.group.Group,
        commit: TreeCommit,
        statement: types.cloud.GroupTreeCommitStatement,
        modifier: types.cloud.UserId,
        newUsers: types.cloud.UserId[],
        newManagers: types.cloud.UserId[],
        keyId: types.core.KeyId,
        data: types.group.GroupData,
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, commit} = params;
        const now = DateUtils.now();
        const users = Utils.unique([...oldGroup.users, ...params.newUsers]);
        const managers = Utils.unique([...oldGroup.managers, ...params.newManagers]);
        const expectedKeyVersion = oldGroup.keyVersion;
        // Roster plane only — seating a member is not a metadata edit.
        const version = this.nextVersionOf(oldGroup, "rosterVersion");
        const changes: Partial<db.group.Group> = {
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            users: users,
            managers: managers,
            rosterVersion: version,
            numLeaves: commit.numLeaves,
            leafAssignment: commit.leafAssignment,
            treeCommitSeq: params.statement.seq,
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes, oldGroup.rosterVersion, oldGroup.treeCommitSeq)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: params.keyId,
            keyVersion: expectedKeyVersion,
            data: params.data,
            groupPubKey: oldGroup.groupPubKey,
            created: now,
            author: modifier,
        });
        await this.state.applyCommit(oldGroup.id, oldGroup, commit, params.statement);
        return {...oldGroup, ...changes};
    }
    
    /**
     * Re-keys the caller's own path and nothing else: no epoch, no roster version, no history entry — only the
     * statement sequence moves. The CAS is on all three counters: the commit was checked against this seating,
     * this epoch and this statement chain, and must not land on another.
     *
     * @returns `false` on a lost CAS race
     */
    async selfUpdateWithTransition(oldGroup: db.group.Group, commit: TreeCommit, statement: types.cloud.GroupTreeCommitStatement): Promise<boolean> {
        const changes: Partial<db.group.Group> = {treeCommitSeq: statement.seq};
        if (!await this.casRotate(oldGroup, oldGroup.keyVersion, changes, oldGroup.rosterVersion, oldGroup.treeCommitSeq)) {
            return false;
        }
        await this.state.applyCommit(oldGroup.id, oldGroup, commit, statement);
        return true;
    }
    
    /**
     * Closes the current era at `newFloor`: the rungs pointing below it go, and so do the epoch rows below it —
     * nothing can verify or open them once nobody can climb there.
     *
     * `pruneArchive` deliberately does **not** drop those: a member still holding an old epoch key locally has
     * to keep being able to verify it. Cutting an era is what says those epochs are gone for good.
     */
    async cutEra(oldGroup: db.group.Group, newFloor: number): Promise<db.group.Group|null> {
        const expectedKeyVersion = oldGroup.keyVersion;
        const changes: Partial<db.group.Group> = {
            eraFloor: newFloor,
            lastModificationDate: DateUtils.now(),
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.deleteRungsTargetingBelow(oldGroup.id, newFloor);
        await this.state.deleteEpochKeysBelow(oldGroup.id, newFloor);
        return {...oldGroup, ...changes};
    }
    
    /** Deletes rungs below `belowEpoch` and records the watermark, so a client that cannot descend is told the
     *  archive was pruned rather than left suspecting tampering. */
    async pruneArchive(oldGroup: db.group.Group, belowEpoch: number): Promise<db.group.Group|null> {
        const expectedKeyVersion = oldGroup.keyVersion;
        const changes: Partial<db.group.Group> = {
            archivePrunedBelow: Math.max(oldGroup.archivePrunedBelow ?? 0, belowEpoch),
            lastModificationDate: DateUtils.now(),
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.deleteRungsTargetingBelow(oldGroup.id, belowEpoch);
        return {...oldGroup, ...changes};
    }
    
    /**
     * The public metadata plane only: the private plane, the roster, the tree, the epoch, the group's `keyId`
     * and the policy are all untouched.
     *
     * A real CAS on `publicMetaVersion` rather than a read-then-write inside the transaction: the entry commits
     * the version it lands at, so a write that landed at a different one would be unreadable forever. The
     * filter names its own counter and only its own, which is what lets a concurrent private-metadata write
     * land as well. Returns `null` when another public-metadata write won the race, which the caller reports as
     * `GROUP_VERSION_MISMATCH`.
     */
    async updatePublicMeta(oldGroup: db.group.Group, modifier: types.cloud.UserId, data: types.group.GroupData,
        keyId: types.core.KeyId, resourceId: types.core.ClientResourceId|null): Promise<db.group.Group|null> {
        const now = DateUtils.now();
        const version = this.nextVersionOf(oldGroup, "publicMetaVersion");
        const changes: Partial<db.group.Group> = {
            lastModifier: modifier,
            lastModificationDate: now,
            publicMetaVersion: version,
        };
        if (resourceId && !oldGroup.clientResourceId) {
            changes.clientResourceId = resourceId;
        }
        const result = await this.updateOneWrappingDuplicates(
            {_id: oldGroup.id, publicMetaVersion: oldGroup.publicMetaVersion},
            changes,
        );
        if (result.matchedCount === 0) {
            return null;
        }
        await this.state.writePublicMetaEntry({
            id: GroupStateRepository.publicMetaEntryId(oldGroup.id),
            groupId: oldGroup.id,
            version: version,
            keyId: keyId,
            // Always the current epoch: the caller has already refused a write under any other key.
            keyVersion: oldGroup.keyVersion,
            data: data,
            created: now,
            author: modifier,
        });
        return {...oldGroup, ...changes};
    }
    
    /** The private metadata plane's mirror, CAS-guarded on `privateMetaVersion` and nothing else. */
    async updatePrivateMeta(oldGroup: db.group.Group, modifier: types.cloud.UserId, data: types.group.GroupData,
        keyId: types.core.KeyId, resourceId: types.core.ClientResourceId|null): Promise<db.group.Group|null> {
        const now = DateUtils.now();
        const version = this.nextVersionOf(oldGroup, "privateMetaVersion");
        const changes: Partial<db.group.Group> = {
            lastModifier: modifier,
            lastModificationDate: now,
            privateMetaVersion: version,
        };
        if (resourceId && !oldGroup.clientResourceId) {
            changes.clientResourceId = resourceId;
        }
        const result = await this.updateOneWrappingDuplicates(
            {_id: oldGroup.id, privateMetaVersion: oldGroup.privateMetaVersion},
            changes,
        );
        if (result.matchedCount === 0) {
            return null;
        }
        await this.state.writePrivateMetaEntry({
            id: GroupStateRepository.privateMetaEntryId(oldGroup.id),
            groupId: oldGroup.id,
            version: version,
            keyId: keyId,
            keyVersion: oldGroup.keyVersion,
            data: data,
            created: now,
            author: modifier,
        });
        return {...oldGroup, ...changes};
    }
    
    /**
     * A policy commit: the new policy and its statement, under the same CAS on epoch, roster version and
     * `treeCommitSeq` as every other commit, so it lands only on the state its statement extends (T4-10).
     *
     * It moves neither metadata counter and appends no entry in either plane: moving a counter a client's envelope
     * pins without writing the entry that commits it would leave the group unreadable. The policy's history is the
     * statements themselves (create and policy ops carry it).
     *
     * @returns null on a CAS miss, in which case nothing has been written
     */
    async updatePolicyWithStatement(oldGroup: db.group.Group, modifier: types.cloud.UserId,
        policy: types.cloud.ContainerPolicy, statement: types.cloud.GroupTreeCommitStatement): Promise<db.group.Group|null> {
        const changes: Partial<db.group.Group> = {
            policy: policy,
            treeCommitSeq: statement.seq,
            lastModifier: modifier,
            lastModificationDate: DateUtils.now(),
        };
        if (!await this.casRotate(oldGroup, oldGroup.keyVersion, changes, oldGroup.rosterVersion, oldGroup.treeCommitSeq)) {
            return null;
        }
        await this.state.insertTreeCommit(oldGroup.id, statement);
        return {...oldGroup, ...changes};
    }
    
    private async updateOneWrappingDuplicates(filter: mongodb.Filter<any>, changes: Partial<db.group.Group>) {
        try {
            return await this.repository.collection.updateOne(
                filter,
                {$set: this.toDbChanges(changes)},
                this.repository.getOptions(),
            );
        }
        catch (err) {
            if (this.repository.isMongoDuplicateError(err)) {
                throw new DbDuplicateError();
            }
            throw err;
        }
    }
    
    async deleteGroup(group: Pick<db.group.Group, "id"|"contextId">) {
        await this.repository.delete(group.id);
        await this.state.deleteState(group.id);
        await this.state.markDeleted(group.id, group.contextId);
    }
    
    /**
     * Current epoch of each of the given groups, keyed by id; groups outside `contextId` or missing are absent.
     *
     * Projected, because this runs on every container read and every item write into a group-granted container.
     * Reading whole documents would drag the rosters and `leafAssignment` along to answer one comparison.
     */
    async getKeyVersions(contextId: types.context.ContextId, groupIds: types.group.GroupId[]): Promise<Map<types.group.GroupId, number>> {
        if (groupIds.length === 0) {
            return new Map();
        }
        const groups = await this.repository.getMultiProjected<db.group.GroupEpochFields>(Utils.unique(groupIds), GroupRepository.EPOCH_PROJECTION);
        const map = new Map<types.group.GroupId, number>();
        for (const g of groups) {
            if (g.contextId === contextId) {
                map.set(g.id, g.keyVersion);
            }
        }
        return map;
    }
    
    /**
     * Applies a transition to the group document only if the counters it was planned against still match.
     *
     * Atomicity comes from the session (`GroupService` runs every transition in one), not from this. What the
     * CAS does is refuse a caller working from a superseded state, and serialise two transitions racing on it
     * so the loser retries against the winner instead of half-landing beside it.
     *
     * `expectedRosterVersion` is what the writers of a roster entry pass, and it is not redundant with the
     * epoch: an addition moves `rosterVersion` without moving `keyVersion`, so two concurrent additions both
     * match on the epoch alone. Without it, a transaction retried on a write conflict would recompute the roster
     * version server-side and land the entry at a version the caller's statement never signed — unverifiable
     * forever. A cut or a prune writes no entry and passes nothing.
     *
     * `expectedTreeCommitSeq` is what every tree commit passes: its statement is signed as the next seq, and
     * landing it on a chain that has moved on would leave two statements claiming one number.
     *
     * A `$set` of what changed, not a whole-document replace.
     *
     * @returns false on a CAS miss, in which case nothing has been written
     */
    async casRotate(oldGroup: db.group.Group, expectedKeyVersion: number, changes: Partial<db.group.Group>,
        expectedRosterVersion?: number, expectedTreeCommitSeq?: number): Promise<boolean> {
        const filter = {
            _id: oldGroup.id,
            keyVersion: expectedKeyVersion,
            ...(expectedRosterVersion === undefined ? {} : {rosterVersion: expectedRosterVersion}),
            // The statement chain: a commit signed as seq `k + 1` lands only on the state that `k` describes.
            ...(expectedTreeCommitSeq === undefined ? {} : {treeCommitSeq: expectedTreeCommitSeq}),
        };
        const result = await this.repository.collection.updateOne(filter, {$set: this.toDbChanges(changes)}, this.repository.getOptions());
        return result.matchedCount > 0;
    }
    
    /** Rotates the grant keypair, leaving the roster and every node key where they are. One edge written,
     *  whatever the group's size; the rungs keep the epochs below reachable. */
    async generateNewGroupKey(params: {
        oldGroup: db.group.Group,
        modifier: types.cloud.UserId,
        newGroupPubKey: types.cloud.GroupPubKey,
        data: types.group.GroupData,
        keyId: types.core.KeyId,
        grantEdge: types.cloud.GroupTreeEdge,
        statement: types.cloud.GroupTreeCommitStatement,
        rungs: types.cloud.GroupArchiveRungSubmission[],
        groupKey?: types.cloud.GroupKeyEntry,
    }): Promise<db.group.Group | null> {
        const {oldGroup, modifier} = params;
        const now = DateUtils.now();
        const expectedKeyVersion = oldGroup.keyVersion;
        // Roster plane: a rotation republishes the roster entry under the new epoch, but writes no metadata.
        const version = this.nextVersionOf(oldGroup, "rosterVersion");
        const changes: Partial<db.group.Group> = {
            groupPubKey: params.newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            rosterVersion: version,
            keyVersion: expectedKeyVersion + 1,
            treeCommitSeq: params.statement.seq,
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes, oldGroup.rosterVersion, oldGroup.treeCommitSeq)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: params.keyId,
            keyVersion: expectedKeyVersion + 1,
            data: params.data,
            groupPubKey: params.newGroupPubKey,
            created: now,
            author: modifier,
        });
        await this.state.replaceGrantEdge(oldGroup.id, params.grantEdge);
        await this.state.insertTreeCommit(oldGroup.id, params.statement);
        await this.state.insertRungs(oldGroup.id, modifier, params.rungs);
        await this.state.writeEpochKey(oldGroup.id, expectedKeyVersion + 1, params.newGroupPubKey, params.groupKey);
        return {...oldGroup, ...changes};
    }
    
    private toDbChanges(changes: Partial<db.group.Group>): Record<string, unknown> {
        const set: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(changes)) {
            if (value !== undefined) {
                set[key] = value;
            }
        }
        return set;
    }
    
    /**
     * The next value of one plane's counter. Each is moved only by writes to its own plane: the two metadata
     * counters by their own `groupUpdate*Meta` endpoint, `rosterVersion` by a membership change or a rotation.
     *
     * One helper taking the field rather than three near-identical ones: the field is the only thing that
     * differs, and passing it in is what stops a copy-paste from incrementing the wrong plane's counter.
     *
     * The guard is not about migrations — `createGroup` sets all three, and there is no backfill to wait for —
     * but about not writing `NaN` into the document if a group somehow lacks one. An error is recoverable; a
     * `NaN` counter no reader can compare against is not.
     */
    private nextVersionOf(group: db.group.Group,
        field: "publicMetaVersion"|"privateMetaVersion"|"rosterVersion"): types.group.GroupVersion {
        const current = group[field];
        if (!Number.isInteger(current)) {
            throw new AppException("INTERNAL_ERROR", `group '${group.id}' has no '${field}' counter`);
        }
        return (current + 1) as types.group.GroupVersion;
    }
    
}
