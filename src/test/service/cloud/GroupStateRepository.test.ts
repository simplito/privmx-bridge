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
import { buildTree } from "../../testUtils/TreeFixtures";
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
}

function fakeRepository<K extends string, V>(docs: V[], captured: Captured) {
    const collection = createFake<mongodb.Collection>({
        bulkWrite: (async (operations: mongodb.AnyBulkWriteOperation[]) => {
            captured.operations.push(...operations);
            return {} as never;
        }) as never,
    });
    const sortable = {
        sort: () => sortable,
        array: async () => docs,
    };
    return createFake<MongoObjectRepository<K, V>>({
        collection: collection,
        getOptions: (() => ({})) as never,
        query: ((f: (q: MongoQuery<V>) => QueryResult) => {
            captured.filter = f(new MongoQuery<V>("id" as keyof V));
            return sortable;
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
    rungs?: db.group.GroupArchiveRung[],
} = {}) {
    const captured: Record<"nodes"|"edges"|"history"|"rungs", Captured> = {
        nodes: {filter: null, operations: []},
        edges: {filter: null, operations: []},
        history: {filter: null, operations: []},
        rungs: {filter: null, operations: []},
    };
    const repository = new GroupStateRepository(
        fakeRepository(docs.nodes ?? [], captured.nodes),
        fakeRepository(docs.edges ?? [], captured.edges),
        fakeRepository(docs.history ?? [], captured.history),
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
        data: "SomeGroupData" as types.group.GroupData,
        users: [],
        managers: ["janek" as types.cloud.UserId],
        version: 1 as types.group.GroupVersion,
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
