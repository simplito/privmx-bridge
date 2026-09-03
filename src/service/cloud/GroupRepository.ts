/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import { MongoQueryConverter } from "../../db/mongo/MongoQueryConverter";
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
     * A page of groups with only the fields a listing serves, optionally filtered by `listParams.query`.
     *
     * Stage order matters: `contextId` matches first so no query can reach another context, and the query runs
     * before the projection so a field left out of the summary stays filterable.
     */
    async getPage(contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.group.Group, onlyForUser?: types.cloud.UserId) {
        const mongoQueries = listParams.query ? [MongoQueryConverter.convertQuery(listParams.query)] : [];
        // `onlyForUser` narrows to the caller's own groups, served off the `{contextId, users}` /
        // `{contextId, managers}` indexes from Migration072. In the same `$match` as `contextId`, so no query
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
    
    /** Groups in the given context the user belongs to (member or manager) — used by Phase 2 grantee resolution. */
    async getGroupsOfUser(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        return this.repository.query(q => q.and(q.eq("contextId", contextId), q.or(q.includes("users", userId), q.includes("managers", userId)))).array();
    }
    
    /**
     * Everything a fan-out over a container's group grantees needs, out of one lookup:
     *
     * - `groupsByUser` — which of the given groups each member belongs to. Keys are the distinct member
     *   userIds, so they double as the recipient list; each value narrows that recipient's `groupKeys`.
     * - `groupEpochs` — each group's current epoch, for the `staleGroups` a `*Get` would serve.
     *
     * Wider than `getKeyVersions`, but still projected: expanding grantees needs the membership lists, and those
     * are all it needs. `leafAssignment` is an entry per seat, `groupKeys` and `keyHistory` an entry per
     * rotation — none of them readable from the result, all of them dragged along by a whole-document read on the
     * path that runs per item write.
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
                await this.deleteGroup(group.id);
                await func(group);
            }
        }
    }
    
    // ── out-of-document state (see GroupStateRepository) ──────────────────────────────────────────────────────
    
    /** The hidden key tree, assembled in the shape the validator and the API have always seen. */
    async getTree(group: db.group.Group): Promise<types.cloud.GroupTreeState> {
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
    async getFullState(group: db.group.Group, fromVersion?: number): Promise<db.group.GroupState> {
        const [tree, history] = await Promise.all([
            this.state.getTree(group),
            this.state.getHistory(group.id, fromVersion),
        ]);
        return {tree, history};
    }
    
    // ── writes ───────────────────────────────────────────────────────────────────────────────────────────────
    
    async createGroup(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId|null, type: types.group.GroupType|undefined,
        groupPubKey: types.cloud.GroupPubKey, creator: types.cloud.UserId, managers: types.cloud.UserId[], users: types.cloud.UserId[],
        data: types.group.GroupData, keyId: types.core.KeyId, policy: types.cloud.ContainerPolicy,
        tree: types.cloud.GroupTreeState, groupKeys: Omit<types.cloud.GroupKeysEntry, "group">[] = []) {
        const now = DateUtils.now();
        const firstVersion = 1 as types.group.GroupVersion;
        const id = this.repository.generateId() as types.group.GroupId;
        const group: db.group.Group = {
            id: id,
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
            version: firstVersion,
            policy: policy,
            // A group starts at epoch 1 with an era floor of 1: there is no earlier epoch to descend to, and the
            // floor is what every later rung is measured against.
            numLeaves: tree.numLeaves,
            leafAssignment: tree.leafAssignment,
            keyVersion: 1,
            eraFloor: 1,
            // The client cannot name the group it is creating, so the entry is filed against the id generated
            // here. Nothing inside the ciphertext depends on it — it binds contextId and resourceId.
            ...(groupKeys.length > 0 ? {groupKeys: groupKeys.map(entry => ({...entry, group: id}))} : {}),
        };
        if (resourceId) {
            group.clientResourceId = resourceId;
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
            groupPubKey: groupPubKey,
            created: now,
            author: creator,
        });
        await this.state.writeTree(group.id, tree);
        return group;
    }
    
    /** The nodes needed to check a removal of `positions`: their paths and copaths, deduplicated. `O(k log n)`
     *  reads for a batch of `k`, and far less than that when the seats are neighbours. */
    async getPathNodes(group: db.group.Group, positions: number[]): Promise<types.cloud.GroupTreeNode[]> {
        return this.state.getNodesAt(group.id, TreeTransitionValidator.nodesNeededFor(positions, group.numLeaves));
    }
    
    /** The root node alone, which is all a rotation is checked against. */
    async getRootNode(group: db.group.Group): Promise<types.cloud.GroupTreeNode|undefined> {
        return (await this.state.getNodesAt(group.id, [TreeMath.root(group.numLeaves)]))[0];
    }
    
    /**
     * Removes one or more members: blank their leaves, refresh the union of their paths, advance the epoch once,
     * append the rungs. All under one compare-and-swap on `keyVersion`, so two managers removing concurrently
     * cannot interleave — and a batch cannot half-land the way the same removals done one call at a time can.
     *
     * @returns the updated group, or `null` on a lost CAS race
     */
    async removeMembersWithTransition(params: {
        oldGroup: db.group.Group,
        transition: types.cloud.GroupTreeTransition,
        modifier: types.cloud.UserId,
        removedUsers: types.cloud.UserId[],
        newGroupPubKey: types.cloud.GroupPubKey,
        keyId: types.core.KeyId,
        data: types.group.GroupData,
        rungs: types.cloud.GroupArchiveRung[],
        groupKeys?: types.cloud.GroupKeysEntry[],
        confirmationTag?: types.core.Base64,
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, removedUsers, transition} = params;
        const now = DateUtils.now();
        const leaving = new Set(removedUsers);
        const users = oldGroup.users.filter(u => !leaving.has(u));
        const managers = oldGroup.managers.filter(u => !leaving.has(u));
        const expectedKeyVersion = oldGroup.keyVersion;
        const version = this.nextVersion(oldGroup);
        const leafAssignment = [...oldGroup.leafAssignment];
        for (const position of transition.blankedPositions) {
            leafAssignment[position] = "" as types.cloud.UserId;
        }
        const changes: Partial<db.group.Group> = {
            groupPubKey: params.newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
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
            groupPubKey: params.newGroupPubKey,
            created: now,
            author: modifier,
            ...(params.confirmationTag ? {confirmationTag: params.confirmationTag} : {}),
        });
        await this.state.applyRemovalTransition(
            oldGroup.id, transition, removedUsers, oldGroup.numLeaves ?? 0, oldGroup.leafAssignment,
        );
        await this.state.insertRungs(oldGroup.id, params.rungs);
        return {...oldGroup, ...changes};
    }
    
    /** Which nodes checking an addition at `positions` needs: their paths and copaths in the grown geometry. */
    async getSeatNodes(group: db.group.Group, positions: number[]): Promise<types.cloud.GroupTreeNode[]> {
        return this.state.getNodesAt(group.id, TreeTransitionValidator.nodesNeededForSeat(positions, group.numLeaves));
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
        transition: types.cloud.GroupTreeAdditionTransition,
        modifier: types.cloud.UserId,
        addedMembers: {userId: types.cloud.UserId, role: types.cloud.ContainerRole}[],
        keyId: types.core.KeyId,
        data: types.group.GroupData,
    }): Promise<db.group.Group|null> {
        const {oldGroup, modifier, addedMembers, transition} = params;
        const now = DateUtils.now();
        const addedUsers = addedMembers.map(member => member.userId);
        const users = Utils.unique([...oldGroup.users, ...addedMembers.filter(m => m.role === "user").map(m => m.userId)]);
        const managers = Utils.unique([...oldGroup.managers, ...addedMembers.filter(m => m.role === "manager").map(m => m.userId)]);
        const expectedKeyVersion = oldGroup.keyVersion;
        const version = this.nextVersion(oldGroup);
        const oldNumLeaves = oldGroup.numLeaves;
        const oldLeafAssignment = [...oldGroup.leafAssignment];
        const numLeaves = TreeMath.numLeavesToSeatAll(transition.positions, oldNumLeaves);
        const leafAssignment = [...oldLeafAssignment];
        while (leafAssignment.length < numLeaves) {
            leafAssignment.push("" as types.cloud.UserId);
        }
        transition.positions.forEach((position, i) => {
            leafAssignment[position] = addedUsers[i];
        });
        const changes: Partial<db.group.Group> = {
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            data: params.data,
            users: users,
            managers: managers,
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
            groupPubKey: oldGroup.groupPubKey,
            created: now,
            author: modifier,
        });
        await this.state.applyAdditionTransition(oldGroup.id, transition, addedUsers, oldNumLeaves, oldLeafAssignment);
        return {...oldGroup, ...changes};
    }
    
    /**
     * Closes the current era at `newFloor`: the rungs pointing below it go, and so do `keyHistory` and
     * `groupKeys` entries below it — nothing can verify or open them once nobody can climb there, and keeping
     * them leaves two fields growing with every rotation for the life of the group.
     *
     * `pruneArchive` deliberately does **not** drop those: a member still holding an old epoch key locally has
     * to keep being able to verify it. Cutting an era is what says those epochs are gone for good.
     */
    async cutEra(oldGroup: db.group.Group, newFloor: number): Promise<db.group.Group|null> {
        const expectedKeyVersion = oldGroup.keyVersion;
        const changes: Partial<db.group.Group> = {
            eraFloor: newFloor,
            lastModificationDate: DateUtils.now(),
            keyHistory: (oldGroup.keyHistory ?? []).filter(entry => entry.keyVersion >= newFloor),
            groupKeys: (oldGroup.groupKeys ?? []).map(entry => ({
                ...entry,
                keys: entry.keys.filter(key => (key.groupEpoch ?? 0) >= newFloor),
            })).filter(entry => entry.keys.length > 0),
        };
        if (!await this.casRotate(oldGroup, expectedKeyVersion, changes)) {
            return null;
        }
        await this.state.deleteRungsTargetingBelow(oldGroup.id, newFloor);
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
    
    /** Metadata only: the roster and the tree are untouched, and so is the epoch. */
    async updateGroup(oldGroup: db.group.Group, modifier: types.cloud.UserId, data: types.group.GroupData,
        keyId: types.core.KeyId, policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
        const now = DateUtils.now();
        const version = this.nextVersion(oldGroup);
        const changes: Partial<db.group.Group> = {
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: keyId,
            data: data,
            version: version,
        };
        if (policy !== undefined) {
            changes.policy = policy;
        }
        if (resourceId && !oldGroup.clientResourceId) {
            changes.clientResourceId = resourceId;
        }
        await this.applyChanges(oldGroup.id, changes);
        await this.state.insertHistoryEntry({
            id: GroupStateRepository.historyEntryId(oldGroup.id, version),
            groupId: oldGroup.id,
            version: version,
            keyId: keyId,
            data: data,
            groupPubKey: oldGroup.groupPubKey,
            created: now,
            author: modifier,
        });
        return {...oldGroup, ...changes};
    }
    
    async deleteGroup(id: types.group.GroupId) {
        await this.repository.delete(id);
        await this.state.deleteState(id);
    }
    
    /**
     * Current epoch of each of the given groups, keyed by id; groups outside `contextId` or missing are absent.
     *
     * Projected, because this runs on every container read and every item write into a group-granted container.
     * Reading whole documents would drag `groupKeys` and `leafAssignment` along to answer one comparison.
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
     * Applies a transition to the group document only if `keyVersion` still matches.
     *
     * Atomicity comes from the session (`GroupService` runs every transition in one), not from this. What the
     * CAS does is refuse a caller working from a superseded epoch, and serialise two transitions racing on the
     * same epoch so the loser retries against the winner instead of half-landing beside it.
     *
     * A `$set` of what changed, not a whole-document replace.
     *
     * @returns false on a CAS miss, in which case nothing has been written
     */
    async casRotate(oldGroup: db.group.Group, expectedKeyVersion: number, changes: Partial<db.group.Group>): Promise<boolean> {
        const filter = {_id: oldGroup.id, keyVersion: expectedKeyVersion};
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
        rungs: types.cloud.GroupArchiveRung[],
        groupKeys?: types.cloud.GroupKeysEntry[],
        confirmationTag?: types.core.Base64,
    }): Promise<db.group.Group | null> {
        const {oldGroup, modifier} = params;
        const now = DateUtils.now();
        const expectedKeyVersion = oldGroup.keyVersion;
        const version = this.nextVersion(oldGroup);
        const changes: Partial<db.group.Group> = {
            groupPubKey: params.newGroupPubKey,
            lastModifier: modifier,
            lastModificationDate: now,
            keyId: params.keyId,
            data: params.data,
            version: version,
            keyVersion: expectedKeyVersion + 1,
            keyHistory: [...(oldGroup.keyHistory ?? []), {keyVersion: expectedKeyVersion, groupPubKey: oldGroup.groupPubKey}],
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
            groupPubKey: params.newGroupPubKey,
            created: now,
            author: modifier,
            ...(params.confirmationTag ? {confirmationTag: params.confirmationTag} : {}),
        });
        await this.state.replaceGrantEdge(oldGroup.id, params.grantEdge);
        await this.state.insertRungs(oldGroup.id, params.rungs);
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
    
}
