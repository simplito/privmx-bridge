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
import * as types from "../../../../types";
import { TreeProblem, TreeValidator } from "../../../../service/cloud/keytree/TreeValidator";
import { buildTree as buildTreeAt, userId } from "../../../testUtils/TreeFixtures";

/**
 * Unit tests for the bridge's structural validation of the hidden key tree. Fixtures use placeholder
 * ciphertexts — every rule under test is decidable from node indices, generations and roster membership alone.
 *
 * Tests marked SECURITY guard confidentiality and fail silently at runtime if the guard regresses.
 */

const EPOCH = 7;

const user = userId;

/** Builds a well-formed tree at the epoch these tests use. */
function buildTree(
    assignment: string[],
    keyVersion = EPOCH,
    generations: Map<number, number> = new Map(),
): types.cloud.GroupTreeState {
    return buildTreeAt(assignment, keyVersion, generations);
}

function roster(assignment: string[]) {
    const members = assignment.filter(x => x !== "").map(user);
    return {users: members, managers: [] as types.cloud.UserId[]};
}

function kinds(problems: {kind: string}[]): string[] {
    return problems.map(p => p.kind);
}

function assertHas(problems: TreeProblem[], kind: string, message?: string) {
    assert.ok(kinds(problems).includes(kind), message ?? `expected ${kind}, got ${JSON.stringify(kinds(problems))}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// well-formed states
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState accepts well-formed trees", () => {
    each<[number]>([[1], [2], [3], [4], [5], [7], [8], [9], [16], [17], [31], [32], [33]]).it("N=%s", ([n]) => {
        const assignment = Array.from({length: n}, (_, i) => `u${i}`);
        const problems = TreeValidator.validateState(buildTree(assignment), roster(assignment), EPOCH);
        assert.deepStrictEqual(problems, [], JSON.stringify(problems));
    });
    
    it("accepts blanks left by removals", () => {
        const assignment = ["u0", "", "u2", "", "", "u5", "u6", ""];
        const problems = TreeValidator.validateState(buildTree(assignment), roster(assignment), EPOCH);
        assert.deepStrictEqual(problems, [], JSON.stringify(problems));
    });
    
    it("accepts an entirely blank subtree, which nobody can reach and nobody needs to", () => {
        // Positions 4..7 are all blank: node 11 and its children exist but have no wrap to any member. That is
        // the state a group settles into after several removals, and it is not an error.
        const assignment = ["u0", "u1", "u2", "u3", "", "", "", ""];
        const problems = TreeValidator.validateState(buildTree(assignment), roster(assignment), EPOCH);
        assert.deepStrictEqual(problems, [], JSON.stringify(problems));
    });
    
    it("accepts mixed generations, since refreshes are per-node", () => {
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment, EPOCH, new Map([[1, 4], [3, 9]]));
        assert.deepStrictEqual(TreeValidator.validateState(tree, roster(assignment), EPOCH), []);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// roster ↔ leaves
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState roster agreement", () => {
    it("rejects a leaf held by someone outside the roster", () => {
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment);
        const problems = TreeValidator.validateState(tree, {users: [user("u0"), user("u1"), user("u2")], managers: []}, EPOCH);
        assertHas(problems, "LEAF_MEMBER_NOT_IN_ROSTER");
    });
    
    it("rejects a member with no leaf, who would silently have no way in", () => {
        const assignment = ["u0", "u1", "", "u3"];
        const tree = buildTree(assignment);
        const problems = TreeValidator.validateState(tree, {users: [user("u0"), user("u1"), user("u2"), user("u3")], managers: []}, EPOCH);
        assertHas(problems, "ROSTER_MEMBER_WITHOUT_LEAF");
    });
    
    it("counts managers as members", () => {
        const assignment = ["u0", "u1"];
        const problems = TreeValidator.validateState(buildTree(assignment), {users: [user("u0")], managers: [user("u1")]}, EPOCH);
        assert.deepStrictEqual(problems, []);
    });
    
    it("SECURITY: rejects the same member seated twice", () => {
        // Two leaves for one member means a removal that blanks one of them leaves the other standing, and the
        // "removed" member keeps reading everything.
        const assignment = ["u0", "u1", "u1", ""];
        const tree = buildTree(assignment);
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1"]), EPOCH), "DUPLICATE_LEAF_MEMBER");
    });
    
    it("rejects a tree with nobody in it", () => {
        const assignment = ["", "", "", ""];
        const problems = TreeValidator.validateState(buildTree(assignment), {users: [], managers: []}, EPOCH);
        assertHas(problems, "NO_OCCUPIED_LEAF");
    });
    
    it("rejects a leafAssignment whose length disagrees with numLeaves", () => {
        const tree = buildTree(["u0", "u1", "u2", "u3"]);
        tree.leafAssignment = [user("u0"), user("u1")];
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1"]), EPOCH), "LEAF_COUNT_MISMATCH");
    });
    
    each<[unknown]>([[0], [-1], [2.5], ["4"], [NaN]]).it("rejects numLeaves=%s", ([bad]) => {
        const tree = buildTree(["u0", "u1"]);
        tree.numLeaves = bad as number;
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1"]), EPOCH), "BAD_NUM_LEAVES");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// node set
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState node set", () => {
    it("rejects a missing internal node", () => {
        const tree = buildTree(["u0", "u1", "u2", "u3"]);
        tree.nodes = tree.nodes.filter(n => n.nodeIndex !== 1);
        const problems = TreeValidator.validateState(tree, roster(["u0", "u1", "u2", "u3"]), EPOCH);
        assertHas(problems, "MISSING_NODE");
    });
    
    it("rejects a node published for a leaf, where the member's own key already sits", () => {
        const tree = buildTree(["u0", "u1"]);
        tree.nodes.push({nodeIndex: 0, generation: 0, publicKey: "pk:0g0" as types.core.EccPubKey});
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1"]), EPOCH), "UNEXPECTED_NODE");
    });
    
    it("rejects a node outside the tree", () => {
        const tree = buildTree(["u0", "u1"]);
        tree.nodes.push({nodeIndex: 9, generation: 0, publicKey: "pk:9g0" as types.core.EccPubKey});
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1"]), EPOCH), "UNEXPECTED_NODE");
    });
    
    it("rejects two entries for one node", () => {
        const tree = buildTree(["u0", "u1", "u2", "u3"]);
        tree.nodes.push({nodeIndex: 1, generation: 3, publicKey: "pk:1g3" as types.core.EccPubKey});
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1", "u2", "u3"]), EPOCH), "DUPLICATE_NODE");
    });
    
    it("rejects a negative or fractional generation", () => {
        const tree = buildTree(["u0", "u1"]);
        tree.nodes[0].generation = -1;
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1"]), EPOCH), "BAD_GENERATION");
    });
    
    it("rejects an empty public key", () => {
        const tree = buildTree(["u0", "u1"]);
        tree.nodes[0].publicKey = "" as types.core.EccPubKey;
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1"]), EPOCH), "EMPTY_NODE_PUBKEY");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// edge set — where coverage is actually enforced
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState edge set", () => {
    it("SECURITY: rejects a missing edge, which would leave a member unable to climb", () => {
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment);
        tree.edges = tree.edges.filter(e => !(e.childKind === "user" && e.childUserId === user("u2")));
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "MISSING_EDGE");
    });
    
    it("SECURITY: rejects an edge to a blank leaf, the shape of a quietly reinstated member", () => {
        const assignment = ["u0", "u1", "", "u3"];
        const tree = buildTree(assignment);
        tree.edges.push({
            parentIndex: 5,
            parentGeneration: 0,
            childKind: "user",
            childUserId: user("evicted"),
            data: "wrap:5->evicted" as types.core.UserKeyData,
        });
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "UNEXPECTED_EDGE");
    });
    
    it("rejects an edge between nodes that are not parent and child", () => {
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment);
        tree.edges.push({
            parentIndex: 1,
            parentGeneration: 0,
            childKind: "node",
            childIndex: 5,
            childGeneration: 0,
            data: "wrap:1->5" as types.core.UserKeyData,
        });
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "UNEXPECTED_EDGE");
    });
    
    it("rejects a duplicated edge", () => {
        const assignment = ["u0", "u1"];
        const tree = buildTree(assignment);
        tree.edges.push({...tree.edges[0]});
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "DUPLICATE_EDGE");
    });
    
    it("SECURITY: rejects an edge naming a stale parent generation", () => {
        // This is the rule that makes refresh coverage automatic: after node 1 is refreshed, an edge still
        // wrapping the *old* sk_1 no longer matches, so the client cannot skip re-wrapping it.
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment, EPOCH, new Map([[1, 2]]));
        const stale = tree.edges.find(e => e.parentIndex === 1);
        assert.ok(stale);
        stale.parentGeneration = 1;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "STALE_PARENT_GENERATION");
    });
    
    it("SECURITY: rejects an edge naming a stale child generation", () => {
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment, EPOCH, new Map([[1, 2]]));
        const stale = tree.edges.find(e => e.childKind === "node" && e.childIndex === 1);
        assert.ok(stale);
        stale.childGeneration = 1;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "STALE_CHILD_GENERATION");
    });
    
    it("rejects an edge carrying no ciphertext", () => {
        const assignment = ["u0", "u1"];
        const tree = buildTree(assignment);
        tree.edges[0].data = "" as types.core.UserKeyData;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "EMPTY_EDGE_DATA");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// grant edge — the indirection that keeps growth cheap
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState grant edge", () => {
    it("requires exactly one", () => {
        const assignment = ["u0", "u1"];
        const tree = buildTree(assignment);
        tree.edges = tree.edges.filter(e => !e.isGrantEdge);
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "GRANT_EDGE_COUNT");
    });
    
    it("rejects a second one, which would mean two grant keys reaching one root", () => {
        const assignment = ["u0", "u1"];
        const tree = buildTree(assignment);
        const grant = tree.edges.find(e => e.isGrantEdge);
        assert.ok(grant);
        tree.edges.push({...grant, data: "wrap:other-grant->1" as types.core.UserKeyData});
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "GRANT_EDGE_COUNT");
    });
    
    it("SECURITY: rejects a grant edge addressed to another epoch", () => {
        // The epoch in the grant edge is what ties the tree to keyVersion. If it could lag, a client could be
        // handed last epoch's grant key while the server reported the current one.
        const assignment = ["u0", "u1"];
        const tree = buildTree(assignment, EPOCH - 1);
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "GRANT_EDGE_WRONG_EPOCH");
    });
    
    it("rejects a grant edge pointing below the root", () => {
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment);
        const grant = tree.edges.find(e => e.isGrantEdge);
        assert.ok(grant);
        grant.childIndex = 1;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "GRANT_EDGE_WRONG_CHILD");
    });
    
    it("rejects a grant edge naming a stale root generation", () => {
        const assignment = ["u0", "u1", "u2", "u3"];
        const tree = buildTree(assignment, EPOCH, new Map([[3, 5]]));
        const grant = tree.edges.find(e => e.isGrantEdge);
        assert.ok(grant);
        grant.childGeneration = 4;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "STALE_CHILD_GENERATION");
    });
    
    it("wraps straight to the member in a one-member group, where the root is a leaf", () => {
        const tree = buildTree(["solo"]);
        assert.deepStrictEqual(TreeValidator.validateState(tree, roster(["solo"]), EPOCH), []);
        const grant = tree.edges.find(e => e.isGrantEdge);
        assert.strictEqual(grant?.childKind, "user");
    });
    
    it("rejects a one-member grant edge addressed to somebody else", () => {
        const tree = buildTree(["solo"]);
        const grant = tree.edges.find(e => e.isGrantEdge);
        assert.ok(grant);
        grant.childUserId = user("intruder");
        assertHas(TreeValidator.validateState(tree, roster(["solo"]), EPOCH), "GRANT_EDGE_WRONG_CHILD");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// removals
// ─────────────────────────────────────────────────────────────────────────────
