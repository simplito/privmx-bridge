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
    
    async getHistory(groupId: types.group.GroupId): Promise<db.group.GroupHistoryEntry[]> {
        return this.history.query(q => q.eq("groupId", groupId)).sort("version", true).array();
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
