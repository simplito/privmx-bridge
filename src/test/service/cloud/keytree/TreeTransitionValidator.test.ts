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
import { StoredPathState, TreeTransitionValidator } from "../../../../service/cloud/keytree/TreeTransitionValidator";
import { TreeMath } from "../../../../service/cloud/keytree/TreeMath";
import { additionTransition, buildTree } from "../../../testUtils/TreeFixtures";
import * as types from "../../../../types";

/**
 * A removal submitted as a delta, checked against what the bridge holds.
 *
 * The whole-tree validator gets its safety from re-checking everything on every write. A delta cannot do that, so
 * it rests on two things instead: the preconditions it names (the epoch and the generation of every node it
 * refreshes), and the completeness of what it owes for the path it touches. These tests are that argument —
 * anything the whole-tree validator would refuse must be refused here too, or a client gains by switching shape.
 */

const SEATING = ["janek", "alice", "bob", "carol", "dave", "erin", "frank", "grace"];
const EPOCH = 5;
const BOB = "bob" as types.cloud.UserId;
const BOB_POSITION = 2;

/** The stored state: the tree the bridge holds, reduced to what a removal at `position` is checked against. */
function stored(position = BOB_POSITION, overrides: Partial<StoredPathState> = {}): StoredPathState {
    const tree = buildTree(SEATING, EPOCH);
    const needed = new Set(TreeTransitionValidator.nodesNeededFor(position, tree.numLeaves));
    return {
        numLeaves: tree.numLeaves,
        leafAssignment: tree.leafAssignment,
        keyVersion: EPOCH,
        nodes: tree.nodes.filter(node => needed.has(node.nodeIndex)),
        ...overrides,
    };
}

/** What an honest client submits: the path refreshed, the edges that refresh owes, the grant edge re-linked. */
function honestTransition(state: StoredPathState = stored(), position = BOB_POSITION): types.cloud.GroupTreeTransition {
    const path = TreeMath.directPath(position, state.numLeaves);
    const generationOf = (nodeIndex: number) => state.nodes.find(n => n.nodeIndex === nodeIndex)?.generation ?? 0;
    const refreshedNodes = path.map(nodeIndex => ({
        nodeIndex,
        fromGeneration: generationOf(nodeIndex),
        generation: generationOf(nodeIndex) + 1,
        publicKey: `pk:${nodeIndex}g${generationOf(nodeIndex) + 1}` as types.core.EccPubKey,
    }));
    const newGenerationOf = (nodeIndex: number) =>
        refreshedNodes.find(n => n.nodeIndex === nodeIndex)?.generation ?? generationOf(nodeIndex);
    const blankedLeaf = TreeMath.leafNode(position);
    const seating = [...state.leafAssignment];
    seating[position] = "" as types.cloud.UserId;
    
    const edges: types.cloud.GroupTreeEdge[] = [];
    for (const parentIndex of path) {
        for (const childIndex of TreeMath.children(parentIndex, state.numLeaves)) {
            if (childIndex === blankedLeaf) {
                continue;
            }
            if (TreeMath.isLeaf(childIndex)) {
                const holder = seating[TreeMath.leafPosition(childIndex)];
                if (!holder) {
                    continue;
                }
                edges.push({
                    parentIndex,
                    parentGeneration: newGenerationOf(parentIndex),
                    childKind: "user",
                    childUserId: holder,
                    data: `wrap:${parentIndex}->${holder}` as types.core.UserKeyData,
                });
                continue;
            }
            edges.push({
                parentIndex,
                parentGeneration: newGenerationOf(parentIndex),
                childKind: "node",
                childIndex,
                childGeneration: newGenerationOf(childIndex),
                data: `wrap:${parentIndex}->${childIndex}` as types.core.UserKeyData,
            });
        }
    }
    const rootIndex = TreeMath.root(state.numLeaves);
    edges.push({
        isGrantEdge: true,
        parentGeneration: state.keyVersion + 1,
        childKind: "node",
        childIndex: rootIndex,
        childGeneration: newGenerationOf(rootIndex),
        data: "wrap:grant->root" as types.core.UserKeyData,
    });
    return {baseKeyVersion: state.keyVersion, blankedPosition: position, refreshedNodes, edges};
}

function kinds(problems: {kind: string}[]) {
    return problems.map(p => p.kind).sort();
}

it("an honest removal passes", async () => {
    assert.deepStrictEqual(TreeTransitionValidator.validateRemoval(stored(), honestTransition(), BOB), []);
});

it("the delta reads O(log n) nodes, not the tree", async () => {
    // Eight seats: three on the path, three on the copath, of which two are internal nodes.
    assert.strictEqual(TreeTransitionValidator.nodesNeededFor(BOB_POSITION, 8).length, 5);
    assert.strictEqual(stored().nodes.length, 5);
});

it("SECURITY: a delta planned against a superseded epoch is refused", async () => {
    // Every generation in it was read at another epoch, so nothing in it can be trusted to describe this state.
    const transition = {...honestTransition(), baseKeyVersion: EPOCH - 1};
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)), ["STALE_BASE_EPOCH"]);
});

it("SECURITY: a delta naming the wrong base generation is refused", async () => {
    // The node moved since the client read it — someone else's removal already refreshed this path.
    const transition = honestTransition();
    transition.refreshedNodes[0] = {...transition.refreshedNodes[0], fromGeneration: 7};
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)), ["STALE_BASE_GENERATION"]);
});

it("SECURITY: skipping a node on the path is refused", async () => {
    // The skipped node keeps a key the departing member still holds, which makes the removal cosmetic.
    const transition = honestTransition();
    transition.refreshedNodes = transition.refreshedNodes.slice(1);
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)), ["REFRESH_NOT_THE_PATH"]);
});

it("SECURITY: refreshing a node off the path is refused", async () => {
    // Unrequested work charged to everyone in that subtree, and outside what the epoch bump accounts for.
    const transition = honestTransition();
    transition.refreshedNodes.push({nodeIndex: 1, fromGeneration: 0, generation: 1, publicKey: "pk:1g1" as types.core.EccPubKey});
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)), ["REFRESH_NOT_THE_PATH"]);
});

it("SECURITY: a refreshed node reusing its public key is refused", async () => {
    const state = stored();
    const transition = honestTransition(state);
    const current = state.nodes.find(n => n.nodeIndex === transition.refreshedNodes[0].nodeIndex)!;
    transition.refreshedNodes[0] = {...transition.refreshedNodes[0], publicKey: current.publicKey};
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(state, transition, BOB)).includes("NODE_KEY_REUSED"));
});

it("SECURITY: leaving out an edge the refresh owes is refused", async () => {
    // A member under a refreshed node with no edge to it can no longer climb: the removal would lock out somebody
    // who was not being removed.
    const transition = honestTransition();
    transition.edges = transition.edges.filter(edge => edge.childKind !== "user");
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("MISSING_EDGE"));
});

it("SECURITY: an edge to the seat being blanked is refused", async () => {
    // Wrapping the refreshed key to the departing member is the removal undone.
    const transition = honestTransition();
    transition.edges.push({
        parentIndex: TreeMath.parent(TreeMath.leafNode(BOB_POSITION), 8),
        parentGeneration: transition.refreshedNodes[0].generation,
        childKind: "user",
        childUserId: BOB,
        data: "wrap:back-to-bob" as types.core.UserKeyData,
    });
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("UNEXPECTED_EDGE"));
});

it("SECURITY: an edge naming a stale parent generation is refused", async () => {
    const transition = honestTransition();
    const edge = transition.edges.find(e => e.childKind === "user")!;
    edge.parentGeneration = edge.parentGeneration - 1;
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("STALE_PARENT_GENERATION"));
});

it("SECURITY: an edge naming a stale child generation is refused", async () => {
    const transition = honestTransition();
    const edge = transition.edges.find(e => e.childKind === "node" && !e.isGrantEdge)!;
    edge.childGeneration = (edge.childGeneration ?? 0) - 1;
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("STALE_CHILD_GENERATION"));
});

it("SECURITY: a grant edge left at the old epoch is refused", async () => {
    // The epoch bump is what stales every container wrap of the old grant key. Without it the removal changes
    // nothing for content.
    const transition = honestTransition();
    const grant = transition.edges.find(e => e.isGrantEdge)!;
    grant.parentGeneration = EPOCH;
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("GRANT_EDGE_WRONG_EPOCH"));
});

it("a transition with no grant edge is refused", async () => {
    const transition = honestTransition();
    transition.edges = transition.edges.filter(e => !e.isGrantEdge);
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("GRANT_EDGE_COUNT"));
});

it("a transition blanking a seat its subject does not hold is refused", async () => {
    const transition = {...honestTransition(), blankedPosition: 4};
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)), ["WRONG_SEAT"]);
});

it("removing somebody who holds no leaf is refused", async () => {
    const problems = TreeTransitionValidator.validateRemoval(stored(), honestTransition(), "outsider" as types.cloud.UserId);
    assert.deepStrictEqual(kinds(problems), ["MEMBER_HAS_NO_LEAF"]);
});

it("an edge carrying no ciphertext is refused", async () => {
    const transition = honestTransition();
    transition.edges[0] = {...transition.edges[0], data: "" as types.core.UserKeyData};
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("EMPTY_EDGE_DATA"));
});

it("a duplicated edge is refused", async () => {
    const transition = honestTransition();
    transition.edges.push({...transition.edges.find(e => e.childKind === "user")!});
    assert.ok(kinds(TreeTransitionValidator.validateRemoval(stored(), transition, BOB)).includes("DUPLICATE_EDGE"));
});

it("a blank seat next to the departing member needs no edge", async () => {
    // Nobody to wrap to, so the refresh owes nothing there — and must not be required to invent an edge.
    const seatingWithBlank = [...SEATING];
    seatingWithBlank[3] = "";
    const tree = buildTree(seatingWithBlank, EPOCH);
    const needed = new Set(TreeTransitionValidator.nodesNeededFor(BOB_POSITION, tree.numLeaves));
    const state: StoredPathState = {
        numLeaves: tree.numLeaves,
        leafAssignment: tree.leafAssignment,
        keyVersion: EPOCH,
        nodes: tree.nodes.filter(node => needed.has(node.nodeIndex)),
    };
    assert.deepStrictEqual(TreeTransitionValidator.validateRemoval(state, honestTransition(state), BOB), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// additions as a delta — same rules, minus the epoch bump
// ─────────────────────────────────────────────────────────────────────────────

const NEWCOMER = "grace" as types.cloud.UserId;

/** The stored state an addition at `position` is checked against, in the geometry seating it produces. */
function storedForSeat(seating: string[], position: number): StoredPathState {
    const tree = buildTree(seating, EPOCH);
    const needed = new Set(TreeTransitionValidator.nodesNeededForSeat(position, tree.numLeaves));
    return {
        numLeaves: tree.numLeaves,
        leafAssignment: tree.leafAssignment,
        keyVersion: EPOCH,
        nodes: tree.nodes.filter(node => needed.has(node.nodeIndex)),
    };
}

function honestAddition(seating: string[], position: number) {
    const tree = buildTree(seating, EPOCH);
    return additionTransition(tree, NEWCOMER, position, EPOCH);
}

const BLANK_SEATING = ["janek", "alice", "", "carol", "dave", "erin", "frank", ""];

it("an honest addition into a blank passes", async () => {
    const problems = TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), honestAddition(BLANK_SEATING, 2), NEWCOMER,
    );
    assert.deepStrictEqual(problems, [], JSON.stringify(problems));
});

it("an honest addition that grows the tree passes", async () => {
    const full = ["janek", "alice", "bob", "carol", "dave"];
    const problems = TreeTransitionValidator.validateAddition(
        storedForSeat(full, 5), honestAddition(full, 5), NEWCOMER,
    );
    assert.deepStrictEqual(problems, [], JSON.stringify(problems));
});

it("the delta reads O(log n) nodes for a seat, not the tree", async () => {
    assert.strictEqual(TreeTransitionValidator.nodesNeededForSeat(2, 8).length, 5);
    assert.strictEqual(storedForSeat(BLANK_SEATING, 2).nodes.length, 5);
});

it("SECURITY: an addition may not advance the epoch", async () => {
    // The grant keypair stays, so every container wrap of it stays valid. A delta that moved the epoch would make
    // the cheap operation cost what a removal costs, for everyone.
    const transition = honestAddition(BLANK_SEATING, 2);
    transition.edges.find(e => e.isGrantEdge)!.parentGeneration = EPOCH + 1;
    assert.ok(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )).includes("GRANT_EDGE_WRONG_EPOCH"));
});

it("SECURITY: seating over somebody is refused", async () => {
    const problems = TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 1), honestAddition(BLANK_SEATING, 1), NEWCOMER,
    );
    assert.deepStrictEqual(kinds(problems), ["SEAT_NOT_BLANK"]);
});

it("SECURITY: leaving out an edge the re-keying owes is refused", async () => {
    // A member under a re-keyed node with no edge to it can no longer climb — an addition that locks somebody out.
    const transition = honestAddition(BLANK_SEATING, 2);
    transition.edges = transition.edges.filter(edge => !(edge.childKind === "user" && edge.childUserId !== NEWCOMER));
    assert.ok(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )).includes("MISSING_EDGE"));
});

it("SECURITY: re-keying a node off the new leaf's path is refused", async () => {
    const transition = honestAddition(BLANK_SEATING, 2);
    transition.seatedNodes.push({nodeIndex: 1, fromGeneration: 0, generation: 1, publicKey: "pk:1g1" as types.core.EccPubKey});
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )), ["REFRESH_NOT_THE_PATH"]);
});

it("SECURITY: claiming an existing node is newly minted is refused", async () => {
    // Dropping `fromGeneration` would let a caller overwrite a live key while the edges below it still name the
    // generation it replaced, cutting off that whole subtree.
    const transition = honestAddition(BLANK_SEATING, 2);
    transition.seatedNodes[0] = {...transition.seatedNodes[0], fromGeneration: undefined, generation: 0};
    assert.ok(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )).includes("NODE_NOT_NEW"));
});

it("SECURITY: a re-keyed node reusing its public key is refused", async () => {
    const state = storedForSeat(BLANK_SEATING, 2);
    const transition = honestAddition(BLANK_SEATING, 2);
    const current = state.nodes.find(n => n.nodeIndex === transition.seatedNodes[0].nodeIndex)!;
    transition.seatedNodes[0] = {...transition.seatedNodes[0], publicKey: current.publicKey};
    assert.ok(kinds(TreeTransitionValidator.validateAddition(state, transition, NEWCOMER)).includes("NODE_KEY_REUSED"));
});

it("a delta naming a base generation the node has moved past is refused", async () => {
    const transition = honestAddition(BLANK_SEATING, 2);
    transition.seatedNodes[0] = {...transition.seatedNodes[0], fromGeneration: 9};
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )), ["STALE_BASE_GENERATION"]);
});

it("a delta planned against a superseded epoch is refused", async () => {
    const transition = {...honestAddition(BLANK_SEATING, 2), baseKeyVersion: EPOCH - 1};
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )), ["STALE_BASE_EPOCH"]);
});

it("seating somebody who already holds a leaf is refused", async () => {
    const problems = TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), honestAddition(BLANK_SEATING, 2), "alice" as types.cloud.UserId,
    );
    assert.deepStrictEqual(kinds(problems), ["ALREADY_SEATED"]);
});

it("a seat past the end of the tree is refused", async () => {
    const transition = {...honestAddition(BLANK_SEATING, 2), position: 99};
    assert.deepStrictEqual(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )), ["SEAT_OUT_OF_RANGE"]);
});

it("an addition with no grant edge is refused", async () => {
    const transition = honestAddition(BLANK_SEATING, 2);
    transition.edges = transition.edges.filter(e => !e.isGrantEdge);
    assert.ok(kinds(TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), transition, NEWCOMER,
    )).includes("GRANT_EDGE_COUNT"));
});

it("a blank seat beside the newcomer needs no edge", async () => {
    // Position 7 is blank too, and nobody is there to wrap to: the re-keying owes nothing for it.
    const problems = TreeTransitionValidator.validateAddition(
        storedForSeat(BLANK_SEATING, 2), honestAddition(BLANK_SEATING, 2), NEWCOMER,
    );
    assert.deepStrictEqual(problems, [], JSON.stringify(problems));
});
