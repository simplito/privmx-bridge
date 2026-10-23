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
    
    /** Groups whose hashes `servedHashes` keeps. A full 16k-seat group's entry is ~2k hashes, ~320 KB with V8's
     *  overhead, so the cache stays under ~64 MB whatever the groups' sizes. */
    static readonly HASH_CACHE_MAX_GROUPS = 200;
    
    /** One entry per group, for its latest seen `treeCommitSeq`; a Map iterates in insertion order, so the first key
     *  is the least recently used. */
    private static readonly hashCache = new Map<types.group.GroupId, {seq: number, hashes: Map<number, Buffer>}>();
    
    /**
     * The hashes of a served tree's nodes at bucket level and above, computed once per commit rather than once per
     * read: the whole tree is hashed to serve any seat's copath, and every member reads the same tree after each
     * commit. Read path only — `tree` must be the state `group.treeCommitSeq` names, which
     * `GroupRepository.getFullState` guarantees.
     *
     * Keyed by group, so a run of commits to one group replaces its entry instead of filling the cache with its
     * superseded trees; a read of an older seq than the cached one (a race between two reads) is answered but not
     * cached. Only nodes at `BUCKET_LEVEL` and above are kept — about `2n / 2^BUCKET_LEVEL` hashes rather than
     * `2n` — because the copath entries below a bucket are a handful of hashes inside the caller's own bucket,
     * which `TreeHash.copathHashes` recomputes. A group without a statement chain has no seq and is not cached.
     */
    private static servedHashes(group: db.group.Group, tree: types.cloud.GroupTreeState): Map<number, Buffer>|undefined {
        if (group.treeCommitSeq === undefined) {
            return undefined;
        }
        const cache = GroupConverter.hashCache;
        const cached = cache.get(group.id);
        if (cached && cached.seq === group.treeCommitSeq) {
            cache.delete(group.id);
            cache.set(group.id, cached);
            return cached.hashes;
        }
        const hashes = new Map([...TreeHash.childHashes(TreeHash.of(tree))].filter(([nodeIndex]) => TreeMath.level(nodeIndex) >= TreeMath.BUCKET_LEVEL));
        if (cached && cached.seq > group.treeCommitSeq) {
            return hashes;
        }
        cache.delete(group.id);
        while (cache.size >= GroupConverter.HASH_CACHE_MAX_GROUPS) {
            cache.delete(cache.keys().next().value!);
        }
        cache.set(group.id, {seq: group.treeCommitSeq, hashes});
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
            keyHistory: GroupConverter.keyHistory(group, state.epochKeys),
            policy: group.policy || {},
            history: state.history.map(x => this.convertHistoryEntry(x)),
            groupKeys: state.epochKeys.filter(row => row.groupKey).map(row => ({group: group.id, keys: [row.groupKey!]})),
            ...this.treeState(group, state.tree, state.treeCommit, user, scope, forUserIds, forNewMembers),
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        return res;
    }
    
    /** What a listing serves: identity, counters and epoch, all of constant size. A client that wants the roster,
     *  the tree or the latest statement asks for one group. */
    convertGroupSummary(group: db.group.GroupSummaryFields): contextApi.GroupSummary {
        const res: contextApi.GroupSummary = {
            id: group.id,
            groupPubKey: group.groupPubKey,
            contextId: group.contextId,
            type: group.type,
            createDate: group.createDate,
            creator: group.creator,
            lastModificationDate: group.lastModificationDate,
            lastModifier: group.lastModifier,
            publicMetaVersion: group.publicMetaVersion,
            privateMetaVersion: group.privateMetaVersion,
            rosterVersion: group.rosterVersion,
            keyVersion: group.keyVersion,
            policy: group.policy || {},
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
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
    
    /** The grant public keys of the epochs behind the current one, ascending. */
    private static keyHistory(group: db.group.Group, epochKeys: db.group.GroupEpochKey[]): types.cloud.GroupPubKeyAtEpoch[] {
        return epochKeys
            .filter(row => row.keyVersion < group.keyVersion && row.groupPubKey)
            .map(row => ({keyVersion: row.keyVersion, groupPubKey: row.groupPubKey!}));
    }
    
    convertKeyArchive(group: db.group.Group, rungs: types.cloud.GroupArchiveRung[], epochKeys: db.group.GroupEpochKey[]): contextApi.GroupGetKeyArchiveResult {
        const res: contextApi.GroupGetKeyArchiveResult = {
            keyVersion: group.keyVersion,
            eraFloor: group.eraFloor,
            keyHistory: GroupConverter.keyHistory(group, epochKeys),
            rungs: rungs,
        };
        if (group.archivePrunedBelow !== undefined) {
            res.archivePrunedBelow = group.archivePrunedBelow;
        }
        return res;
    }
    
    private convertHistoryEntry(entry: db.group.GroupHistoryEntry): contextApi.GroupHistoryEntryInfo {
        return {
            keyId: entry.keyId,
            groupPubKey: entry.groupPubKey,
            created: entry.created,
            author: entry.author,
            version: entry.version,
            keyVersion: entry.keyVersion,
        };
    }
}
