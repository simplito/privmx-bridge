/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as assert from "assert";
import * as mongodb from "mongodb";
import { GroupStateRepository } from "../../../service/cloud/GroupStateRepository";
import { MongoObjectRepository } from "../../../db/mongo/MongoObjectRepository";
import { MongoQuery } from "../../../db/mongo/MongoQuery";
import { QueryResult } from "../../../db/ObjectRepository";
import { createFake } from "../../testUtils/TestUtils";
import { acceptedCommit, buildTree, PlanOp, planCommit } from "../../testUtils/TreeFixtures";
import { TreeValidator } from "../../../service/cloud/keytree/TreeValidator";
import { TreeHash } from "../../../service/cloud/keytree/TreeHash";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { AppException } from "../../../api/AppException";
import { DbDuplicateError } from "../../../error/DbDuplicateError";

/**
 * Moving the state out of the document is only worth anything if a change costs writes proportional to what
 * changed. These tests count the operations a transition produces.
 */

const groupId = "MyGroupId" as types.group.GroupId;
const otherGroupId = "OtherGroupId" as types.group.GroupId;
const SEATING = ["janek", "alice", "bob", "carol", "dave", "erin", "frank", "grace"];
const EPOCH = 5;

interface Captured {
    filter: QueryResult|null;
    operations: mongodb.AnyBulkWriteOperation[];
    /** Ids fetched by derived-id lookup, in call order — how the metadata planes are read. */
    gets: string[];
    /** Documents inserted one at a time — how a commit statement is stored. */
    inserted: unknown[];
    /** The last `limit` a query was given. */
    limit?: number;
}

function fakeRepository<K extends string, V>(docs: V[], captured: Captured) {
    const collection = createFake<mongodb.Collection>({
        bulkWrite: (async (operations: mongodb.AnyBulkWriteOperation[]) => {
            if (operations.length === 0) {
                // Exactly what the driver does, and the reason a one-member group used to 500 on create.
                throw new Error("Invalid BulkOperation, Batch cannot be empty");
            }
            captured.operations.push(...operations);
            return {} as never;
        }) as never,
    });
    // The whole builder the repository chains, not just `sort`: a head read is
    // `query(...).sort(...).limit(1).props(...).array()`, and a fake missing a link fails as a TypeError rather
    // than as the assertion the test is actually making.
    const chain = {
        sort: () => chain,
        limit: (n: number) => {
            captured.limit = n;
            return chain;
        },
        props: () => chain,
        array: async () => docs,
    };
    return createFake<MongoObjectRepository<K, V>>({
        collection: collection,
        getOptions: (() => ({})) as never,
        query: ((f: (q: MongoQuery<V>) => QueryResult) => {
            captured.filter = f(new MongoQuery<V>("id" as keyof V));
            return chain;
        }) as never,
        // A metadata plane is one row per group, so its head is a lookup by derived id rather than a query.
        get: (async (id: K) => {
            captured.gets.push(id);
            return docs[0] ?? null;
        }) as never,
        insert: (async (doc: V) => {
            captured.inserted.push(doc);
        }) as never,
        getMulti: (async (ids: K[]) => {
            captured.gets.push(...ids);
            return docs.filter(doc => ids.includes((doc as {id: K}).id));
        }) as never,
        deleteMany: ((f: (q: MongoQuery<V>) => QueryResult) => {
            captured.filter = f(new MongoQuery<V>("id" as keyof V));
        }) as never,
    });
}

function createStateRepository(docs: {
    nodes?: db.group.GroupTreeNode[],
    edges?: db.group.GroupTreeEdge[],
    history?: db.group.GroupHistoryEntry[],
    publicMetaEntries?: db.group.GroupPublicMetaEntry[],
    privateMetaEntries?: db.group.GroupPrivateMetaEntry[],
    rungs?: db.group.GroupArchiveRung[],
    commits?: db.group.GroupTreeCommit[],
    epochKeys?: db.group.GroupEpochKey[],
    tombstones?: db.group.GroupTombstone[],
} = {}) {
    const empty = (): Captured => ({filter: null, operations: [], gets: [], inserted: []});
    const captured: Record<"nodes"|"edges"|"history"|"publicMetaEntries"|"privateMetaEntries"|"rungs"|"commits"|"epochKeys"|"tombstones", Captured> = {
        nodes: empty(),
        edges: empty(),
        history: empty(),
        publicMetaEntries: empty(),
        privateMetaEntries: empty(),
        rungs: empty(),
        commits: empty(),
        epochKeys: empty(),
        tombstones: empty(),
    };
    const repository = new GroupStateRepository(
        fakeRepository(docs.nodes ?? [], captured.nodes),
        fakeRepository(docs.edges ?? [], captured.edges),
        fakeRepository(docs.history ?? [], captured.history),
        fakeRepository(docs.publicMetaEntries ?? [], captured.publicMetaEntries),
        fakeRepository(docs.privateMetaEntries ?? [], captured.privateMetaEntries),
        fakeRepository(docs.rungs ?? [], captured.rungs),
        fakeRepository(docs.commits ?? [], captured.commits),
        fakeRepository(docs.epochKeys ?? [], captured.epochKeys),
        fakeRepository(docs.tombstones ?? [], captured.tombstones),
    );
    return {repository, captured};
}

function groupDocument(tree: types.cloud.GroupTreeState): db.group.Group {
    return {
        id: groupId,
        contextId: "MyContextId" as types.context.ContextId,
        groupPubKey: "GroupPubKey" as unknown as types.cloud.GroupPubKey,
        createDate: 0 as types.core.Timestamp,
        creator: "janek" as types.cloud.UserId,
        lastModificationDate: 0 as types.core.Timestamp,
        lastModifier: "janek" as types.cloud.UserId,
        keyId: "SomeKeyId" as types.core.KeyId,
        users: [],
        managers: ["janek" as types.cloud.UserId],
        publicMetaVersion: 1 as types.group.GroupVersion,
        privateMetaVersion: 1 as types.group.GroupVersion,
        rosterVersion: 1,
        keyVersion: 1,
        eraFloor: 1,
        numLeaves: tree.numLeaves,
        leafAssignment: tree.leafAssignment,
    };
}

function nodeDocs(tree: types.cloud.GroupTreeState, id = groupId): db.group.GroupTreeNode[] {
    return tree.nodes.map(node => ({
        id: GroupStateRepository.nodeId(id, node.nodeIndex),
        groupId: id,
        nodeIndex: node.nodeIndex,
        generation: node.generation,
        ...(node.publicKey ? {publicKey: node.publicKey, setBy: node.setBy} : {}),
    }));
}

function edgeDocs(tree: types.cloud.GroupTreeState, id = groupId): db.group.GroupTreeEdge[] {
    return tree.edges.map(edge => ({
        id: GroupStateRepository.edgeId(id, edge),
        groupId: id,
        ...edge,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// writing a tree
// ─────────────────────────────────────────────────────────────────────────────

it("a group being created writes its whole tree", async () => {
    const tree = buildTree(SEATING, 1);
    const {repository, captured} = createStateRepository();
    await repository.writeTree(groupId, tree, statement(1), {users: ["alice" as types.cloud.UserId], managers: []});
    assert.strictEqual(captured.nodes.operations.length, tree.nodes.length);
    assert.strictEqual(captured.edges.operations.length, tree.edges.length);
    // Every record of a fresh tree is vouched for by the creation statement, which is stored beside it.
    const written = captured.nodes.operations as unknown as {replaceOne: {replacement: {setBy: number}}}[];
    assert.ok(written.every(op => op.replaceOne.replacement.setBy === 1));
    assert.deepStrictEqual(captured.commits.inserted, [{id: `${groupId}|1`, groupId, seq: 1, statement: statement(1), genesis: {users: ["alice" as types.cloud.UserId], managers: []}}]);
});

it("a one-member group is created even though it has no internal node", async () => {
    // numLeaves 1 means the member's own leaf is the root: no node keypairs at all, one grant edge wrapped
    // straight to them. The node batch is legitimately empty, and mongo refuses an empty bulkWrite.
    const tree = buildTree(["janek"], 1);
    assert.strictEqual(tree.nodes.length, 0, "a one-leaf tree has no internal node");
    const {repository, captured} = createStateRepository();
    await repository.writeTree(groupId, tree, statement(1), {users: ["janek" as types.cloud.UserId], managers: []});
    assert.strictEqual(captured.nodes.operations.length, 0);
    assert.strictEqual(captured.edges.operations.length, tree.edges.length);
});

it("node identity is the seat, not the generation, so a refresh is an update", async () => {
    assert.strictEqual(GroupStateRepository.nodeId(groupId, 7), `${groupId}|7`);
    assert.notStrictEqual(GroupStateRepository.nodeId(groupId, 7), GroupStateRepository.nodeId(otherGroupId, 7));
});

// ─────────────────────────────────────────────────────────────────────────────
// reading it back
// ─────────────────────────────────────────────────────────────────────────────

it("the tree comes back in the shape the validator has always been given", async () => {
    const tree = buildTree(SEATING, EPOCH);
    const {repository} = createStateRepository({nodes: nodeDocs(tree), edges: edgeDocs(tree)});
    const loaded = await repository.getTree(groupDocument(tree));
    assert.ok(loaded);
    assert.strictEqual(loaded.numLeaves, tree.numLeaves);
    assert.deepStrictEqual(loaded.leafAssignment, tree.leafAssignment);
    assert.strictEqual(loaded.nodes.length, tree.nodes.length);
    assert.strictEqual(loaded.edges.length, tree.edges.length);
    // Storage detail stays in storage: a served node is exactly the three public fields.
    assert.deepStrictEqual(Object.keys(loaded.nodes[0]).sort(), ["generation", "nodeIndex", "publicKey", "setBy"]);
    assert.strictEqual(loaded.edges.some(edge => "groupId" in edge || "id" in edge), false);
    assert.strictEqual(loaded.edges.filter(edge => edge.isGrantEdge).length, 1);
});

it("nodes come back in index order whatever order they were written in", async () => {
    const tree = buildTree(SEATING, EPOCH);
    const {repository} = createStateRepository({nodes: [...nodeDocs(tree)].reverse(), edges: edgeDocs(tree)});
    const loaded = await repository.getTree(groupDocument(tree));
    const indices = loaded!.nodes.map(node => node.nodeIndex);
    assert.deepStrictEqual(indices, [...indices].sort((a, b) => a - b));
});

it("a group whose collections are empty reads back an empty tree, not a missing one", async () => {
    // The geometry lives on the document, so `getTree` always answers; it is the service that refuses to plan
    // against a tree with no nodes.
    const tree = buildTree(SEATING, EPOCH);
    const {repository} = createStateRepository();
    const loaded = await repository.getTree(groupDocument(tree));
    assert.strictEqual(loaded.nodes.length, 0);
    assert.strictEqual(loaded.numLeaves, tree.numLeaves);
});

it("the archive is read through a windowed query, not filtered after loading", async () => {
    // Descending twenty epochs must read twenty documents, whatever the size of the archive.
    const {repository, captured} = createStateRepository({rungs: []});
    await repository.getArchiveRungs(groupId, 880, 900);
    assert.deepStrictEqual(captured.rungs.filter, {
        $and: [
            {groupId: groupId},
            {atKeyVersion: {$gte: 880}},
            {atKeyVersion: {$lte: 900}},
        ],
    });
});

it("each metadata plane is read from its own collection, by its own derived id", async () => {
    // With two collections a forgotten plane is a compile error; with one and a discriminator it would be a
    // silent wrong answer. This pins that the two reads really are separate, and that each asks for the id
    // belonging to its own plane — swapping the two derivations is the mistake this catches.
    const {repository, captured} = createStateRepository({publicMetaEntries: [], privateMetaEntries: []});
    await repository.getMetaHeadKeyVersions(groupId);
    assert.deepStrictEqual(captured.publicMetaEntries.gets, [`${groupId}|publicMeta`]);
    assert.deepStrictEqual(captured.privateMetaEntries.gets, [`${groupId}|privateMeta`]);
});

it("each metadata plane's head is one lookup, not a sort over the plane", async () => {
    // One row per group, so there is nothing to sort: a query here would mean the version-derived ids came
    // back, and with them rows no reader can reach.
    const {repository, captured} = createStateRepository({publicMetaEntries: [], privateMetaEntries: []});
    await repository.getPublicMetaHead(groupId);
    await repository.getPrivateMetaHead(groupId);
    assert.strictEqual(captured.publicMetaEntries.filter, null);
    assert.strictEqual(captured.privateMetaEntries.filter, null);
    assert.deepStrictEqual(captured.publicMetaEntries.gets, [`${groupId}|publicMeta`]);
    assert.deepStrictEqual(captured.privateMetaEntries.gets, [`${groupId}|privateMeta`]);
});

it("deleting a group's state leaves neither metadata plane behind", async () => {
    // Entries are keyed by groupId, so a leftover both leaks the group's shape and never reclaims the space.
    const {repository, captured} = createStateRepository();
    await repository.deleteState(groupId);
    assert.deepStrictEqual(captured.publicMetaEntries.filter, {groupId: groupId});
    assert.deepStrictEqual(captured.privateMetaEntries.filter, {groupId: groupId});
});

it("epoch rows: one per (group, epoch), read in order, cut as a range below the floor, deleted with the group", async () => {
    const {repository, captured} = createStateRepository({epochKeys: []});
    await repository.getEpochKeys(groupId);
    assert.deepStrictEqual(captured.epochKeys.filter, {groupId: groupId});
    await repository.deleteEpochKeysBelow(groupId, 4);
    assert.deepStrictEqual(captured.epochKeys.filter, {$and: [{groupId: groupId}, {keyVersion: {$lt: 4}}]});
    await repository.deleteState(groupId);
    assert.deepStrictEqual(captured.epochKeys.filter, {groupId: groupId});
});

it("SECURITY: a new epoch's key is looked up among every statement of the group, which no era cut removes", async () => {
    // Epoch rows go below the floor (`cutEra`, `abandonHistory`), so a check against them forgot every key down
    // there — keys every member of those epochs, removed ones included, holds the private half of.
    const key = "EarlierGroupPubKey" as unknown as types.cloud.GroupPubKey;
    const {repository, captured} = createStateRepository({commits: [{id: GroupStateRepository.treeCommitId(groupId, 1)} as db.group.GroupTreeCommit]});
    assert.strictEqual(await repository.hasEpochWithGroupPubKey(groupId, key), true);
    assert.deepStrictEqual(captured.commits.filter, {$and: [{groupId: groupId}, {"statement.groupPubKey": key}]});
    assert.strictEqual(captured.commits.limit, 1, "the first hit answers it");
    assert.strictEqual(captured.epochKeys.filter, null, "epoch rows are not consulted");
    const fresh = createStateRepository();
    assert.strictEqual(await fresh.repository.hasEpochWithGroupPubKey(groupId, key), false);
});

it("SECURITY: the roster trail is served a bounded page at a time, oldest first", async () => {
    // Entries carry up to 1 MB each; an unbounded read of a long-lived group's trail ran a worker out of memory.
    const {repository, captured} = createStateRepository({history: [{version: 3} as unknown as db.group.GroupHistoryEntry]});
    await repository.getHistory(groupId, 1);
    assert.deepStrictEqual(captured.history.filter, {$and: [{groupId: groupId}, {version: {$gte: 1}}]});
    assert.strictEqual(captured.history.limit, GroupStateRepository.MAX_HISTORY_PAGE);
});

it("an unwindowed archive read asks only for the group", async () => {
    const {repository, captured} = createStateRepository({rungs: []});
    await repository.getArchiveRungs(groupId);
    assert.deepStrictEqual(captured.rungs.filter, {groupId: groupId});
});

it("every archive window, closed ones too, is served a bounded page of rungs and of epoch rows", async () => {
    for (const [from, to] of [[undefined, undefined], [2, undefined], [undefined, 5], [2, 5], [1, 1000000]]) {
        const {repository, captured} = createStateRepository({rungs: [], epochKeys: []});
        await repository.getArchiveRungs(groupId, from, to);
        assert.strictEqual(captured.rungs.limit, GroupStateRepository.MAX_ARCHIVE_RUNGS_PER_PAGE, `rungs [${from}, ${to}]`);
        await repository.getEpochKeys(groupId, from, to);
        assert.strictEqual(captured.epochKeys.limit, GroupStateRepository.MAX_EPOCH_KEYS_PER_PAGE, `epoch rows [${from}, ${to}]`);
    }
});

it("a windowed archive read puts the window and the floor into the query", async () => {
    const {repository, captured} = createStateRepository({rungs: [], epochKeys: []});
    await repository.getArchiveRungs(groupId, 2, 5, 3);
    assert.deepStrictEqual(captured.rungs.filter, {$and: [{groupId: groupId}, {atKeyVersion: {$gte: 2}}, {atKeyVersion: {$lte: 5}}, {targetKeyVersion: {$gte: 3}}]});
    await repository.getEpochKeys(groupId, 2, 5);
    assert.deepStrictEqual(captured.epochKeys.filter, {$and: [{groupId: groupId}, {keyVersion: {$gte: 2}}, {keyVersion: {$lte: 5}}]});
});

it("a spans read asks for exactly those spans above the floor, and nothing for no spans", async () => {
    const {repository, captured} = createStateRepository({rungs: []});
    await repository.getArchiveRungsForSpans(groupId, [{at: 8, target: 4}, {at: 4, target: 3}], 2);
    assert.deepStrictEqual(captured.rungs.filter, {$and: [
        {groupId: groupId},
        {$or: [{$and: [{atKeyVersion: 8}, {targetKeyVersion: 4}]}, {$and: [{atKeyVersion: 4}, {targetKeyVersion: 3}]}]},
        {targetKeyVersion: {$gte: 2}},
    ]});
    const none = createStateRepository({rungs: []});
    assert.deepStrictEqual(await none.repository.getArchiveRungsForSpans(groupId, []), []);
    assert.strictEqual(none.captured.rungs.filter, null, "no query");
});

it("epoch rows are read by epoch list, and found by keyId and by grant key off their indexes", async () => {
    const {repository, captured} = createStateRepository({epochKeys: []});
    await repository.getEpochKeysAt(groupId, [3, 9]);
    assert.deepStrictEqual(captured.epochKeys.filter, {$and: [{groupId: groupId}, {keyVersion: {$in: [3, 9]}}]});
    const keyId = "k" as types.core.KeyId;
    const pubKey = "pk" as types.cloud.GroupPubKey;
    const byKeyId = createStateRepository({epochKeys: []});
    await byKeyId.repository.findEpochKeys(groupId, [keyId], []);
    assert.deepStrictEqual(byKeyId.captured.epochKeys.filter, {$and: [{groupId: groupId}, {"groupKey.keyId": {$in: [keyId]}}]});
    const byPubKey = createStateRepository({epochKeys: []});
    await byPubKey.repository.findEpochKeys(groupId, [], [pubKey]);
    assert.deepStrictEqual(byPubKey.captured.epochKeys.filter, {$and: [{groupId: groupId}, {groupPubKey: {$in: [pubKey]}}]});
    const neither = createStateRepository({epochKeys: []});
    assert.deepStrictEqual(await neither.repository.findEpochKeys(groupId, [], []), []);
    assert.strictEqual(neither.captured.epochKeys.filter, null, "no query");
});

it("an epoch found both by keyId and by grant key is served once, ascending", async () => {
    const rows = [{keyVersion: 7}, {keyVersion: 2}] as db.group.GroupEpochKey[];
    const {repository} = createStateRepository({epochKeys: rows});
    const found = await repository.findEpochKeys(groupId, ["k" as types.core.KeyId], ["pk" as types.cloud.GroupPubKey]);
    assert.deepStrictEqual(found.map(row => row.keyVersion), [2, 7]);
});

it("a repair rung is one insert under its author's id, and a second one by that author is AUTHOR_HAS_RUNG", async () => {
    const rung: types.cloud.GroupArchiveRungSubmission = {atKeyVersion: 6, targetKeyVersion: 5, data: "repair" as types.core.UserKeyData};
    const {repository, captured} = createStateRepository();
    await repository.insertRung(groupId, "bob" as types.cloud.UserId, rung);
    assert.deepStrictEqual(captured.rungs.inserted, [{id: `${groupId}|6|5|bob`, groupId, atKeyVersion: 6, targetKeyVersion: 5, data: "repair", author: "bob"}]);
    assert.deepStrictEqual(captured.rungs.operations, [], "never an upsert: nothing stored is replaced");
    
    const duplicate = createStateRepository();
    (duplicate.repository as unknown as {rungs: {insert: () => Promise<void>}}).rungs.insert = async () => {
        throw new DbDuplicateError();
    };
    await assert.rejects(() => duplicate.repository.insertRung(groupId, "bob" as types.cloud.UserId, rung),
        (e: unknown) => AppException.is(e, "GROUP_ARCHIVE_INVALID") && (e as AppException).getData()?.kind === "AUTHOR_HAS_RUNG");
});

it("the rungs of one span are read by span", async () => {
    const {repository, captured} = createStateRepository({rungs: []});
    await repository.getRungsAt(groupId, 6, 5);
    assert.deepStrictEqual(captured.rungs.filter, {$and: [{groupId: groupId}, {atKeyVersion: 6}, {targetKeyVersion: 5}]});
});

it("pruning is a range delete over the epoch a rung points at", async () => {
    const {repository, captured} = createStateRepository();
    await repository.deleteRungsTargetingBelow(groupId, 4);
    assert.deepStrictEqual(captured.rungs.filter, {
        $and: [{groupId: groupId}, {targetKeyVersion: {$lt: 4}}],
    });
});

it("a rung is identified by the span it covers and its author, so re-submitting one cannot duplicate it", async () => {
    const rung: types.cloud.GroupArchiveRungSubmission = {
        atKeyVersion: 6,
        targetKeyVersion: 5,
        data: "rung" as types.core.UserKeyData,
    };
    const {repository, captured} = createStateRepository();
    await repository.insertRungs(groupId, "alice" as types.cloud.UserId, [rung, {...rung, data: "resubmitted" as types.core.UserKeyData}]);
    const operations = captured.rungs.operations as unknown as {replaceOne: {filter: {_id: string}, replacement: db.group.GroupArchiveRung, upsert: boolean}}[];
    const ids = operations.map(op => op.replaceOne.filter._id);
    assert.strictEqual(ids[0], ids[1]);
    assert.strictEqual(ids[0], `${groupId}|6|5|alice`);
    // The author is the bridge's: whoever the caller of the commit was, never a field the client sent.
    assert.strictEqual(operations[0].replaceOne.replacement.author, "alice");
});

it("rungs of one span from two authors are two rows", async () => {
    const rung: types.cloud.GroupArchiveRungSubmission = {atKeyVersion: 6, targetKeyVersion: 5, data: "rung" as types.core.UserKeyData};
    const {repository, captured} = createStateRepository();
    await repository.insertRungs(groupId, "alice" as types.cloud.UserId, [rung]);
    await repository.insertRungs(groupId, "bob" as types.cloud.UserId, [rung]);
    const ids = (captured.rungs.operations as unknown as {replaceOne: {filter: {_id: string}}}[]).map(op => op.replaceOne.filter._id);
    assert.deepStrictEqual(ids, [`${groupId}|6|5|alice`, `${groupId}|6|5|bob`]);
});

// ─────────────────────────────────────────────────────────────────────────────
// applying a commit
// ─────────────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>&{_id: string};

/**
 * Plays the captured bulk operations against an in-memory collection — the four shapes `applyCommit` emits and
 * nothing more — so a test can read back what mongo would hold.
 */
function playOperations(docs: Map<string, Doc>, operations: mongodb.AnyBulkWriteOperation[]) {
    for (const op of operations as Record<string, {filter: Record<string, unknown>, replacement?: Doc, update?: {$unset: Record<string, string>}}>[]) {
        if (op.deleteMany) {
            const {groupId: g, parentIndex} = op.deleteMany.filter as {groupId: string, parentIndex: {$in: number[]}};
            for (const [id, doc] of docs) {
                if (doc.groupId === g && parentIndex.$in.includes(doc.parentIndex as number)) {
                    docs.delete(id);
                }
            }
        }
        else if (op.deleteOne) {
            docs.delete(op.deleteOne.filter._id as string);
        }
        else if (op.replaceOne) {
            docs.set(op.replaceOne.filter._id as string, {...op.replaceOne.replacement!, _id: op.replaceOne.filter._id as string});
        }
        else if (op.updateOne) {
            const doc = docs.get(op.updateOne.filter._id as string);
            if (doc) {
                for (const field of Object.keys(op.updateOne.update!.$unset)) {
                    delete doc[field];
                }
            }
        }
        else {
            throw new Error(`unexpected operation ${JSON.stringify(op)}`);
        }
    }
}

/** What the collections hold for `tree`, keyed by derived id. */
function storedDocs(tree: types.cloud.GroupTreeState) {
    return {
        nodes: new Map<string, Doc>(nodeDocs(tree).map(({id, ...doc}) => [id, {...doc, _id: id}])),
        edges: new Map<string, Doc>(edgeDocs(tree).map(({id, ...doc}) => [id, {...doc, _id: id}])),
    };
}

function readBack(docs: {nodes: Map<string, Doc>, edges: Map<string, Doc>}, numLeaves: number, leafAssignment: types.cloud.UserId[]): types.cloud.GroupTreeState {
    return {
        numLeaves,
        leafAssignment,
        nodes: [...docs.nodes.values()].map(doc => ({
            nodeIndex: doc.nodeIndex as number,
            generation: doc.generation as number,
            ...(doc.publicKey ? {publicKey: doc.publicKey as types.core.EccPubKey} : {}),
            ...(doc.setBy !== undefined ? {setBy: doc.setBy as number} : {}),
        })),
        edges: [...docs.edges.values()].map(({_id, groupId: _g, ...edge}) => edge as unknown as types.cloud.GroupTreeEdge),
    };
}

/** Validates `op` on `tree` with the production validator and applies it through the repository. */
async function commitThroughStorage(tree: types.cloud.GroupTreeState, keyVersion: number, op: PlanOp, docs = storedDocs(tree)) {
    const {plan, commit} = acceptedCommit(tree, keyVersion, op);
    const {repository, captured} = createStateRepository();
    await repository.applyCommit(groupId, tree, commit, statement(plan.seq));
    playOperations(docs.nodes, captured.nodes.operations);
    playOperations(docs.edges, captured.edges.operations);
    return {plan, commit, captured, docs, after: readBack(docs, commit.numLeaves, commit.leafAssignment), keyVersion: commit.keyVersion};
}

/** A stored statement; its content is the service's business, the repository only files it. */
function statement(seq: number): types.cloud.GroupTreeCommitStatement {
    return {
        seq, prevDigest: "", op: seq === 1 ? "create" : "selfUpdate", groupId, treeVersion: 2, date: 0, keyVersion: 1, groupPubKey: "pk" as types.cloud.GroupPubKey,
        rosterVersion: 1, rosterHash: "00".repeat(32), treeHash: "00".repeat(32), policyHash: "00".repeat(32), committer: "janek" as types.cloud.UserId,
        committerPubKey: "pub" as types.cloud.UserPubKey, committerSeat: 0, path: [], addedUsers: [], addedManagers: [], removed: [], signature: "sig" as types.core.EccSignature,
    };
}

function rosterOf(tree: types.cloud.GroupTreeState) {
    return {users: tree.leafAssignment.filter(u => u !== ""), managers: [] as types.cloud.UserId[]};
}

const WIDE = Array.from({length: 64}, (_, i) => `u${i}`);

it("a commit drops the edges out of every node it blanks or re-keys, and the old grant edge, before writing", async () => {
    const tree = planCommit(buildTree(WIDE, EPOCH), EPOCH, {kind: "selfUpdate", committer: "u40"}).after;
    const {captured} = await commitThroughStorage(tree, EPOCH, {kind: "remove", committer: "u0", removed: ["u41"]});
    const [dropOut, dropGrant, ...writes] = captured.edges.operations as unknown as Record<string, {filter: Record<string, unknown>}>[];
    assert.deepStrictEqual(dropOut.deleteMany.filter, {groupId: groupId, parentIndex: {$in: [95, 31, 63]}});
    assert.deepStrictEqual(dropGrant.deleteOne.filter, {_id: `${groupId}|grant>node:63`});
    assert.ok(writes.every(op => op.replaceOne), "only writes after the deletes");
});

it("a blanked node keeps its record and generation and loses its key and its seq", async () => {
    const tree = planCommit(buildTree(WIDE, EPOCH), EPOCH, {kind: "selfUpdate", committer: "u40"}).after;
    const {captured, after} = await commitThroughStorage(tree, EPOCH, {kind: "remove", committer: "u0", removed: ["u41"]});
    assert.ok((captured.nodes.operations as unknown as Record<string, unknown>[]).some(op =>
        JSON.stringify(op) === JSON.stringify({updateOne: {filter: {_id: `${groupId}|95`}, update: {$unset: {publicKey: "", setBy: ""}}}})));
    assert.deepStrictEqual(after.nodes.find(node => node.nodeIndex === 95), {nodeIndex: 95, generation: 1});
});

it("SECURITY: after a removal the stored edges are exactly what the state owes — nothing a blanked key could open", async () => {
    const tree = planCommit(buildTree(WIDE, EPOCH), EPOCH, {kind: "selfUpdate", committer: "u40"}).after;
    const {after, plan} = await commitThroughStorage(tree, EPOCH, {kind: "remove", committer: "u0", removed: ["u41"]});
    assert.deepStrictEqual(TreeValidator.validateState(after, rosterOf(after), EPOCH + 1), []);
    assert.deepStrictEqual(after.edges.map(edge => GroupStateRepository.edgeId(groupId, edge)).sort(),
        plan.after.edges.map(edge => GroupStateRepository.edgeId(groupId, edge)).sort());
    assert.ok(!after.edges.some(edge => edge.parentIndex === 95), "no wrap out of the blanked node survives");
});

it("growth that un-keys the old root deletes its record and its edges", async () => {
    const tree = buildTree(WIDE.slice(0, 16), EPOCH);
    const {captured, after} = await commitThroughStorage(tree, EPOCH, {kind: "add", committer: "u3", members: ["new"], positions: [16]});
    assert.ok((captured.nodes.operations as unknown as Record<string, unknown>[]).some(op =>
        JSON.stringify(op) === JSON.stringify({deleteOne: {filter: {_id: `${groupId}|15`}}})));
    assert.deepStrictEqual(after.nodes.map(node => node.nodeIndex), [31]);
    assert.deepStrictEqual(TreeValidator.validateState(after, rosterOf(after), EPOCH), []);
});

it("growing a one-member group replaces the grant edge addressed to the member", async () => {
    const tree = buildTree(["janek"], EPOCH);
    const {captured, after} = await commitThroughStorage(tree, EPOCH, {kind: "add", committer: "janek", members: ["alice"], positions: [1]});
    const dropGrant = (captured.edges.operations as unknown as Record<string, {filter: Record<string, unknown>}>[])[1];
    assert.deepStrictEqual(dropGrant.deleteOne.filter, {_id: `${groupId}|grant>user:janek`});
    assert.deepStrictEqual(TreeValidator.validateState(after, rosterOf(after), EPOCH), []);
});

it("a one-leaf self-update replaces the grant edge to the sole member in one ordered write", async () => {
    // A sole member renewing its leaf after an identity key change: no node to refresh, only the grant edge.
    const tree = buildTree(["janek"], EPOCH);
    const before = tree.edges.find(edge => edge.isGrantEdge)!;
    const {captured, after, commit} = await commitThroughStorage(tree, EPOCH, {kind: "selfUpdate", committer: "janek"});
    const grantId = `${groupId}|grant>user:janek`;
    const ops = captured.edges.operations as unknown as Record<string, {filter: Record<string, unknown>, replacement?: Record<string, unknown>, upsert?: boolean}>[];
    const dropAt = ops.findIndex(op => op.deleteOne?.filter._id === grantId);
    const writeAt = ops.findIndex(op => op.replaceOne?.filter._id === grantId);
    assert.ok(dropAt >= 0 && writeAt > dropAt, "the old grant edge is dropped before the new one is written");
    assert.strictEqual(ops[writeAt].replaceOne.upsert, true);
    const written = commit.edges.find(edge => edge.isGrantEdge)!;
    assert.strictEqual(ops[writeAt].replaceOne.replacement!.data, written.data);
    assert.notStrictEqual(written.data, before.data, "the new blob, not the old one");
    assert.deepStrictEqual(captured.nodes.operations, [], "no node operation");
    assert.deepStrictEqual(after.edges.map(edge => edge.data), [written.data]);
    assert.deepStrictEqual(TreeValidator.validateState(after, rosterOf(after), EPOCH), []);
});

it("a long random history applied through storage stays exactly the owed state", async () => {
    let tree = buildTree(WIDE.slice(0, 40), 1);
    let keyVersion = 1;
    let docs = storedDocs(tree);
    let seed = 7;
    const random = (bound: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % bound;
    };
    for (let step = 0; step < 60; step++) {
        const members = tree.leafAssignment.filter(u => u !== "");
        const committer = members[random(members.length)];
        const others = members.filter(m => m !== committer);
        const roll = random(3);
        const blank = tree.leafAssignment.indexOf("" as types.cloud.UserId);
        const op: PlanOp = roll === 0 && others.length > 1
            ? {kind: "remove", committer, removed: [others[random(others.length)]]}
            : roll === 1
                ? {kind: "add", committer, members: [`n${step}`], positions: [blank >= 0 ? blank : tree.numLeaves]}
                : {kind: "selfUpdate", committer};
        const result = await commitThroughStorage(tree, keyVersion, op, docs);
        ({after: tree, keyVersion, docs} = result);
        assert.deepStrictEqual(TreeValidator.validateState(tree, rosterOf(tree), keyVersion), [], `step ${step}: ${JSON.stringify(op)}`);
        // `setBy` included: what storage holds hashes to what the committer signed.
        assert.strictEqual(TreeHash.treeHash(TreeHash.of(tree)).toString("hex"), TreeHash.treeHash(TreeHash.of(result.plan.after)).toString("hex"), `step ${step}`);
    }
});

it("a commit files its statement and stamps the re-keyed records with its seq; a blank record loses both key and seq", async () => {
    const tree = planCommit(buildTree(WIDE, EPOCH), EPOCH, {kind: "selfUpdate", committer: "u40"}).after;
    const {captured, after, plan} = await commitThroughStorage(tree, EPOCH, {kind: "remove", committer: "u0", removed: ["u41"]});
    assert.strictEqual(plan.seq, 3);
    assert.deepStrictEqual(captured.commits.inserted, [{id: `${groupId}|3`, groupId, seq: 3, statement: statement(3)}]);
    assert.deepStrictEqual(after.nodes.find(node => node.nodeIndex === 63)?.setBy, 3);
    assert.deepStrictEqual(after.nodes.find(node => node.nodeIndex === 95), {nodeIndex: 95, generation: 1});
});

it("statements are read by derived id, or as one seq range over the group's index", async () => {
    const docs = [1, 2, 3].map(seq => ({id: GroupStateRepository.treeCommitId(groupId, seq), groupId, seq, statement: statement(seq)}));
    const {repository, captured} = createStateRepository({commits: docs});
    const at = await repository.getTreeCommitsAt(groupId, [3, 1, 3]);
    assert.deepStrictEqual(at.map(cs => cs.seq), [1, 3], "deduplicated and ascending");
    assert.deepStrictEqual(captured.commits.gets, [`${groupId}|3`, `${groupId}|1`]);
    await repository.getTreeCommitRange(groupId, 1, 3);
    assert.deepStrictEqual(captured.commits.filter, {$and: [{groupId: groupId}, {seq: {$gt: 1}}, {seq: {$lte: 3}}]});
});

