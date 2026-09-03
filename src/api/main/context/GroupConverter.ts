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

export class GroupConverter {
    
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
            users: group.users,
            managers: group.managers,
            version: group.version,
            keyVersion: group.keyVersion,
            keyHistory: group.keyHistory ?? [],
            policy: group.policy || {},
            history: state.history.map(x => this.convertHistoryEntry(x)),
            // Derived from the entries rather than echoed from the request, so a client can see what it was
            // actually given instead of trusting its own arithmetic.
            firstServedVersion: state.history[0]?.version ?? group.version,
            groupKeys: group.groupKeys ?? [],
            ...this.treeState(group, state.tree, user, scope, forUserIds, forNewMembers),
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        return res;
    }
    
    /** What a listing serves: identity, roster, epoch. A client that wants state asks for one group. */
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
            users: group.users,
            managers: group.managers,
            version: group.version,
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
        const full = scope === "full" || position < 0;
        const view = full
            ? tree
            : GroupConverter.pathView(tree, position, subjects, seats);
        return {
            numLeaves: tree.numLeaves,
            leafAssignment: tree.leafAssignment,
            eraFloor: group.eraFloor,
            treeNodes: view.nodes,
            treeEdges: view.edges,
            treeScope: (full ? "full" : "path") as contextApi.GroupTreeScope,
            ...(position >= 0 ? {ownLeafPosition: position} : {}),
            // Handed back so the caller does not have to find them in `leafAssignment` itself — the bridge
            // already resolved them to decide which nodes to serve.
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
     * The part of the tree the caller actually uses: one edge per level of their climb plus the grant edge, and
     * the public keys of their path and copath. `O(log n)` against 32 767 edges (~10.5 MB) at 16 384 members.
     *
     * A client that wants to validate the whole structure itself asks for `scope: "full"`.
     */
    private static pathView(
        tree: types.cloud.GroupTreeState,
        position: number,
        subjectPositions: number[] = [],
        seatPositions: number[] = [],
    ): types.cloud.GroupTreeState {
        const path = TreeMath.directPath(position, tree.numLeaves);
        const copath = TreeMath.copath(position, tree.numLeaves);
        const onPath = new Set(path);
        const needed = new Set([...path, ...copath]);
        for (const subjectPosition of subjectPositions) {
            // A removal is planned against the subjects' paths: their nodes get new keys, and each new key is
            // re-wrapped to the subtrees on their copaths, whose *public* keys are needed for that. A batch needs
            // every departing member's, because one delta covers the union of them.
            for (const nodeIndex of TreeMath.directPath(subjectPosition, tree.numLeaves)) {
                needed.add(nodeIndex);
            }
            for (const nodeIndex of TreeMath.copath(subjectPosition, tree.numLeaves)) {
                needed.add(nodeIndex);
            }
        }
        if (seatPositions.length > 0) {
            // An addition is planned against seats nobody holds yet, in the geometry seating them would produce:
            // appending past the last leaf re-parents nodes along the truncated right edge, and the new keys are
            // wrapped to whatever ends up beside them. Evaluated once for the whole batch, because seating them
            // one at a time and seating them together do not give the same geometry. Indices outside the tree as
            // it stands are simply absent from `nodes`, so asking for them costs nothing.
            const grown = TreeMath.numLeavesToSeatAll(seatPositions, tree.numLeaves);
            for (const seatPosition of seatPositions) {
                for (const nodeIndex of TreeMath.directPath(seatPosition, grown)) {
                    needed.add(nodeIndex);
                }
                for (const nodeIndex of TreeMath.copath(seatPosition, grown)) {
                    needed.add(nodeIndex);
                }
            }
        }
        const holder = tree.leafAssignment[position];
        const edges = tree.edges.filter(edge => {
            if (edge.isGrantEdge) {
                return true;
            }
            if (edge.childKind === "user") {
                return edge.childUserId === holder;
            }
            return edge.childIndex !== undefined && onPath.has(edge.childIndex);
        });
        return {
            numLeaves: tree.numLeaves,
            leafAssignment: tree.leafAssignment,
            nodes: tree.nodes.filter(node => needed.has(node.nodeIndex)),
            edges: edges,
        };
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
        };
        if (entry.confirmationTag !== undefined) {
            res.confirmationTag = entry.confirmationTag;
        }
        return res;
    }
}
