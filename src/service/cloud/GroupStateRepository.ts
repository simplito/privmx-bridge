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
import * as types from "../../types";
import * as db from "../../db/Model";
import { TreeMath } from "./keytree/TreeMath";

/**
 * Group state that would otherwise grow the group document without a ceiling: tree nodes, tree edges, history
 * entries and Epoch Ladder rungs.
 *
 * Ids are derived, not generated — a node is `(groupId, nodeIndex)`, an edge is `(groupId, parent, child)`.
 * Generations are deliberately not part of an edge's identity, so refreshing a path updates edges in place
 * instead of deleting and reinserting them.
 *
 * Every mutating method runs in the session the repositories were built with; atomicity is the caller's.
 */
export class GroupStateRepository {
    
    static readonly TREE_NODE_COLLECTION_NAME = "groupTreeNode";
    static readonly TREE_EDGE_COLLECTION_NAME = "groupTreeEdge";
    static readonly HISTORY_COLLECTION_NAME = "groupHistoryEntry";
    static readonly ARCHIVE_RUNG_COLLECTION_NAME = "groupArchiveRung";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private nodes: MongoObjectRepository<db.group.GroupTreeNodeId, db.group.GroupTreeNode>,
        private edges: MongoObjectRepository<db.group.GroupTreeEdgeId, db.group.GroupTreeEdge>,
        private history: MongoObjectRepository<db.group.GroupHistoryEntryId, db.group.GroupHistoryEntry>,
        private rungs: MongoObjectRepository<db.group.GroupArchiveRungId, db.group.GroupArchiveRung>,
    ) {
    }
    
    // ── identity ─────────────────────────────────────────────────────────────────────────────────────────────
    
    static nodeId(groupId: types.group.GroupId, nodeIndex: number) {
        return `${groupId}|${nodeIndex}` as db.group.GroupTreeNodeId;
    }
    
    /** Same identity the validator uses to decide whether an edge is the one it required. */
    static edgeId(groupId: types.group.GroupId, edge: types.cloud.GroupTreeEdge) {
        const parent = edge.isGrantEdge ? "grant" : `${edge.parentIndex ?? -1}`;
        const child = edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`;
        return `${groupId}|${parent}>${child}` as db.group.GroupTreeEdgeId;
    }
    
    static historyEntryId(groupId: types.group.GroupId, version: types.group.GroupVersion) {
        return `${groupId}|${version}` as db.group.GroupHistoryEntryId;
    }
    
    /** Identified by the span it covers and its recipient, which makes re-submitting a rung idempotent. */
    static rungId(groupId: types.group.GroupId, rung: types.cloud.GroupArchiveRung) {
        return `${groupId}|${rung.atKeyVersion}|${rung.targetKeyVersion}|${rung.recipientKind ?? ""}|${rung.recipient ?? ""}` as db.group.GroupArchiveRungId;
    }
    
    // ── read ─────────────────────────────────────────────────────────────────────────────────────────────────
    
    /** The tree in the shape the validator and the API expect: geometry from the document, the rest from the
     *  collections. `null` for a flat group. */
    async getTree(group: db.group.Group): Promise<types.cloud.GroupTreeState|null> {
        if (group.numLeaves === undefined) {
            return null;
        }
        const [nodeDocs, edgeDocs] = await Promise.all([
            this.nodes.query(q => q.eq("groupId", group.id)).array(),
            this.edges.query(q => q.eq("groupId", group.id)).array(),
        ]);
        return {
            numLeaves: group.numLeaves,
            leafAssignment: group.leafAssignment ?? [],
            nodes: nodeDocs
                .map(doc => this.toTreeNode(doc))
                .sort((a, b) => a.nodeIndex - b.nodeIndex),
            // Sorted by identity so the served order does not depend on which write last touched an edge.
            edges: edgeDocs
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
                .map(doc => this.toTreeEdge(doc)),
        };
    }
    
    /**
     * History entries of one group, optionally only those from `fromVersion` on. The window goes into the query
     * rather than filtering afterwards: each entry carries the roster it was written with, and a client that has
     * already verified the older ones has no use for them.
     */
    async getHistory(groupId: types.group.GroupId, fromVersion?: number): Promise<db.group.GroupHistoryEntry[]> {
        const entries = await this.history.query(q => fromVersion === undefined
            ? q.eq("groupId", groupId)
            : q.and(q.eq("groupId", groupId), q.gte("version", fromVersion as types.group.GroupVersion)),
        ).sort("version", true).array();
        if (entries.length > 0 || fromVersion === undefined) {
            return entries;
        }
        // The head entry is never windowed out: it carries the group's current `data` and names the current
        // keyId, so a response without it is not a smaller answer, it is an unusable one.
        return this.history.query(q => q.eq("groupId", groupId)).sort("version", false).limit(1).array();
    }
    
    /** Every keyId the group has ever used — what a submitted key entry is checked against. Projected, so a
     *  long history does not pull its `data` through memory. */
    async getHistoryKeyIds(groupId: types.group.GroupId): Promise<types.core.KeyId[]> {
        const entries = await this.history.query(q => q.eq("groupId", groupId)).props("keyId").array();
        return entries.map(entry => entry.keyId);
    }
    
    /** Rungs of one group, windowed by the epoch they are readable at. The window goes into the query, so a
     *  client descending twenty epochs reads twenty documents, not the whole archive. */
    async getArchiveRungs(groupId: types.group.GroupId, fromKeyVersion?: number, toKeyVersion?: number): Promise<types.cloud.GroupArchiveRung[]> {
        const rungs = await this.rungs.query(q => {
            const conditions = [q.eq("groupId", groupId)];
            if (fromKeyVersion !== undefined) {
                conditions.push(q.gte("atKeyVersion", fromKeyVersion));
            }
            if (toKeyVersion !== undefined) {
                conditions.push(q.lte("atKeyVersion", toKeyVersion));
            }
            return q.andList(conditions);
        }).sort("atKeyVersion", true).array();
        return rungs.map(rung => this.toArchiveRung(rung));
    }
    
    // ── write ────────────────────────────────────────────────────────────────────────────────────────────────
    
    /** Writes a transition as the difference against the state it replaces — a removal costs `O(log n)`
     *  documents. `oldTree` of `null` writes the whole tree, which is what creating a group does. */
    async writeTree(groupId: types.group.GroupId, oldTree: types.cloud.GroupTreeState|null, newTree: types.cloud.GroupTreeState): Promise<void> {
        await Promise.all([
            this.writeNodes(groupId, oldTree, newTree),
            this.writeEdges(groupId, oldTree, newTree),
        ]);
    }
    
    /**
     * The nodes a transition is checked against: the path of the affected seat and its copath. `O(log n)` reads
     * against `{groupId, nodeIndex}` instead of the whole tree.
     */
    async getNodesAt(groupId: types.group.GroupId, nodeIndices: number[]): Promise<types.cloud.GroupTreeNode[]> {
        if (nodeIndices.length === 0) {
            return [];
        }
        const ids = nodeIndices.map(nodeIndex => GroupStateRepository.nodeId(groupId, nodeIndex));
        const docs = await this.nodes.getMulti(ids);
        return docs.map(doc => this.toTreeNode(doc));
    }
    
    /**
     * Applies a removal expressed as a delta: refresh the path, install the edges it owes, drop the departing
     * member's edge.
     *
     * Every write is keyed by derived identity, so an edge out of a refreshed node replaces the one it supersedes
     * rather than duplicating it — the same property that lets `writeTree` be a diff. The only deletion is the
     * departing member's own edge, which is the point of the operation.
     */
    async applyRemovalTransition(
        groupId: types.group.GroupId,
        transition: types.cloud.GroupTreeTransition,
        removedUser: types.cloud.UserId,
        numLeaves: number,
    ): Promise<void> {
        const nodeOperations: mongodb.AnyBulkWriteOperation[] = transition.refreshedNodes.map(node => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.nodeId(groupId, node.nodeIndex)},
                replacement: {
                    groupId: groupId,
                    nodeIndex: node.nodeIndex,
                    generation: node.generation,
                    publicKey: node.publicKey,
                },
                upsert: true,
            },
        }));
        const edgeOperations: mongodb.AnyBulkWriteOperation[] = transition.edges.map(edge => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.edgeId(groupId, edge)},
                replacement: this.toEdgeDoc(groupId, edge),
                upsert: true,
            },
        }));
        // The departing member's edge, addressed by identity: parent seat and child user, which is all the id
        // is made of — the generations and the blob it carried are irrelevant to finding it.
        edgeOperations.push({
            deleteOne: {
                filter: {_id: GroupStateRepository.edgeId(groupId, {
                    parentIndex: TreeMath.parent(TreeMath.leafNode(transition.blankedPosition), numLeaves),
                    parentGeneration: 0,
                    childKind: "user",
                    childUserId: removedUser,
                    data: "" as types.core.UserKeyData,
                })},
            },
        });
        await Promise.all([
            this.nodes.collection.bulkWrite(nodeOperations, this.nodes.getOptions()),
            this.edges.collection.bulkWrite(edgeOperations, this.edges.getOptions()),
        ]);
    }
    
    /**
     * Applies an addition delta: the seated path written in place, the edges it owes installed, and the ones the
     * new geometry supersedes deleted.
     *
     * Growth is the only reason anything gets deleted. It re-parents nodes along the truncated right edge, so an
     * edge that was correct a moment ago can name a parent that is no longer the child's parent; and when the root
     * index changes, the grant edge addressed to the old root would sit alongside the new one. Both are found by
     * arithmetic rather than by scanning, so this stays `O(log n)` writes.
     */
    async applyAdditionTransition(
        groupId: types.group.GroupId,
        transition: types.cloud.GroupTreeAdditionTransition,
        addedUser: types.cloud.UserId,
        oldNumLeaves: number,
        oldLeafAssignment: types.cloud.UserId[],
    ): Promise<void> {
        const numLeaves = TreeMath.numLeavesToSeat(transition.position, oldNumLeaves);
        const nodeOperations: mongodb.AnyBulkWriteOperation[] = transition.seatedNodes.map(node => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.nodeId(groupId, node.nodeIndex)},
                replacement: {
                    groupId: groupId,
                    nodeIndex: node.nodeIndex,
                    generation: node.generation,
                    publicKey: node.publicKey,
                },
                upsert: true,
            },
        }));
        const edgeOperations: mongodb.AnyBulkWriteOperation[] = transition.edges.map(edge => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.edgeId(groupId, edge)},
                replacement: this.toEdgeDoc(groupId, edge),
                upsert: true,
            },
        }));
        for (const staleId of GroupStateRepository.edgesSupersededBySeating(
            groupId, transition, addedUser, oldNumLeaves, numLeaves, oldLeafAssignment,
        )) {
            edgeOperations.push({deleteOne: {filter: {_id: staleId}}});
        }
        await Promise.all([
            this.nodes.collection.bulkWrite(nodeOperations, this.nodes.getOptions()),
            this.edges.collection.bulkWrite(edgeOperations, this.edges.getOptions()),
        ]);
    }
    
    /** Ids of the edges the new geometry invalidates: re-parented children, and the grant edge on a root change. */
    private static edgesSupersededBySeating(
        groupId: types.group.GroupId,
        transition: types.cloud.GroupTreeAdditionTransition,
        addedUser: types.cloud.UserId,
        oldNumLeaves: number,
        numLeaves: number,
        oldLeafAssignment: types.cloud.UserId[],
    ): db.group.GroupTreeEdgeId[] {
        if (numLeaves === oldNumLeaves) {
            return []; // filling a blank changes no parent, and the seated path's edges replace themselves by id
        }
        const stale: db.group.GroupTreeEdgeId[] = [];
        const oldRoot = TreeMath.root(oldNumLeaves);
        const newRoot = TreeMath.root(numLeaves);
        if (newRoot !== oldRoot) {
            stale.push(GroupStateRepository.edgeId(groupId, {
                isGrantEdge: true,
                parentGeneration: 0,
                childKind: "node",
                childIndex: oldRoot,
                data: "" as types.core.UserKeyData,
            }));
        }
        const oldNodeCount = TreeMath.nodeCount(oldNumLeaves);
        for (const parentIndex of TreeMath.directPath(transition.position, numLeaves)) {
            for (const childIndex of TreeMath.children(parentIndex, numLeaves)) {
                if (childIndex >= oldNodeCount) {
                    continue; // did not exist before, so nothing can be addressed to it
                }
                if (childIndex === oldRoot) {
                    continue; // the old root had no parent edge; its grant edge is handled above
                }
                const oldParent = TreeMath.parent(childIndex, oldNumLeaves);
                if (oldParent === parentIndex) {
                    continue; // same parent as before: the plan's edge replaces the old one under the same id
                }
                if (TreeMath.isLeaf(childIndex)) {
                    const holder = oldLeafAssignment[TreeMath.leafPosition(childIndex)];
                    if (!holder || holder === addedUser) {
                        continue;
                    }
                    stale.push(GroupStateRepository.edgeId(groupId, {
                        parentIndex: oldParent,
                        parentGeneration: 0,
                        childKind: "user",
                        childUserId: holder,
                        data: "" as types.core.UserKeyData,
                    }));
                    continue;
                }
                stale.push(GroupStateRepository.edgeId(groupId, {
                    parentIndex: oldParent,
                    parentGeneration: 0,
                    childKind: "node",
                    childIndex: childIndex,
                    data: "" as types.core.UserKeyData,
                }));
            }
        }
        return stale;
    }
    
    async insertHistoryEntry(entry: db.group.GroupHistoryEntry): Promise<void> {
        await this.history.insert(entry);
    }
    
    /** Keyed by coordinate, so a rung re-submitted after a lost race replaces itself instead of duplicating. */
    async insertRungs(groupId: types.group.GroupId, rungs: types.cloud.GroupArchiveRung[]): Promise<void> {
        if (rungs.length === 0) {
            return;
        }
        await this.rungs.collection.bulkWrite(rungs.map(rung => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.rungId(groupId, rung)},
                replacement: this.toRungDoc(groupId, rung),
                upsert: true,
            },
        })), this.rungs.getOptions());
    }
    
    /** Drops the rungs that point below `belowEpoch` — one range delete over the target-epoch index. */
    async deleteRungsTargetingBelow(groupId: types.group.GroupId, belowEpoch: number): Promise<void> {
        await this.rungs.deleteMany(q => q.and(q.eq("groupId", groupId), q.lt("targetKeyVersion", belowEpoch)));
    }
    
    /** Everything the group owns outside its document, for when the group itself goes away. */
    async deleteState(groupId: types.group.GroupId): Promise<void> {
        await Promise.all([
            this.nodes.deleteMany(q => q.eq("groupId", groupId)),
            this.edges.deleteMany(q => q.eq("groupId", groupId)),
            this.history.deleteMany(q => q.eq("groupId", groupId)),
            this.rungs.deleteMany(q => q.eq("groupId", groupId)),
        ]);
    }
    
    // ── mapping ──────────────────────────────────────────────────────────────────────────────────────────────
    
    private async writeNodes(groupId: types.group.GroupId, oldTree: types.cloud.GroupTreeState|null, newTree: types.cloud.GroupTreeState) {
        const previous = new Map((oldTree?.nodes ?? []).map(node => [node.nodeIndex, node]));
        const operations: mongodb.AnyBulkWriteOperation[] = [];
        for (const node of newTree.nodes) {
            const before = previous.get(node.nodeIndex);
            previous.delete(node.nodeIndex);
            if (before && before.generation === node.generation && before.publicKey === node.publicKey) {
                continue;
            }
            operations.push({
                replaceOne: {
                    filter: {_id: GroupStateRepository.nodeId(groupId, node.nodeIndex)},
                    replacement: {
                        groupId: groupId,
                        nodeIndex: node.nodeIndex,
                        generation: node.generation,
                        publicKey: node.publicKey,
                    },
                    upsert: true,
                },
            });
        }
        // A tree does not lose nodes in practice, but a symmetric diff cannot leave an orphan behind.
        for (const nodeIndex of previous.keys()) {
            operations.push({deleteOne: {filter: {_id: GroupStateRepository.nodeId(groupId, nodeIndex)}}});
        }
        if (operations.length > 0) {
            await this.nodes.collection.bulkWrite(operations, this.nodes.getOptions());
        }
    }
    
    private async writeEdges(groupId: types.group.GroupId, oldTree: types.cloud.GroupTreeState|null, newTree: types.cloud.GroupTreeState) {
        const previous = new Map((oldTree?.edges ?? []).map(edge => [GroupStateRepository.edgeId(groupId, edge), edge]));
        const operations: mongodb.AnyBulkWriteOperation[] = [];
        for (const edge of newTree.edges) {
            const id = GroupStateRepository.edgeId(groupId, edge);
            const before = previous.get(id);
            previous.delete(id);
            if (before && this.sameEdge(before, edge)) {
                continue;
            }
            operations.push({
                replaceOne: {
                    filter: {_id: id},
                    replacement: this.toEdgeDoc(groupId, edge),
                    upsert: true,
                },
            });
        }
        for (const id of previous.keys()) {
            operations.push({deleteOne: {filter: {_id: id}}});
        }
        if (operations.length > 0) {
            await this.edges.collection.bulkWrite(operations, this.edges.getOptions());
        }
    }
    
    private sameEdge(a: types.cloud.GroupTreeEdge, b: types.cloud.GroupTreeEdge) {
        return a.parentGeneration === b.parentGeneration
            && a.childGeneration === b.childGeneration
            && a.data === b.data
            && !!a.isGrantEdge === !!b.isGrantEdge;
    }
    
    private toTreeNode(doc: db.group.GroupTreeNode): types.cloud.GroupTreeNode {
        return {
            nodeIndex: doc.nodeIndex,
            generation: doc.generation,
            publicKey: doc.publicKey,
        };
    }
    
    /** Field by field rather than spreading the document: `groupId` and `id` are storage detail, and this
     *  shape goes to clients verbatim. */
    private toTreeEdge(doc: db.group.GroupTreeEdge): types.cloud.GroupTreeEdge {
        const edge: types.cloud.GroupTreeEdge = {
            parentGeneration: doc.parentGeneration,
            childKind: doc.childKind,
            data: doc.data,
        };
        if (doc.isGrantEdge) {
            edge.isGrantEdge = true;
        }
        if (doc.parentIndex !== undefined) {
            edge.parentIndex = doc.parentIndex;
        }
        if (doc.childIndex !== undefined) {
            edge.childIndex = doc.childIndex;
        }
        if (doc.childGeneration !== undefined) {
            edge.childGeneration = doc.childGeneration;
        }
        if (doc.childUserId !== undefined) {
            edge.childUserId = doc.childUserId;
        }
        return edge;
    }
    
    private toArchiveRung(doc: db.group.GroupArchiveRung): types.cloud.GroupArchiveRung {
        const rung: types.cloud.GroupArchiveRung = {
            atKeyVersion: doc.atKeyVersion,
            targetKeyVersion: doc.targetKeyVersion,
            data: doc.data,
        };
        if (doc.recipientKind !== undefined) {
            rung.recipientKind = doc.recipientKind;
        }
        if (doc.recipient !== undefined) {
            rung.recipient = doc.recipient;
        }
        if (doc.author !== undefined) {
            rung.author = doc.author;
        }
        return rung;
    }
    
    private toEdgeDoc(groupId: types.group.GroupId, edge: types.cloud.GroupTreeEdge): Omit<db.group.GroupTreeEdge, "id"> {
        const doc: Omit<db.group.GroupTreeEdge, "id"> = {
            groupId: groupId,
            parentGeneration: edge.parentGeneration,
            childKind: edge.childKind,
            data: edge.data,
        };
        if (edge.isGrantEdge) {
            doc.isGrantEdge = true;
        }
        if (edge.parentIndex !== undefined) {
            doc.parentIndex = edge.parentIndex;
        }
        if (edge.childIndex !== undefined) {
            doc.childIndex = edge.childIndex;
        }
        if (edge.childGeneration !== undefined) {
            doc.childGeneration = edge.childGeneration;
        }
        if (edge.childUserId !== undefined) {
            doc.childUserId = edge.childUserId;
        }
        return doc;
    }
    
    private toRungDoc(groupId: types.group.GroupId, rung: types.cloud.GroupArchiveRung): Omit<db.group.GroupArchiveRung, "id"> {
        const doc: Omit<db.group.GroupArchiveRung, "id"> = {
            groupId: groupId,
            atKeyVersion: rung.atKeyVersion,
            targetKeyVersion: rung.targetKeyVersion,
            data: rung.data,
        };
        if (rung.recipientKind !== undefined) {
            doc.recipientKind = rung.recipientKind;
        }
        if (rung.recipient !== undefined) {
            doc.recipient = rung.recipient;
        }
        if (rung.author !== undefined) {
            doc.author = rung.author;
        }
        return doc;
    }
}
