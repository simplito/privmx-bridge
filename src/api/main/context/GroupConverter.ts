/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as contextApi from "./ContextApiTypes";
import * as db from "../../../db/Model";
import { TreeMath } from "../../../service/cloud/keytree/TreeMath";
import { TreeHash } from "../../../service/cloud/keytree/TreeHash";

export class GroupConverter {
    
    /** How many groups' `TreeHash.childHashes` `servedHashes` keeps. */
    static readonly HASH_CACHE_SIZE = 128;
    
    /** Keyed by `groupId|treeCommitSeq`; a Map iterates in insertion order, so the first key is the oldest. */
    private static readonly hashCache = new Map<string, Map<number, Buffer>>();
    
    /**
     * The hashes of every node of a served tree, computed once per commit rather than once per read: the whole tree
     * is hashed to serve any seat's copath, and every member reads the same tree after each commit. Read path only —
     * `tree` must be the state `group.treeCommitSeq` names, which `GroupRepository.getFullState` guarantees.
     *
     * Every tree commit moves `treeCommitSeq`, so a key never outlives the tree it was computed for — nothing to
     * invalidate. A group without a statement chain has no such key and is not cached.
     */
    private static servedHashes(group: db.group.Group, tree: types.cloud.GroupTreeState): Map<number, Buffer>|undefined {
        if (group.treeCommitSeq === undefined) {
            return undefined;
        }
        const key = `${group.id}|${group.treeCommitSeq}`;
        let hashes = GroupConverter.hashCache.get(key);
        if (!hashes) {
            hashes = TreeHash.childHashes(TreeHash.of(tree));
            if (GroupConverter.hashCache.size >= GroupConverter.HASH_CACHE_SIZE) {
                GroupConverter.hashCache.delete(GroupConverter.hashCache.keys().next().value!);
            }
            GroupConverter.hashCache.set(key, hashes);
        }
        return hashes;
    }
    
    /** The whole group: document plus state. `state` is passed in, not fetched, so a caller that does not need
     *  it cannot pay for it by accident. */
    convertGroup(
        user: types.cloud.UserId,
        group: db.group.Group,
        state: db.group.GroupState,
        scope: contextApi.GroupTreeScope = "path",
        forUserIds?: types.cloud.UserId[],
        forNewMembers?: number,
    ): contextApi.GroupInfo {
        const res: contextApi.GroupInfo = {
            id: group.id,
            groupPubKey: group.groupPubKey,
            contextId: group.contextId,
            type: group.type,
            createDate: group.createDate,
            creator: group.creator,
            lastModificationDate: group.lastModificationDate,
            lastModifier: group.lastModifier,
            data: state.history.map(x => ({keyId: x.keyId, data: x.data})),
            publicMeta: {
                version: state.publicMeta.version,
                keyId: state.publicMeta.keyId,
                keyVersion: state.publicMeta.keyVersion,
                data: state.publicMeta.data,
                created: state.publicMeta.created,
                author: state.publicMeta.author,
            },
            privateMeta: {
                version: state.privateMeta.version,
                keyId: state.privateMeta.keyId,
                keyVersion: state.privateMeta.keyVersion,
                data: state.privateMeta.data,
                created: state.privateMeta.created,
                author: state.privateMeta.author,
            },
            users: group.users,
            managers: group.managers,
            publicMetaVersion: group.publicMetaVersion,
            privateMetaVersion: group.privateMetaVersion,
            rosterVersion: group.rosterVersion,
            keyVersion: group.keyVersion,
            keyHistory: group.keyHistory ?? [],
            policy: group.policy || {},
            history: state.history.map(x => this.convertHistoryEntry(x)),
            groupKeys: group.groupKeys ?? [],
            ...this.treeState(group, state.tree, state.treeCommit, user, scope, forUserIds, forNewMembers),
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        return res;
    }
    
    /** What a listing serves: identity, roster, epoch and the latest statement. A client that wants state asks for
     *  one group. */
    convertGroupSummary(group: db.group.GroupSummaryFields, treeCommit?: types.cloud.GroupTreeCommitStatement): contextApi.GroupSummary {
        const res: contextApi.GroupSummary = {
            id: group.id,
            groupPubKey: group.groupPubKey,
            contextId: group.contextId,
            type: group.type,
            createDate: group.createDate,
            creator: group.creator,
            lastModificationDate: group.lastModificationDate,
            lastModifier: group.lastModifier,
            users: group.users,
            managers: group.managers,
            publicMetaVersion: group.publicMetaVersion,
            privateMetaVersion: group.privateMetaVersion,
            rosterVersion: group.rosterVersion,
            keyVersion: group.keyVersion,
            policy: group.policy || {},
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        if (treeCommit) {
            res.treeCommit = treeCommit;
        }
        return res;
    }
    
    /** The tree state, flattened, plus the caller's own leaf. The archive is not included — it grows with the
     *  group's whole history; `groupGetKeyArchive` serves it on demand. */
    private treeState(
        group: db.group.Group,
        tree: types.cloud.GroupTreeState,
        treeCommit: types.cloud.GroupTreeCommitStatement|null,
        user: types.cloud.UserId,
        scope: contextApi.GroupTreeScope,
        forUserIds?: types.cloud.UserId[],
        forNewMembers?: number,
    ) {
        const position = tree.leafAssignment.indexOf(user);
        const subjects = (forUserIds ?? [])
            .map(userId => tree.leafAssignment.indexOf(userId))
            .filter(seat => seat >= 0);
        const seats = forNewMembers === undefined ? [] : GroupConverter.allocateSeats(tree, forNewMembers);
        // A caller with no seat has no path to serve, so they get the whole structure.
        const served: contextApi.GroupTreeScope = position < 0 ? "full" : scope;
        const view = served === "full" ? tree : GroupConverter.climbView(tree, position, served === "plan");
        // Only for a path view: a plan or full view carries every record, from which the whole hash follows.
        const copathHashes = served === "path"
            ? TreeHash.copathHashes(TreeHash.of(tree), position, GroupConverter.servedHashes(group, tree)).map(hash => hash.toString("hex"))
            : undefined;
        return {
            // Absent only on groups from before the current layout, which predate the field.
            treeVersion: group.treeVersion ?? 1,
            numLeaves: tree.numLeaves,
            leafAssignment: tree.leafAssignment,
            eraFloor: group.eraFloor,
            treeNodes: view.nodes,
            treeEdges: view.edges,
            treeScope: served,
            ...(treeCommit ? {treeCommit} : {}),
            // Filled in by the caller, which can load them: `vouchingSeqs` says which.
            treeCommits: [] as types.cloud.GroupTreeCommitStatement[],
            ...(copathHashes ? {copathHashes} : {}),
            ...(position >= 0 ? {ownLeafPosition: position} : {}),
            // Handed back so the caller does not have to find them in `leafAssignment` itself.
            ...(forUserIds === undefined ? {} : {subjectLeafPositions: subjects}),
            ...(forNewMembers === undefined ? {} : {nextFreeSeats: seats}),
            ...(group.archivePrunedBelow !== undefined ? {archivePrunedBelow: group.archivePrunedBelow} : {}),
        };
    }
    
    /**
     * Seats for `count` newcomers: the blanks a removal left, lowest first, then appended past the last leaf.
     *
     * The same order the tree itself enforces — appends have to be contiguous, and reusing a blank keeps
     * `numLeaves` from creeping up over remove/add cycles.
     */
    private static allocateSeats(tree: types.cloud.GroupTreeState, count: number): number[] {
        const seats: number[] = [];
        for (let position = 0; position < tree.numLeaves && seats.length < count; position++) {
            if (!tree.leafAssignment[position]) {
                seats.push(position);
            }
        }
        for (let position = tree.numLeaves; seats.length < count; position++) {
            seats.push(position);
        }
        return seats;
    }
    
    /**
     * The caller's climb: the edges addressed to them or to a node on their keyed path, and the grant edge. Every
     * edge's parent is the child's lowest filled keyed ancestor, so these are exactly the edges a climb from the
     * caller's seat can use — one per filled node on the way up.
     *
     * Nodes: the records of the caller's keyed path (filled or blank, so the client can tell which of its own nodes
     * need a self-update), or with `plan` every record of the group, which planning a commit resolves against.
     */
    private static climbView(tree: types.cloud.GroupTreeState, position: number, plan: boolean): types.cloud.GroupTreeState {
        const path = new Set(TreeMath.keyedPath(position, tree.numLeaves));
        const holder = tree.leafAssignment[position];
        const edges = tree.edges.filter(edge => {
            if (edge.isGrantEdge) {
                return true;
            }
            if (edge.childKind === "user") {
                return edge.childUserId === holder;
            }
            return edge.childIndex !== undefined && path.has(edge.childIndex);
        });
        return {
            numLeaves: tree.numLeaves,
            leafAssignment: tree.leafAssignment,
            nodes: plan ? tree.nodes : tree.nodes.filter(node => path.has(node.nodeIndex)),
            edges: edges,
        };
    }
    
    /** The seqs of the statements vouching for the filled nodes in a view, ascending and deduplicated. */
    static vouchingSeqs(nodes: types.cloud.GroupTreeNode[]): number[] {
        const seqs = nodes.filter(node => node.publicKey && node.setBy !== undefined).map(node => node.setBy!);
        return [...new Set(seqs)].sort((a, b) => a - b);
    }
    
    convertKeyArchive(group: db.group.Group, rungs: types.cloud.GroupArchiveRung[]): contextApi.GroupGetKeyArchiveResult {
        const res: contextApi.GroupGetKeyArchiveResult = {
            keyVersion: group.keyVersion,
            eraFloor: group.eraFloor,
            keyHistory: group.keyHistory ?? [],
            rungs: rungs,
        };
        if (group.archivePrunedBelow !== undefined) {
            res.archivePrunedBelow = group.archivePrunedBelow;
        }
        return res;
    }
    
    private convertHistoryEntry(entry: db.group.GroupHistoryEntry): contextApi.GroupHistoryEntryInfo {
        const res: contextApi.GroupHistoryEntryInfo = {
            keyId: entry.keyId,
            groupPubKey: entry.groupPubKey,
            created: entry.created,
            author: entry.author,
            version: entry.version,
            keyVersion: entry.keyVersion,
        };
        if (entry.confirmationTag !== undefined) {
            res.confirmationTag = entry.confirmationTag;
        }
        return res;
    }
}
