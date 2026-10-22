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
import type { Query, QueryResult } from "../../db/ObjectRepository";
import * as types from "../../types";
import * as db from "../../db/Model";
import { TreeMath } from "./keytree/TreeMath";
import type { TreeCommit } from "./keytree/TreeTransitionValidator";
import { AppException } from "../../api/AppException";
import { DbDuplicateError } from "../../error/DbDuplicateError";

/**
 * Group state that would otherwise grow the group document without a ceiling: tree nodes, tree edges, history
 * entries, Epoch Ladder rungs and per-epoch keys.
 *
 * Ids are derived, not generated — a node is `(groupId, nodeIndex)`, an edge is `(groupId, parent, child)`.
 * Generations are deliberately **not** part of an edge's identity, so a re-wrap lands on the id of the edge it
 * replaces and a re-submitted commit cannot duplicate one.
 *
 * Every mutating method runs in the session the repositories were built with; atomicity is the caller's.
 */
export class GroupStateRepository {
    
    static readonly TREE_NODE_COLLECTION_NAME = "groupTreeNode";
    static readonly TREE_EDGE_COLLECTION_NAME = "groupTreeEdge";
    static readonly HISTORY_COLLECTION_NAME = "groupHistoryEntry";
    // One collection per metadata plane rather than one with a plane discriminator: the two are written by
    // different endpoints and move independently, so separating them is what makes a forgotten plane predicate
    // impossible rather than merely unlikely.
    static readonly PUBLIC_META_ENTRY_COLLECTION_NAME = "groupPublicMetaEntry";
    static readonly PRIVATE_META_ENTRY_COLLECTION_NAME = "groupPrivateMetaEntry";
    static readonly ARCHIVE_RUNG_COLLECTION_NAME = "groupArchiveRung";
    static readonly TREE_COMMIT_COLLECTION_NAME = "groupTreeCommit";
    static readonly EPOCH_KEY_COLLECTION_NAME = "groupEpochKey";
    static readonly TOMBSTONE_COLLECTION_NAME = "groupTombstone";
    static readonly COLLECTION_ID_PROP = "id";
    /** At most 8 MB of entry `data` per `getHistory` page. */
    static readonly MAX_HISTORY_PAGE = 8;
    /** At most this many statements per `getTreeCommits` page. */
    static readonly MAX_TREE_COMMITS_PER_PAGE = 256;
    
    constructor(
        private nodes: MongoObjectRepository<db.group.GroupTreeNodeId, db.group.GroupTreeNode>,
        private edges: MongoObjectRepository<db.group.GroupTreeEdgeId, db.group.GroupTreeEdge>,
        private history: MongoObjectRepository<db.group.GroupHistoryEntryId, db.group.GroupHistoryEntry>,
        private publicMetaEntries: MongoObjectRepository<db.group.GroupPublicMetaEntryId, db.group.GroupPublicMetaEntry>,
        private privateMetaEntries: MongoObjectRepository<db.group.GroupPrivateMetaEntryId, db.group.GroupPrivateMetaEntry>,
        private rungs: MongoObjectRepository<db.group.GroupArchiveRungId, db.group.GroupArchiveRung>,
        private commits: MongoObjectRepository<db.group.GroupTreeCommitId, db.group.GroupTreeCommit>,
        private epochKeys: MongoObjectRepository<db.group.GroupEpochKeyId, db.group.GroupEpochKey>,
        private tombstones: MongoObjectRepository<types.group.GroupId, db.group.GroupTombstone>,
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
    
    static treeCommitId(groupId: types.group.GroupId, seq: number) {
        return `${groupId}|${seq}` as db.group.GroupTreeCommitId;
    }
    
    static epochKeyId(groupId: types.group.GroupId, keyVersion: number) {
        return `${groupId}|${keyVersion}` as db.group.GroupEpochKeyId;
    }
    
    static historyEntryId(groupId: types.group.GroupId, version: types.group.GroupVersion) {
        return `${groupId}|${version}` as db.group.GroupHistoryEntryId;
    }
    
    /**
     * One row per group in each plane, not one per version: nothing reads a metadata plane below its head, so a
     * version-derived id would only accumulate rows no reader can reach.
     *
     * The plane is part of the id even though the two live in different collections. It costs nothing, and it
     * means a row that turns up in the wrong collection is self-evidently misplaced rather than plausible.
     */
    static publicMetaEntryId(groupId: types.group.GroupId) {
        return `${groupId}|publicMeta` as db.group.GroupPublicMetaEntryId;
    }
    
    static privateMetaEntryId(groupId: types.group.GroupId) {
        return `${groupId}|privateMeta` as db.group.GroupPrivateMetaEntryId;
    }
    
    /**
     * Identified by the span it covers and its author: one rung per span per author. A commit re-submitted after a
     * lost race lands on the same id; a repair by another member lands beside the original instead of over it.
     */
    static rungId(groupId: types.group.GroupId, rung: types.cloud.GroupArchiveRungSubmission, author: types.cloud.UserId) {
        return `${groupId}|${rung.atKeyVersion}|${rung.targetKeyVersion}|${author}` as db.group.GroupArchiveRungId;
    }
    
    /** `bulkWrite`, minus mongo's refusal to accept an empty batch. */
    private static async bulkWrite<K extends string, V>(
        repository: MongoObjectRepository<K, V>,
        operations: mongodb.AnyBulkWriteOperation[],
    ): Promise<void> {
        if (operations.length === 0) {
            return;
        }
        await repository.collection.bulkWrite(operations, repository.getOptions());
    }
    
    /** `from <= field <= to`, either bound optional. */
    private static range<T, K extends keyof T>(q: Query<T>, field: K, from?: T[K], to?: T[K]): QueryResult[] {
        return [...(from === undefined ? [] : [q.gte(field, from)]), ...(to === undefined ? [] : [q.lte(field, to)])];
    }
    
    // ── read ─────────────────────────────────────────────────────────────────────────────────────────────────
    
    /** The tree in the shape the validator and the API expect: geometry from the document, the rest from the
     *  collections. */
    async getTree(group: db.group.Group): Promise<types.cloud.GroupTreeState> {
        const [nodeDocs, edgeDocs] = await Promise.all([
            this.nodes.query(q => q.eq("groupId", group.id)).array(),
            this.edges.query(q => q.eq("groupId", group.id)).array(),
        ]);
        return {
            numLeaves: group.numLeaves,
            leafAssignment: group.leafAssignment,
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
     * The head entry by default; older ones only when asked for.
     *
     * A read needs exactly one entry — the head carries the group's current `data`, names the current keyId, and
     * carries the tag that attests the roster. Nothing verifies by walking what came before: the chain that used
     * to require that is gone, and an older epoch's grant key comes down the Epoch Ladder, not out of an old
     * entry. So `fromRosterVersion` is how a caller asks for the audit trail, and only an audit does.
     *
     * Since the planes were split these entries carry no metadata at all, so the old cost this comment warned
     * about — the group's whole metadata re-sent once per membership change — is gone by construction. The
     * default is still the head alone: a read has no use for rosters it has already left behind.
     *
     * The trail comes a page at a time, `MAX_HISTORY_PAGE` entries from `fromRosterVersion` up: each entry may
     * carry up to 1 MB of `data`, so a whole long-lived group's trail would not fit in a worker's memory. The next
     * page starts one past the last version served; the trail ends at the group's `rosterVersion`.
     */
    async getHistory(groupId: types.group.GroupId, fromRosterVersion?: number): Promise<db.group.GroupHistoryEntry[]> {
        if (fromRosterVersion === undefined) {
            return this.history.query(q => q.eq("groupId", groupId)).sort("version", false).limit(1).array();
        }
        const entries = await this.history.query(
            q => q.and(q.eq("groupId", groupId), q.gte("version", fromRosterVersion as types.group.GroupVersion)),
        ).sort("version", true).limit(GroupStateRepository.MAX_HISTORY_PAGE).array();
        if (entries.length > 0) {
            return entries;
        }
        // Asking past the head still serves the head: it carries the current `data` and keyId, so a response
        // without it is not a smaller answer, it is an unusable one.
        return this.history.query(q => q.eq("groupId", groupId)).sort("version", false).limit(1).array();
    }
    
    /** Every keyId the group has ever used — what a submitted key entry is checked against. Projected, so a
     *  long history does not pull its `data` through memory. */
    async getHistoryKeyIds(groupId: types.group.GroupId): Promise<types.core.KeyId[]> {
        const entries = await this.history.query(q => q.eq("groupId", groupId)).props("keyId").array();
        return entries.map(entry => entry.keyId);
    }
    
    /** The group's public-metadata entry — a lookup by derived id. */
    async getPublicMetaHead(groupId: types.group.GroupId): Promise<db.group.GroupPublicMetaEntry|null> {
        return this.publicMetaEntries.get(GroupStateRepository.publicMetaEntryId(groupId));
    }
    
    /** The group's private-metadata entry — a lookup by derived id. */
    async getPrivateMetaHead(groupId: types.group.GroupId): Promise<db.group.GroupPrivateMetaEntry|null> {
        return this.privateMetaEntries.get(GroupStateRepository.privateMetaEntryId(groupId));
    }
    
    /**
     * The epoch each plane's head entry is keyed at, projected.
     *
     * `cutEra` and `pruneArchive` ask this before dropping rungs: an entry stays at the epoch it was written
     * under, so cutting below it would make that plane unreadable for everyone, permanently. Both planes,
     * because they move independently and only one of them may be stranded.
     */
    async getMetaHeadKeyVersions(groupId: types.group.GroupId): Promise<{publicMeta: number|null, privateMeta: number|null}> {
        const [publicHead, privateHead] = await Promise.all([
            this.publicMetaEntries.get(GroupStateRepository.publicMetaEntryId(groupId)),
            this.privateMetaEntries.get(GroupStateRepository.privateMetaEntryId(groupId)),
        ]);
        return {
            publicMeta: publicHead ? publicHead.keyVersion : null,
            privateMeta: privateHead ? privateHead.keyVersion : null,
        };
    }
    
    /** Replaces the group's public-metadata entry: one row per group, so a later version supersedes rather
     *  than piles up. */
    async writePublicMetaEntry(entry: db.group.GroupPublicMetaEntry): Promise<void> {
        const {id, ...doc} = entry;
        await this.publicMetaEntries.collection.replaceOne(
            {_id: id},
            doc as Omit<db.group.GroupPublicMetaEntry, "id">,
            {...this.publicMetaEntries.getOptions(), upsert: true},
        );
    }
    
    /** Replaces the group's private-metadata entry. */
    async writePrivateMetaEntry(entry: db.group.GroupPrivateMetaEntry): Promise<void> {
        const {id, ...doc} = entry;
        await this.privateMetaEntries.collection.replaceOne(
            {_id: id},
            doc as Omit<db.group.GroupPrivateMetaEntry, "id">,
            {...this.privateMetaEntries.getOptions(), upsert: true},
        );
    }
    
    /**
     * Rungs of one group, windowed by the epoch they are readable at. The window goes into the query, so a
     * client descending twenty epochs reads twenty documents, not the whole archive. `minTarget` leaves out rungs
     * pointing below a floor: none should be stored, and none is served even if one were.
     */
    async getArchiveRungs(groupId: types.group.GroupId, fromKeyVersion?: number, toKeyVersion?: number, minTarget?: number): Promise<types.cloud.GroupArchiveRung[]> {
        const rungs = await this.rungs.query(q => {
            const conditions = [q.eq("groupId", groupId), ...GroupStateRepository.range(q, "atKeyVersion", fromKeyVersion, toKeyVersion)];
            if (minTarget !== undefined) {
                conditions.push(q.gte("targetKeyVersion", minTarget));
            }
            return q.andList(conditions);
        }).sort("atKeyVersion", true).array();
        return rungs.map(rung => this.toArchiveRung(rung));
    }
    
    /** The rungs stored for one span, at most `LadderMath.MAX_RUNGS_PER_SPAN` of them. */
    async getRungsAt(groupId: types.group.GroupId, atKeyVersion: number, targetKeyVersion: number): Promise<types.cloud.GroupArchiveRung[]> {
        const rungs = await this.rungs.query(q => q.and(q.eq("groupId", groupId), q.eq("atKeyVersion", atKeyVersion), q.eq("targetKeyVersion", targetKeyVersion))).array();
        return rungs.map(rung => this.toArchiveRung(rung));
    }
    
    /**
     * Epoch rows of the group, ascending — what `groupGet` and the key archive serve. With bounds, only the rows in
     * `[fromKeyVersion, toKeyVersion]`, read off the `{groupId, keyVersion}` index: a windowed archive read costs
     * O(window), not O(epochs).
     */
    async getEpochKeys(groupId: types.group.GroupId, fromKeyVersion?: number, toKeyVersion?: number): Promise<db.group.GroupEpochKey[]> {
        return this.epochKeys.query(q => q.andList([q.eq("groupId", groupId), ...GroupStateRepository.range(q, "keyVersion", fromKeyVersion, toKeyVersion)]))
            .sort("keyVersion", true).array();
    }
    
    /** Whether any statement of the group carries `groupPubKey` (T4-24) — every epoch it ever had, below the era floor
     *  included: statements are never cut (clients verify the chain from seq 1), epoch rows are. If statements are ever
     *  pruned, the opener of every epoch must stay, or this check silently weakens again. */
    async hasEpochWithGroupPubKey(groupId: types.group.GroupId, groupPubKey: types.cloud.GroupPubKey): Promise<boolean> {
        const hits = await this.commits.query(q => q.and(
            q.eq("groupId", groupId),
            q.eq("statement.groupPubKey" as keyof db.group.GroupTreeCommit, groupPubKey as never),
        )).props("id").limit(1).array();
        return hits.length > 0;
    }
    
    /** Writes the row of an epoch being started. An upsert, so a migration re-run lands on the same row. */
    async writeEpochKey(groupId: types.group.GroupId, keyVersion: number, groupPubKey: types.cloud.GroupPubKey, groupKey?: types.cloud.GroupKeyEntry): Promise<void> {
        await this.epochKeys.update({id: GroupStateRepository.epochKeyId(groupId, keyVersion), groupId, keyVersion, groupPubKey, ...(groupKey ? {groupKey} : {})});
    }
    
    /** Drops the rows of the epochs below `floor` — what closing an era does to them. */
    async deleteEpochKeysBelow(groupId: types.group.GroupId, floor: number): Promise<void> {
        await this.epochKeys.deleteMany(q => q.and(q.eq("groupId", groupId), q.lt("keyVersion", floor)));
    }
    
    // ── write ────────────────────────────────────────────────────────────────────────────────────────────────
    
    /**
     * Replaces the grant edge, which is all a rotation writes to the tree.
     *
     * A rotation moves no node, so the new edge lands on the same derived id as the one it supersedes — an
     * upsert. Written as submitted: re-deriving it here would silently correct a wrong caller instead of failing.
     */
    async replaceGrantEdge(groupId: types.group.GroupId, edge: types.cloud.GroupTreeEdge): Promise<void> {
        await this.edges.collection.updateOne(
            {_id: GroupStateRepository.edgeId(groupId, edge)},
            {$set: this.toEdgeDoc(groupId, edge)},
            {...this.edges.getOptions(), upsert: true},
        );
    }
    
    /** Writes a group's whole tree and its first statement. Only creating a group does this — every later change
     *  is a commit (`applyCommit`). A fresh tree is the creator's keyed path and the edges it owes, nothing blank. */
    async writeTree(groupId: types.group.GroupId, tree: types.cloud.GroupTreeState, statement: types.cloud.GroupTreeCommitStatement, genesis: db.group.GroupTreeCommit["genesis"]): Promise<void> {
        const nodeOperations: mongodb.AnyBulkWriteOperation[] = tree.nodes.map(node => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.nodeId(groupId, node.nodeIndex)},
                replacement: this.toNodeDoc(groupId, node, statement.seq),
                upsert: true,
            },
        }));
        const edgeOperations: mongodb.AnyBulkWriteOperation[] = tree.edges.map(edge => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.edgeId(groupId, edge)},
                replacement: this.toEdgeDoc(groupId, edge),
                upsert: true,
            },
        }));
        // A one-member group has no internal node at all — the member's own leaf is the root — so `nodes` is
        // legitimately empty here, and mongo rejects an empty bulkWrite.
        await Promise.all([
            GroupStateRepository.bulkWrite(this.nodes, nodeOperations),
            GroupStateRepository.bulkWrite(this.edges, edgeOperations),
            this.insertTreeCommit(groupId, statement, genesis),
        ]);
    }
    
    /** The records at the given indices — a lookup by derived id. A rotation reads the root alone this way. */
    async getNodesAt(groupId: types.group.GroupId, nodeIndices: number[]): Promise<types.cloud.GroupTreeNode[]> {
        if (nodeIndices.length === 0) {
            return [];
        }
        const ids = nodeIndices.map(nodeIndex => GroupStateRepository.nodeId(groupId, nodeIndex));
        const docs = await this.nodes.getMulti(ids);
        return docs.map(doc => this.toTreeNode(doc));
    }
    
    /**
     * Every node record of the group, filled and blank — what a commit is checked against. Only keyed nodes have
     * records, so this is at most `numLeaves / 2^BUCKET_LEVEL + 1` documents however the group is seated.
     */
    async getNodes(groupId: types.group.GroupId): Promise<types.cloud.GroupTreeNode[]> {
        const docs = await this.nodes.query(q => q.eq("groupId", groupId)).array();
        return docs.map(doc => this.toTreeNode(doc));
    }
    
    /**
     * The derived id of the grant edge a state holds: to the root, or straight to the sole member of a one-leaf
     * tree. Both are functions of the geometry, so the edge a commit supersedes is found without a scan.
     */
    static grantEdgeId(groupId: types.group.GroupId, numLeaves: number, leafAssignment: types.cloud.UserId[]) {
        const rootIndex = TreeMath.root(numLeaves);
        return GroupStateRepository.edgeId(groupId, TreeMath.isLeaf(rootIndex)
            ? {isGrantEdge: true, parentGeneration: 0, childKind: "user", childUserId: leafAssignment[0], data: "" as types.core.UserKeyData}
            : {isGrantEdge: true, parentGeneration: 0, childKind: "node", childIndex: rootIndex, data: "" as types.core.UserKeyData});
    }
    
    /**
     * Applies an accepted commit (`TreeTransitionValidator.validateCommit`) to a tree whose geometry before it was
     * `before`, together with the statement that vouches for it: every re-keyed record names it in `setBy`.
     * Every edge out of a blanked, re-keyed or un-keyed node goes, and so does the old grant edge; then the new
     * edges go in. That is enough to keep the stored edge set equal to what the state owes: an edge's parent is
     * its child's lowest filled keyed ancestor, and any change to what a filled node must wrap to — a seat taken
     * or vacated, a node blanked or re-keyed, the geometry grown — happens below a node that is itself in one of
     * those three sets. Nothing outside them can be stale, so nothing outside them is touched.
     *
     * Deletes run before inserts (one ordered bulk write), because a re-keyed node's new edges land on the ids of
     * the ones they replace.
     */
    async applyCommit(groupId: types.group.GroupId, before: {numLeaves: number, leafAssignment: types.cloud.UserId[]}, commit: TreeCommit,
        statement: types.cloud.GroupTreeCommitStatement): Promise<void> {
        const parents = [...new Set([...commit.blanked, ...commit.refreshed.map(node => node.nodeIndex), ...commit.unkeyed])];
        const edgeOperations: mongodb.AnyBulkWriteOperation[] = [
            {deleteMany: {filter: {groupId: groupId, parentIndex: {$in: parents}}}},
            {deleteOne: {filter: {_id: GroupStateRepository.grantEdgeId(groupId, before.numLeaves, before.leafAssignment)}}},
            ...commit.edges.map(edge => ({
                replaceOne: {
                    filter: {_id: GroupStateRepository.edgeId(groupId, edge)},
                    replacement: this.toEdgeDoc(groupId, edge),
                    upsert: true,
                },
            })),
        ];
        const nodeOperations: mongodb.AnyBulkWriteOperation[] = [
            ...commit.refreshed.map(node => ({
                replaceOne: {
                    filter: {_id: GroupStateRepository.nodeId(groupId, node.nodeIndex)},
                    replacement: this.toNodeDoc(groupId, node, statement.seq),
                    upsert: true,
                },
            })),
            // Blank keeps the record and its generation: whoever refills the node continues from there, so an edge
            // written under the old key can never name the new one's generation. No key, so nothing to vouch for.
            ...commit.blanked.map(nodeIndex => ({
                updateOne: {
                    filter: {_id: GroupStateRepository.nodeId(groupId, nodeIndex)},
                    update: {$unset: {publicKey: "", setBy: ""}},
                },
            })),
            // Un-keyed for good: the root only ever moves up, so the record can never be needed again.
            ...commit.unkeyed.map(nodeIndex => ({
                deleteOne: {filter: {_id: GroupStateRepository.nodeId(groupId, nodeIndex)}},
            })),
        ];
        await Promise.all([
            GroupStateRepository.bulkWrite(this.nodes, nodeOperations),
            GroupStateRepository.bulkWrite(this.edges, edgeOperations),
            this.insertTreeCommit(groupId, statement),
        ]);
    }
    
    /**
     * Stores a commit statement exactly as signed. An insert, not an upsert: `seq` is part of the commit's CAS, so
     * a second statement at the same seq can only be a bug, and should fail loudly rather than overwrite.
     */
    async insertTreeCommit(groupId: types.group.GroupId, statement: types.cloud.GroupTreeCommitStatement, genesis?: db.group.GroupTreeCommit["genesis"]): Promise<void> {
        await this.commits.insert({
            id: GroupStateRepository.treeCommitId(groupId, statement.seq),
            groupId: groupId,
            seq: statement.seq,
            statement: statement,
            ...(genesis ? {genesis} : {}),
        });
    }
    
    /** The statements at the given seqs, ascending — a lookup by derived id. Missing ones are simply absent. */
    async getTreeCommitsAt(groupId: types.group.GroupId, seqs: number[]): Promise<types.cloud.GroupTreeCommitStatement[]> {
        if (seqs.length === 0) {
            return [];
        }
        const docs = await this.commits.getMulti([...new Set(seqs)].map(seq => GroupStateRepository.treeCommitId(groupId, seq)));
        return docs.sort((a, b) => a.seq - b.seq).map(doc => doc.statement);
    }
    
    /** Statements with `fromSeq < seq <= toSeq`, ascending, at most `MAX_TREE_COMMITS_PER_PAGE` — one range read
     *  over the `{groupId, seq}` index. */
    async getTreeCommitRange(groupId: types.group.GroupId, fromSeq: number, toSeq: number): Promise<db.group.GroupTreeCommit[]> {
        return this.commits.query(q => q.and(q.eq("groupId", groupId), q.gt("seq", fromSeq), q.lte("seq", toSeq)))
            .sort("seq", true)
            .limit(GroupStateRepository.MAX_TREE_COMMITS_PER_PAGE)
            .array();
    }
    
    async insertHistoryEntry(entry: db.group.GroupHistoryEntry): Promise<void> {
        await this.history.insert(entry);
    }
    
    /** A commit's rungs, all by its committer. Keyed by span and author, so a rung re-submitted after a lost race
     *  (the transaction retried) replaces itself instead of duplicating. */
    async insertRungs(groupId: types.group.GroupId, author: types.cloud.UserId, rungs: types.cloud.GroupArchiveRungSubmission[]): Promise<void> {
        await GroupStateRepository.bulkWrite(this.rungs, rungs.map(rung => ({
            replaceOne: {
                filter: {_id: GroupStateRepository.rungId(groupId, rung, author)},
                replacement: this.toRungDoc(groupId, rung, author),
                upsert: true,
            },
        })));
    }
    
    /**
     * One repair rung: an insert, never an upsert, so nothing a member submits can replace or delete a stored rung
     * (an opener cannot swap its good rung for a bad one after others checked it). A second rung for the span by
     * the same author is a duplicate id, reported as `AUTHOR_HAS_RUNG`.
     */
    async insertRung(groupId: types.group.GroupId, author: types.cloud.UserId, rung: types.cloud.GroupArchiveRungSubmission): Promise<void> {
        try {
            await this.rungs.insert({id: GroupStateRepository.rungId(groupId, rung, author), ...this.toRungDoc(groupId, rung, author)});
        }
        catch (e) {
            if (e instanceof DbDuplicateError) {
                throw new AppException("GROUP_ARCHIVE_INVALID", {kind: "AUTHOR_HAS_RUNG", at: rung.atKeyVersion, target: rung.targetKeyVersion});
            }
            throw e;
        }
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
            this.publicMetaEntries.deleteMany(q => q.eq("groupId", groupId)),
            this.privateMetaEntries.deleteMany(q => q.eq("groupId", groupId)),
            this.rungs.deleteMany(q => q.eq("groupId", groupId)),
            this.commits.deleteMany(q => q.eq("groupId", groupId)),
            this.epochKeys.deleteMany(q => q.eq("groupId", groupId)),
        ]);
    }
    
    /** Pruned with its context (`deleteTombstonesOfContext`): context ids are Bridge uuids that never return, so no
     *  group can be created under a pruned id. */
    async markDeleted(groupId: types.group.GroupId, contextId: types.context.ContextId): Promise<void> {
        await this.tombstones.insert({id: groupId, contextId});
    }
    
    /** The tombstones of a deleted context's groups: nobody can create a group there any more, so they guard nothing. */
    async deleteTombstonesOfContext(contextId: types.context.ContextId): Promise<void> {
        await this.tombstones.deleteMany(q => q.eq("contextId", contextId));
    }
    
    async wasDeleted(groupId: types.group.GroupId): Promise<boolean> {
        return !!await this.tombstones.get(groupId);
    }
    
    // ── mapping ──────────────────────────────────────────────────────────────────────────────────────────────
    
    /** A blank node is served without `publicKey` or `setBy`, not with empty ones. */
    private toTreeNode(doc: db.group.GroupTreeNode): types.cloud.GroupTreeNode {
        return {
            nodeIndex: doc.nodeIndex,
            generation: doc.generation,
            ...(doc.publicKey ? {publicKey: doc.publicKey, ...(doc.setBy !== undefined ? {setBy: doc.setBy} : {})} : {}),
        };
    }
    
    /** A freshly keyed record, vouched for by statement `seq` — whatever `setBy` the request carried. */
    private toNodeDoc(groupId: types.group.GroupId, node: {nodeIndex: number, generation: number, publicKey?: types.core.EccPubKey}, seq: number): Omit<db.group.GroupTreeNode, "id"> {
        return {groupId: groupId, nodeIndex: node.nodeIndex, generation: node.generation, publicKey: node.publicKey, setBy: seq};
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
    
    private toRungDoc(groupId: types.group.GroupId, rung: types.cloud.GroupArchiveRungSubmission, author: types.cloud.UserId): Omit<db.group.GroupArchiveRung, "id"> {
        return {
            groupId: groupId,
            atKeyVersion: rung.atKeyVersion,
            targetKeyVersion: rung.targetKeyVersion,
            data: rung.data,
            author: author,
        };
    }
}
