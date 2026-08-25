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
        forUserId?: types.cloud.UserId,
        forPosition?: number,
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
            ...this.treeState(group, state.tree, user, scope, forUserId, forPosition),
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        return res;
    }
    
    /**
     * What a listing serves: identity, roster, epoch. A page of a hundred groups through `convertGroup` would
     * carry a hundred trees and histories; a client that wants state asks for one group.
     */
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
    
    /**
     * The tree state, flattened, plus the caller's own leaf.
     *
     * The archive is deliberately *not* included: it grows with the group's entire history, while a client needs
     * it only when reaching for an older epoch. `groupGetKeyArchive` serves it on demand instead.
     */
    private treeState(
        group: db.group.Group,
        tree: types.cloud.GroupTreeState,
        user: types.cloud.UserId,
        scope: contextApi.GroupTreeScope,
        forUserId?: types.cloud.UserId,
        forPosition?: number,
    ) {
        const position = tree.leafAssignment.indexOf(user);
        const subject = forUserId === undefined ? -1 : tree.leafAssignment.indexOf(forUserId);
        // A caller with no seat has no path to serve, so they get the whole structure.
        const full = scope === "full" || position < 0;
        const view = full
            ? tree
            : GroupConverter.pathView(tree, position, subject >= 0 ? subject : undefined, forPosition);
        return {
            numLeaves: tree.numLeaves,
            leafAssignment: tree.leafAssignment,
            eraFloor: group.eraFloor,
            treeNodes: view.nodes,
            treeEdges: view.edges,
            treeScope: (full ? "full" : "path") as contextApi.GroupTreeScope,
            ...(position >= 0 ? {ownLeafPosition: position} : {}),
            ...(group.archivePrunedBelow !== undefined ? {archivePrunedBelow: group.archivePrunedBelow} : {}),
        };
    }
    
    /**
     * The part of the tree the caller actually uses.
     *
     * Climbing needs one edge per level — the one whose child is the caller, then the one whose child is each
     * node above them — plus the grant edge at the top. Planning a removal needs the *public* keys of the copath
     * as well, to re-wrap the refreshed path to the subtrees that keep their keys; the leaf siblings' keys come
     * from the roster, not from here. That is `O(log n)` of both, against 32 767 edges (~10.5 MB) for a group of
     * 16 384 if the whole tree is served.
     *
     * Independent validation of the whole structure is the one thing this view cannot do — and the server does
     * it on every write anyway. A client that wants to check for itself asks for `scope: "full"`.
     */
    private static pathView(
        tree: types.cloud.GroupTreeState,
        position: number,
        subjectPosition?: number,
        seatPosition?: number,
    ): types.cloud.GroupTreeState {
        const path = TreeMath.directPath(position, tree.numLeaves);
        const copath = TreeMath.copath(position, tree.numLeaves);
        const onPath = new Set(path);
        const needed = new Set([...path, ...copath]);
        if (subjectPosition !== undefined) {
            // A removal is planned against the subject's path: their nodes get new keys, and each new key is
            // re-wrapped to the subtrees on their copath, whose *public* keys are needed for that.
            for (const nodeIndex of TreeMath.directPath(subjectPosition, tree.numLeaves)) {
                needed.add(nodeIndex);
            }
            for (const nodeIndex of TreeMath.copath(subjectPosition, tree.numLeaves)) {
                needed.add(nodeIndex);
            }
        }
        if (seatPosition !== undefined) {
            // An addition is planned against a seat nobody holds yet, in the geometry seating it would produce:
            // appending past the last leaf re-parents nodes along the truncated right edge, and the new keys are
            // wrapped to whatever ends up beside them. Indices outside the tree as it stands are simply absent
            // from `nodes`, so asking for them costs nothing.
            const grown = TreeMath.numLeavesToSeat(seatPosition, tree.numLeaves);
            for (const nodeIndex of TreeMath.directPath(seatPosition, grown)) {
                needed.add(nodeIndex);
            }
            for (const nodeIndex of TreeMath.copath(seatPosition, grown)) {
                needed.add(nodeIndex);
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
            users: entry.users,
            managers: entry.managers,
            created: entry.created,
            author: entry.author,
        };
        if (entry.confirmationTag !== undefined) {
            res.confirmationTag = entry.confirmationTag;
        }
        return res;
    }
}
