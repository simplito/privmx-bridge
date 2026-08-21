/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as types from "../../types";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";
import { Utils } from "../../utils/Utils";
import { AppException } from "../../api/AppException";
import { GroupStateRepository } from "./GroupStateRepository";
import { TreeTransitionValidator } from "./keytree/TreeTransitionValidator";
import { TreeMath } from "./keytree/TreeMath";

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
        users: 1,
        managers: 1,
        version: 1,
        keyVersion: 1,
        policy: 1,
    };
    
    constructor(
        private repository: MongoObjectRepository<types.group.GroupId, db.group.Group>,
        private state: GroupStateRepository,
    ) {
    }
    
    async get(id: types.group.GroupId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.group.GroupId[]) {
        return this.repository.getMulti(ids);
    }
    
    /**
     * A page of groups with only the fields a listing serves.
     *
     * Projected, not filtered afterwards: the fields left out are the ones that grow with the group, so reading
     * whole documents would cost a page of them regardless of how small the response is.
     */
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.group.Group) {
        return this.repository.getMatchingPage<db.group.GroupSummaryFields>(
            [{$match: {contextId: contextId}}, {$project: GroupRepository.SUMMARY_PROJECTION}],
            listParams,
            sortBy,
        );
    }
    
    /** Groups in the given context the user belongs to (member or manager) — used by Phase 2 grantee resolution. */
    async getGroupsOfUser(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        return this.repository.query(q => q.and(q.eq("contextId", contextId), q.or(q.includes("users", userId), q.includes("managers", userId)))).array();
    }
    
    /** Distinct member userIds across the given groups (union of users+managers) — used to expand grantees for notifications. */
    async getMembersOfGroups(groupIds: types.group.GroupId[]): Promise<types.cloud.UserId[]> {
        if (groupIds.length === 0) {
            return [];
        }
        const groups = await this.repository.getMulti(groupIds);
        const members = new Set<types.cloud.UserId>();
        for (const group of groups) {
            for (const u of group.users) {
                members.add(u);
            }
            for (const m of group.managers) {
                members.add(m);
            }
        }
        return [...members];
    }
    
    /** Verifies that all given groups exist in the given context (mirrors CloudKeyService.checkUsersExistance). */
    async checkGroupsExistence(contextId: types.context.ContextId, groupIds: types.group.GroupId[]) {
        if (groupIds.length === 0) {
            return;
        }
        const groups = await this.repository.getMulti(Utils.unique(groupIds));
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
                await this.deleteGroup(group.id);
                await func(group);
            }
        }
    }
    
    // ── out-of-document state (see GroupStateRepository) ──────────────────────────────────────────────────────
    
    /** Whether the group is tree-backed. Tree geometry on the document is what says so. */
    isTreeBacked(group: db.group.Group): boolean {
        return group.numLeaves !== undefined;
    }
    
    /** The hidden key tree, assembled in the shape the validator and the API have always seen. */
    async getTree(group: db.group.Group): Promise<types.cloud.GroupTreeState|null> {
        return this.state.getTree(group);
    }
    
    async getHistory(groupId: types.group.GroupId): Promise<db.group.GroupHistoryEntry[]> {
        return this.state.getHistory(groupId);
    }
    
    /** Every keyId the group has ever used — what a submitted key entry is checked against. */
    async getHistoryKeyIds(groupId: types.group.GroupId): Promise<types.core.KeyId[]> {
        return this.state.getHistoryKeyIds(groupId);
    }
    
    async getArchiveRungs(groupId: types.group.GroupId, fromKeyVersion?: number, toKeyVersion?: number): Promise<types.cloud.GroupArchiveRung[]> {
        return this.state.getArchiveRungs(groupId, fromKeyVersion, toKeyVersion);
    }
    
    /** Tree plus history, for the read paths that serve a whole group. */
    async getFullState(group: db.group.Group): Promise<db.group.GroupState> {
        const [tree, history] = await Promise.all([
            this.state.getTree(group),
            this.state.getHistory(group.id),
        ]);
        return {tree, history};
    }
    
    // ── writes ───────────────────────────────────────────────────────────────────────────────────────────────
    
    async createGroup(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId|null, type: types.group.GroupType|undefined,
        groupPubKey: types.cloud.GroupPubKey, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[], policy: types.cloud.ContainerPolicy,
        tree?: types.cloud.GroupTreeState) {
        const now = DateUtils.now();
        const firstVersion = 1 as types.group.GroupVersion;
        const group: db.group.Group = {
            id: this.repository.generateId() as types.group.GroupId,
            contextId: contextId,
            type: type,
            groupPubKey: groupPubKey,
            creator: creator,
            createDate: now,
            lastModifier: creator,
            lastModificationDate: now,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            keys: keys,
            version: firstVersion,
            policy: policy,
        };
        if (resourceId) {
            group.clientResourceId = resourceId;
        }
        if (tree) {
            // A tree-backed group starts at epoch 1 with an era floor of 1: there is no earlier epoch to
            // descend to, and the floor is what every later rung is measured against.
            group.numLeaves = tree.numLeaves;
            group.leafAssignment = tree.leafAssignment;
            group.keyVersion = 1;
            group.eraFloor = 1;
            this.assertKeysAreBounded(group.keys, users, managers);
        }
        // The document first: a duplicate resourceId is the one failure that is its own, and failing before any
        // state is written keeps that case clean.
        await this.repository.insert(group);
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(group.id, firstVersion),
            groupId: group.id,
            version: firstVersion,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groupPubKey: groupPubKey,
            created: now,
            author: creator,
        });
        if (tree) {
            await this.state.writeTree(group.id, null, tree);
        }
        return group;
    }
    
    /**
     * Removes a member: the tree state is replaced, the epoch advances, and the submitted rungs are appended so
     * the new epoch can still reach the old ones. All under one compare-and-swap on `keyVersion`, so two managers
     * removing concurrently cannot interleave — the loser retries against the winner's tree.
     *
     * @returns the updated group, or `null` on a lost CAS race
     */
    async removeMemberWithTree(params: {
        oldGroup: db.group.Group,
        /** The state being replaced, already loaded for validation — the tree is written as a diff against it. */
        oldTree: types.cloud.GroupTreeState,
        modifier: types.cloud.UserId,
        removedUser: types.cloud.UserId,
        newGroupPubKey: types.cloud.GroupPubKey,
        keyId: types.core.KeyId,
        data: types.group.GroupData,
        tree: types.cloud.GroupTreeState,
        rungs: types.cloud.GroupArchiveRung[],
        /** Metadata-key entries for the members who stay; the departing member's are dropped regardless. */
        keys?: types.cloud.UserKeysEntry[],
        /** The metadata key wrapped once to the group's own grant key — the O(1) replacement for the above. */
        groupKeys?: types.cloud.GroupKeysEntry[],
        confirmationTag?: types.core.Base64,
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, removedUser} = params;
        const now = DateUtils.now();
        const users = oldGroup.users.filter(u => u !== removedUser);
        const managers = oldGroup.managers.filter(u => u !== removedUser);
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
        const version = this.nextVersion(oldGroup);
        // Per-member key entries for the removed user go with them. A tree-backed group holds none, but a
        // group that still carries some from before the tree must not keep the departed member's.
        const keys = (params.keys ?? oldGroup.keys).filter(k => k.user !== removedUser);
        this.assertKeysAreBounded(keys, users, managers);
        const changes: Partial<db.group.Group> = {
            groupPubKey: params.newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            keys: keys,
            version: version,
            keyVersion: expectedKeyVersion + 1,
            keyHistory: [...(oldGroup.keyHistory ?? []), {keyVersion: expectedKeyVersion, groupPubKey: oldGroup.groupPubKey}],
            numLeaves: params.tree.numLeaves,
            leafAssignment: params.tree.leafAssignment,
            ...(params.groupKeys ? {groupKeys: params.groupKeys} : {}),
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            groupPubKey: params.newGroupPubKey,
            created: now,
            author: modifier,
            ...(params.confirmationTag ? {confirmationTag: params.confirmationTag} : {}),
        });
        await this.state.writeTree(oldGroup.id, params.oldTree, params.tree);
        await this.state.insertRungs(oldGroup.id, params.rungs);
        return {...oldGroup, ...changes};
    }
    
    /** The nodes needed to check a removal at `position`: its path and copath, `O(log n)` reads. */
    async getPathNodes(group: db.group.Group, position: number): Promise<types.cloud.GroupTreeNode[]> {
        if (group.numLeaves === undefined) {
            return [];
        }
        return this.state.getNodesAt(group.id, TreeTransitionValidator.nodesNeededFor(position, group.numLeaves));
    }
    
    /**
     * Removes a member from a transition rather than from a whole submitted tree.
     *
     * Identical to `removeMemberWithTree` in what it leaves behind — the difference is that neither side ever
     * handles the whole tree: the client sends `O(log n)`, the bridge reads `O(log n)` to check it, and writes
     * `O(log n)`.
     *
     * @returns the updated group, or `null` on a lost CAS race
     */
    async removeMemberWithTransition(params: {
        oldGroup: db.group.Group,
        transition: types.cloud.GroupTreeTransition,
        modifier: types.cloud.UserId,
        removedUser: types.cloud.UserId,
        newGroupPubKey: types.cloud.GroupPubKey,
        keyId: types.core.KeyId,
        data: types.group.GroupData,
        rungs: types.cloud.GroupArchiveRung[],
        keys?: types.cloud.UserKeysEntry[],
        groupKeys?: types.cloud.GroupKeysEntry[],
        confirmationTag?: types.core.Base64,
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, removedUser, transition} = params;
        const now = DateUtils.now();
        const users = oldGroup.users.filter(u => u !== removedUser);
        const managers = oldGroup.managers.filter(u => u !== removedUser);
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
        const version = this.nextVersion(oldGroup);
        const keys = (params.keys ?? oldGroup.keys).filter(k => k.user !== removedUser);
        this.assertKeysAreBounded(keys, users, managers);
        const leafAssignment = [...(oldGroup.leafAssignment ?? [])];
        leafAssignment[transition.blankedPosition] = "" as types.cloud.UserId;
        const changes: Partial<db.group.Group> = {
            groupPubKey: params.newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            keys: keys,
            version: version,
            keyVersion: expectedKeyVersion + 1,
            keyHistory: [...(oldGroup.keyHistory ?? []), {keyVersion: expectedKeyVersion, groupPubKey: oldGroup.groupPubKey}],
            leafAssignment: leafAssignment,
            ...(params.groupKeys ? {groupKeys: params.groupKeys} : {}),
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            groupPubKey: params.newGroupPubKey,
            created: now,
            author: modifier,
            ...(params.confirmationTag ? {confirmationTag: params.confirmationTag} : {}),
        });
        await this.state.applyRemovalTransition(oldGroup.id, transition, removedUser, oldGroup.numLeaves ?? 0);
        await this.state.insertRungs(oldGroup.id, params.rungs);
        return {...oldGroup, ...changes};
    }
    
    /** Which nodes checking an addition at `position` needs: the seat's path and copath in the grown geometry. */
    async getSeatNodes(group: db.group.Group, position: number): Promise<types.cloud.GroupTreeNode[]> {
        if (group.numLeaves === undefined) {
            return [];
        }
        return this.state.getNodesAt(group.id, TreeTransitionValidator.nodesNeededForSeat(position, group.numLeaves));
    }
    
    /**
     * Seats a member from a transition rather than from a whole submitted tree.
     *
     * Same outcome as `addMemberWithTree`, without either side handling the whole tree — and, as there, still a
     * CAS on the unchanged epoch, so an addition racing a removal loses.
     *
     * @returns the updated group, or `null` on a lost CAS race
     */
    async addMemberWithTransition(params: {
        oldGroup: db.group.Group,
        transition: types.cloud.GroupTreeAdditionTransition,
        modifier: types.cloud.UserId,
        addedUser: types.cloud.UserId,
        role: types.cloud.ContainerRole,
        keyId: types.core.KeyId,
        data: types.group.GroupData,
        keys?: types.cloud.UserKeysEntry[],
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, addedUser, transition} = params;
        const now = DateUtils.now();
        const users = params.role === "user" ? Utils.unique([...oldGroup.users, addedUser]) : oldGroup.users;
        const managers = params.role === "manager" ? Utils.unique([...oldGroup.managers, addedUser]) : oldGroup.managers;
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
        const version = this.nextVersion(oldGroup);
        const keys = params.keys ?? oldGroup.keys;
        this.assertKeysAreBounded(keys, users, managers);
        const oldNumLeaves = oldGroup.numLeaves ?? 0;
        const oldLeafAssignment = [...(oldGroup.leafAssignment ?? [])];
        const numLeaves = TreeMath.numLeavesToSeat(transition.position, oldNumLeaves);
        const leafAssignment = [...oldLeafAssignment];
        while (leafAssignment.length < numLeaves) {
            leafAssignment.push("" as types.cloud.UserId);
        }
        leafAssignment[transition.position] = addedUser;
        const changes: Partial<db.group.Group> = {
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            keys: keys,
            version: version,
            numLeaves: numLeaves,
            leafAssignment: leafAssignment,
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            groupPubKey: oldGroup.groupPubKey,
            created: now,
            author: modifier,
        });
        await this.state.applyAdditionTransition(oldGroup.id, transition, addedUser, oldNumLeaves, oldLeafAssignment);
        return {...oldGroup, ...changes};
    }
    
    /**
     * Adds a member without advancing the epoch — that is what keeps every container the group can read valid,
     * so nobody else re-keys anything.
     */
    async addMemberWithTree(params: {
        oldGroup: db.group.Group,
        oldTree: types.cloud.GroupTreeState,
        modifier: types.cloud.UserId,
        addedUser: types.cloud.UserId,
        role: types.cloud.ContainerRole,
        keyId: types.core.KeyId,
        data: types.group.GroupData,
        tree: types.cloud.GroupTreeState,
        /** The newcomer's entry for the group's existing metadata key. */
        keys?: types.cloud.UserKeysEntry[],
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, addedUser} = params;
        const now = DateUtils.now();
        const users = params.role === "user" ? Utils.unique([...oldGroup.users, addedUser]) : oldGroup.users;
        const managers = params.role === "manager" ? Utils.unique([...oldGroup.managers, addedUser]) : oldGroup.managers;
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
        const version = this.nextVersion(oldGroup);
        const keys = params.keys ?? oldGroup.keys;
        this.assertKeysAreBounded(keys, users, managers);
        const changes: Partial<db.group.Group> = {
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            keys: keys,
            version: version,
            numLeaves: params.tree.numLeaves,
            leafAssignment: params.tree.leafAssignment,
        };
        // Still a CAS on the unchanged epoch: an addition racing a removal must lose, because it was computed
        // against a tree the removal has already replaced.
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
            groupPubKey: oldGroup.groupPubKey,
            created: now,
            author: modifier,
        });
        await this.state.writeTree(oldGroup.id, params.oldTree, params.tree);
        return {...oldGroup, ...changes};
    }
    
    /**
     * Closes the current era at `newFloor`: nothing below it can be reached by descending any more, so the rungs
     * pointing there are dropped.
     *
     * Touches no key material on the document: `keyHistory` and `groupKeys` keep their entries for epochs below
     * the floor even though nothing can climb to them any more. Dropping those is BR-14.
     */
    async cutEra(oldGroup: db.group.Group, newFloor: number): Promise<db.group.Group|null> {
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
        const changes: Partial<db.group.Group> = {
            eraFloor: newFloor,
            lastModificationDate: DateUtils.now(),
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.deleteRungsTargetingBelow(oldGroup.id, newFloor);
        return {...oldGroup, ...changes};
    }
    
    /**
     * Deletes rungs below `belowEpoch` and records the watermark, so a client that cannot descend is told the
     * archive was pruned rather than left suspecting tampering.
     *
     * Pruning is housekeeping, so a member still holding an old epoch key locally keeps being able to verify it
     * and open what it wraps.
     */
    async pruneArchive(oldGroup: db.group.Group, belowEpoch: number): Promise<db.group.Group|null> {
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
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
    
    async updateGroup(oldGroup: db.group.Group, modifier: types.cloud.UserId, groupPubKey: types.cloud.GroupPubKey, managers: types.cloud.UserId[],
        users: types.cloud.UserId[], data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[],
        policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
        const now = DateUtils.now();
        const version = this.nextVersion(oldGroup);
        const changes: Partial<db.group.Group> = {
            groupPubKey: groupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            keys: keys,
            version: version,
        };
        if (policy !== undefined) {
            changes.policy = policy;
        }
        if (resourceId && !oldGroup.clientResourceId) {
            changes.clientResourceId = resourceId;
        }
        // A membership/metadata update does NOT rotate the key epoch — it is left untouched.
        // (Rotation is done by generateNewGroupKey, which bumps keyVersion via casRotate.)
        await this.applyChanges(oldGroup.id, changes);
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: keyId,
            data: data,
            users: users,
            managers: managers,
            groupPubKey: groupPubKey,
            created: now,
            author: modifier,
        });
        return {...oldGroup, ...changes};
    }
    
    async deleteGroup(id: types.group.GroupId) {
        await this.repository.delete(id);
        await this.state.deleteState(id);
    }
    
    getKeyVersion(group: db.group.Group): number {
        return group.keyVersion ?? 0;
    }
    
    async getKeyVersions(contextId: types.context.ContextId, groupIds: types.group.GroupId[]): Promise<Map<types.group.GroupId, number>> {
        if (groupIds.length === 0) {
            return new Map();
        }
        const groups = await this.repository.getMulti(groupIds);
        const map = new Map<types.group.GroupId, number>();
        for (const g of groups) {
            if (g.contextId === contextId) {
                map.set(g.id, this.getKeyVersion(g));
            }
        }
        return map;
    }
    
    /**
     * Applies a transition to the group document only if `keyVersion` still matches.
     *
     * State spans several documents now, so the CAS alone no longer makes a transition atomic — the session does
     * (`GroupService` runs every transition in one). What the CAS still does is refuse a caller working from a
     * superseded epoch; and because two transitions racing on the same epoch both write this document, one of
     * them conflicts and retries against the winner instead of half-landing beside it.
     *
     * A `$set` of what changed, not a whole-document replace: a removal must not rewrite the whole group.
     *
     * @returns false on a CAS miss, in which case nothing has been written
     */
    async casRotate(oldGroup: db.group.Group, expectedKeyVersion: number, changes: Partial<db.group.Group>): Promise<boolean> {
        const filter: Record<string, unknown> = {_id: oldGroup.id};
        if (expectedKeyVersion === 0) {
            filter.$or = [{keyVersion: 0}, {keyVersion: {$exists: false}}];
        }
        else {
            filter.keyVersion = expectedKeyVersion;
        }
        const result = await this.repository.collection.updateOne(filter, {$set: this.toDbChanges(changes)}, this.repository.getOptions());
        return result.matchedCount > 0;
    }
    
    async generateNewGroupKey(oldGroup: db.group.Group, modifier: types.cloud.UserId, newGroupPubKey: types.cloud.GroupPubKey,
        data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.UserKeysEntry[],
        confirmationTag?: types.core.Base64): Promise<db.group.Group | null> {
        const now = DateUtils.now();
        const expectedKeyVersion = this.getKeyVersion(oldGroup);
        const version = this.nextVersion(oldGroup);
        const changes: Partial<db.group.Group> = {
            groupPubKey: newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: keyId,
            data: data,
            keys: keys,
            version: version,
            keyVersion: expectedKeyVersion + 1,
            keyHistory: [...(oldGroup.keyHistory ?? []), {keyVersion: expectedKeyVersion, groupPubKey: oldGroup.groupPubKey}],
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: keyId,
            data: data,
            users: oldGroup.users,
            managers: oldGroup.managers,
            groupPubKey: newGroupPubKey,
            created: now,
            author: modifier,
            ...(confirmationTag ? {confirmationTag} : {}),
        });
        return {...oldGroup, ...changes};
    }
    
    private async applyChanges(id: types.group.GroupId, changes: Partial<db.group.Group>) {
        await this.repository.collection.updateOne({_id: id}, {$set: this.toDbChanges(changes)}, this.repository.getOptions());
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
    
    private nextVersion(group: db.group.Group): types.group.GroupVersion {
        if (!Number.isInteger(group.version)) {
            // Documents written before the history moved out counted versions by array length. BR-08 backfills the
            // counter; until it runs, refuse rather than write a NaN version nothing can compare against.
            throw new AppException("INTERNAL_ERROR", `group '${group.id}' has no version counter; the group-state migration has not run`);
        }
        return (group.version + 1) as types.group.GroupVersion;
    }
    
    /**
     * A tree-backed group must not accumulate per-member wraps: members reach the metadata key by climbing to
     * the grant key and opening the single `groupKeys` entry. One entry per member per keyId would put
     * `members × epochs` back on the document.
     *
     * NOTE: measured at 796 members this bound is far too generous — the endpoint still sends one wrap per
     * member at creation, which is 1.03 MB, 95% of the document. See BR-14 and EP-23.
     */
    private assertKeysAreBounded(keys: types.cloud.UserKeysEntry[], users: types.cloud.UserId[], managers: types.cloud.UserId[]) {
        const blobs = keys.reduce((sum, entry) => sum + entry.keys.length, 0);
        const members = Utils.uniqueFromArrays(users, managers).length;
        if (blobs > members) {
            throw new AppException("INVALID_PARAMS",
                `a tree-backed group carries at most one key entry per member (got ${blobs} for ${members} members); the metadata key belongs in groupKeys`);
        }
    }
}
