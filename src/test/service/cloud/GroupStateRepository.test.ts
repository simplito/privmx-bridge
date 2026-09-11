/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-empty-function */

import "q2-test";
import * as assert from "assert";
import * as mongodb from "mongodb";
import { GroupStateRepository } from "../../../service/cloud/GroupStateRepository";
import { MongoObjectRepository } from "../../../db/mongo/MongoObjectRepository";
import { MongoQuery } from "../../../db/mongo/MongoQuery";
import { QueryResult } from "../../../db/ObjectRepository";
import { createFake } from "../../testUtils/TestUtils";
import { buildTree, removalTransition } from "../../testUtils/TreeFixtures";
import { TreeMath } from "../../../service/cloud/keytree/TreeMath";
import * as types from "../../../types";
import * as db from "../../../db/Model";

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
        limit: () => chain,
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
        insert: (async () => {}) as never,
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
} = {}) {
    const captured: Record<"nodes"|"edges"|"history"|"publicMetaEntries"|"privateMetaEntries"|"rungs", Captured> = {
        nodes: {filter: null, operations: [], gets: []},
        edges: {filter: null, operations: [], gets: []},
        history: {filter: null, operations: [], gets: []},
        publicMetaEntries: {filter: null, operations: [], gets: []},
        privateMetaEntries: {filter: null, operations: [], gets: []},
        rungs: {filter: null, operations: [], gets: []},
    };
    const repository = new GroupStateRepository(
        fakeRepository(docs.nodes ?? [], captured.nodes),
        fakeRepository(docs.edges ?? [], captured.edges),
        fakeRepository(docs.history ?? [], captured.history),
        fakeRepository(docs.publicMetaEntries ?? [], captured.publicMetaEntries),
        fakeRepository(docs.privateMetaEntries ?? [], captured.privateMetaEntries),
        fakeRepository(docs.rungs ?? [], captured.rungs),
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
        publicKey: node.publicKey,
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
    await repository.writeTree(groupId, tree);
    assert.strictEqual(captured.nodes.operations.length, tree.nodes.length);
    assert.strictEqual(captured.edges.operations.length, tree.edges.length);
});

it("a one-member group is created even though it has no internal node", async () => {
    // numLeaves 1 means the member's own leaf is the root: no node keypairs at all, one grant edge wrapped
    // straight to them. The node batch is legitimately empty, and mongo refuses an empty bulkWrite.
    const tree = buildTree(["janek"], 1);
    assert.strictEqual(tree.nodes.length, 0, "a one-leaf tree has no internal node");
    const {repository, captured} = createStateRepository();
    await repository.writeTree(groupId, tree);
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
    assert.deepStrictEqual(Object.keys(loaded.nodes[0]).sort(), ["generation", "nodeIndex", "publicKey"]);
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

it("an unwindowed archive read asks only for the group", async () => {
    const {repository, captured} = createStateRepository({rungs: []});
    await repository.getArchiveRungs(groupId);
    assert.deepStrictEqual(captured.rungs.filter, {groupId: groupId});
});

it("pruning is a range delete over the epoch a rung points at", async () => {
    const {repository, captured} = createStateRepository();
    await repository.deleteRungsTargetingBelow(groupId, 4);
    assert.deepStrictEqual(captured.rungs.filter, {
        $and: [{groupId: groupId}, {targetKeyVersion: {$lt: 4}}],
    });
});

it("a rung is identified by the span it covers and its recipient, so re-submitting one cannot duplicate it", async () => {
    const rung: types.cloud.GroupArchiveRung = {
        atKeyVersion: 6,
        targetKeyVersion: 5,
        recipientKind: "epoch",
        data: "rung" as types.core.UserKeyData,
    };
    const {repository, captured} = createStateRepository();
    await repository.insertRungs(groupId, [rung, {...rung, data: "resubmitted" as types.core.UserKeyData}]);
    const ids = (captured.rungs.operations as unknown as {replaceOne: {filter: {_id: string}, upsert: boolean}}[])
        .map(op => op.replaceOne.filter._id);
    assert.strictEqual(ids[0], ids[1]);
    assert.strictEqual(ids[0], `${groupId}|6|5|epoch|`);
});

// ─────────────────────────────────────────────────────────────────────────────
// applying a removal delta
// ─────────────────────────────────────────────────────────────────────────────

it("a batch removal retires each departing member's own edge, whatever order they were named in", async () => {
    // The validator only requires `userIds` and `blankedPositions` to agree as sets, and the endpoint sorts the
    // seats while leaving the names in the caller's order. Pairing the two by index therefore deletes ids nobody
    // holds and leaves the real edges behind — addressed to members who no longer have a leaf.
    const tree = buildTree(SEATING, EPOCH);
    const alice = "alice" as types.cloud.UserId;
    const dave = "dave" as types.cloud.UserId;
    const seats = [tree.leafAssignment.indexOf(alice), tree.leafAssignment.indexOf(dave)];
    const {repository, captured} = createStateRepository({nodes: nodeDocs(tree), edges: edgeDocs(tree)});
    await repository.applyRemovalTransition(
        groupId,
        // Seats ascending, names in the opposite order: exactly what the client sends.
        removalTransition(tree, seats, EPOCH),
        [dave, alice],
        tree.numLeaves,
        tree.leafAssignment,
    );
    const deleted = (captured.edges.operations as unknown as {deleteOne?: {filter: {_id: string}}}[])
        .filter(op => op.deleteOne)
        .map(op => op.deleteOne!.filter._id);
    const edgeIdFor = (userId: types.cloud.UserId) => GroupStateRepository.edgeId(groupId, {
        parentIndex: TreeMath.parent(TreeMath.leafNode(tree.leafAssignment.indexOf(userId)), tree.numLeaves),
        parentGeneration: 0,
        childKind: "user",
        childUserId: userId,
        data: "" as types.core.UserKeyData,
    });
    assert.deepStrictEqual(deleted.sort(), [edgeIdFor(alice), edgeIdFor(dave)].sort());
    // And every id deleted is one that actually existed, rather than a mispaired seat/name combination.
    const stored = new Set(edgeDocs(tree).map(edge => edge.id));
    for (const id of deleted) {
        assert.ok(stored.has(id as never), `deleted ${id}, which no edge document ever had`);
    }
});
