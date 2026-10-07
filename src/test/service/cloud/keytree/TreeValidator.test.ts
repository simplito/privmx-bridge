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
import { TreeProblem, TreeValidator, TreeView } from "../../../../service/cloud/keytree/TreeValidator";
import { buildTree as buildTreeAt, cloneTree, planCommit, userId } from "../../../testUtils/TreeFixtures";

/**
 * Unit tests for the bridge's whole-state check of the hidden key tree. Fixtures use placeholder ciphertexts —
 * every rule under test is decidable from node indices, generations and roster membership alone.
 *
 * Tests marked SECURITY guard confidentiality and fail silently at runtime if the guard regresses.
 */

const EPOCH = 7;

const user = userId;

function seats(n: number): string[] {
    return Array.from({length: n}, (_, i) => `u${i}`);
}

/** A well-formed tree at the epoch these tests use, created by the first member. */
function buildTree(assignment: string[], keyVersion = EPOCH): types.cloud.GroupTreeState {
    return buildTreeAt(assignment, keyVersion);
}

function roster(assignment: string[]) {
    const members = assignment.filter(x => x !== "").map(user);
    return {users: members, managers: [] as types.cloud.UserId[]};
}

function kinds(problems: {kind: string}[]): string[] {
    return problems.map(p => p.kind);
}

function assertHas(problems: TreeProblem[], kind: string, message?: string) {
    assert.ok(kinds(problems).includes(kind), message ?? `expected ${kind}, got ${JSON.stringify(problems)}`);
}

function view(numLeaves: number, assignment: string[], nodes: [number, number, boolean][]): TreeView {
    return {
        numLeaves,
        leafAssignment: assignment.map(user),
        nodes: new Map(nodes.map(([nodeIndex, generation, filled]) => [nodeIndex, {
            generation, ...(filled ? {publicKey: `pk:${nodeIndex}` as types.core.EccPubKey} : {}),
        }])),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.resolve", () => {
    it("a seated leaf resolves to its member, a blank one to nothing", () => {
        const v = view(2, ["u0", ""], []);
        assert.deepStrictEqual(TreeValidator.resolve(v, 0), [{kind: "user", userId: "u0"}]);
        assert.deepStrictEqual(TreeValidator.resolve(v, 2), []);
    });
    
    it("a filled keyed node resolves to itself", () => {
        const v = view(64, seats(64), [[31, 3, true], [63, 0, true]]);
        assert.deepStrictEqual(TreeValidator.resolve(v, 31), [{kind: "node", nodeIndex: 31, generation: 3}]);
    });
    
    it("a blank keyed node passes its children's resolutions up, down to the members of its buckets", () => {
        // 95 is blank: its children 79 and 111 are bucket nodes, so the resolution is every seated member of
        // positions 32..63 — here with 40 left blank.
        const assignment = seats(64);
        assignment[40] = "";
        const v = view(64, assignment, [[31, 0, true], [95, 4, false], [63, 0, true]]);
        const resolved = TreeValidator.resolve(v, 95);
        assert.strictEqual(resolved.length, 31);
        assert.ok(resolved.every(r => r.kind === "user"));
        assert.ok(!resolved.some(r => r.kind === "user" && r.userId === "u40"));
    });
    
    it("a keyed node with no record resolves like a blank one", () => {
        const v = view(64, seats(64), [[63, 0, true]]);
        assert.strictEqual(TreeValidator.resolve(v, 31).length, 32);
    });
    
    it("a record on a bucket node is ignored — bucket nodes never resolve to themselves", () => {
        const v = view(4, seats(4), [[1, 0, true], [3, 0, true]]);
        assert.deepStrictEqual(TreeValidator.resolve(v, 1), [{kind: "user", userId: "u0"}, {kind: "user", userId: "u1"}]);
    });
    
    it("the required edges of a filled node go to the nearest filled keyed node or member on each side", () => {
        const v = view(64, seats(64), [[31, 1, true], [95, 0, false], [63, 2, true]]);
        const required = TreeValidator.requiredEdges(v, [63]);
        assert.deepStrictEqual(required.get("63>node:31"), {parent: "node:63", child: "node:31", parentGeneration: 2, childGeneration: 1});
        assert.ok(required.has("63>user:u32") && required.has("63>user:u63"));
        assert.strictEqual(required.size, 1 + 32);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// well-formed states
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState accepts well-formed trees", () => {
    each<[number]>([[1], [2], [3], [4], [5], [16], [17], [31], [32], [33], [64], [100]]).it("freshly created, N=%s", ([n]) => {
        const assignment = seats(n);
        const problems = TreeValidator.validateState(buildTree(assignment), roster(assignment), EPOCH);
        assert.deepStrictEqual(problems, [], JSON.stringify(problems));
    });
    
    it("a fresh tree holds only the creator's keyed path — everybody else is wrapped to from it", () => {
        const tree = buildTree(seats(64));
        assert.deepStrictEqual(tree.nodes.map(node => node.nodeIndex), [31, 63]);
        // 31 wraps to each of its 32 members; 63 to 31 and to each of the 32 members under the unfilled 95.
        assert.strictEqual(tree.edges.length, 32 + 1 + 32 + 1);
    });
    
    it("accepts blanks left by removals", () => {
        const assignment = ["u0", "", "u2", "", "", "u5", "u6", ""];
        const problems = TreeValidator.validateState(buildTree(assignment), roster(assignment), EPOCH);
        assert.deepStrictEqual(problems, [], JSON.stringify(problems));
    });
    
    it("accepts blank keyed nodes, whose children are wrapped to from the next filled ancestor", () => {
        // u40 fills 95 with a self-update, then u0 removes u41: 95 is blanked again and the re-keyed root wraps
        // to the members under it directly.
        const assignment = seats(64);
        const filled = planCommit(buildTree(assignment), EPOCH, {kind: "selfUpdate", committer: "u40"}).after;
        const after = planCommit(filled, EPOCH, {kind: "remove", committer: "u0", removed: ["u41"]}).after;
        assignment[41] = "";
        assert.deepStrictEqual(TreeValidator.validateState(after, roster(assignment), EPOCH + 1), []);
        assert.deepStrictEqual(after.nodes.find(node => node.nodeIndex === 95), {nodeIndex: 95, generation: 0}, "blank, generation kept");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// roster ↔ leaves
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState roster agreement", () => {
    it("rejects a leaf held by someone outside the roster", () => {
        const tree = buildTree(seats(4));
        const problems = TreeValidator.validateState(tree, {users: [user("u0"), user("u1"), user("u2")], managers: []}, EPOCH);
        assertHas(problems, "LEAF_MEMBER_NOT_IN_ROSTER");
    });
    
    it("rejects a member with no leaf, who would silently have no way in", () => {
        const tree = buildTree(["u0", "u1", "", "u3"]);
        const problems = TreeValidator.validateState(tree, {users: [user("u0"), user("u1"), user("u2"), user("u3")], managers: []}, EPOCH);
        assertHas(problems, "ROSTER_MEMBER_WITHOUT_LEAF");
    });
    
    it("counts managers as members", () => {
        const problems = TreeValidator.validateState(buildTree(["u0", "u1"]), {users: [user("u0")], managers: [user("u1")]}, EPOCH);
        assert.deepStrictEqual(problems, []);
    });
    
    it("SECURITY: rejects the same member seated twice", () => {
        // Two leaves for one member means a removal that blanks one of them leaves the other standing, and the
        // "removed" member keeps reading everything.
        assertHas(TreeValidator.validateLeaves(buildTree(["u0", "u1", "u1", ""]), roster(["u0", "u1"])), "DUPLICATE_LEAF_MEMBER");
    });
    
    it("rejects a tree with nobody in it", () => {
        const tree = buildTree(seats(4));
        tree.leafAssignment = ["", "", "", ""].map(user);
        assertHas(TreeValidator.validateLeaves(tree, {users: [], managers: []}), "NO_OCCUPIED_LEAF");
    });
    
    it("rejects a leafAssignment whose length disagrees with numLeaves", () => {
        const tree = buildTree(seats(4));
        tree.leafAssignment = tree.leafAssignment.slice(0, 3);
        assert.deepStrictEqual(kinds(TreeValidator.validateState(tree, roster(seats(3)), EPOCH)), ["LEAF_COUNT_MISMATCH"]);
    });
    
    each<[unknown]>([[0], [-1], [2.5], ["4"], [NaN]]).it("rejects numLeaves=%s", ([bad]) => {
        const tree = buildTree(seats(4));
        (tree as {numLeaves: unknown}).numLeaves = bad;
        assert.deepStrictEqual(kinds(TreeValidator.validateState(tree, roster(seats(4)), EPOCH)), ["BAD_NUM_LEAVES"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// node records
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState node records", () => {
    it("SECURITY: rejects a record on a bucket node, which nothing may wrap to", () => {
        const tree = buildTree(seats(64));
        tree.nodes.push({nodeIndex: 15, generation: 0, publicKey: "pk:15" as types.core.EccPubKey});
        assertHas(TreeValidator.validateState(tree, roster(seats(64)), EPOCH), "UNEXPECTED_NODE");
    });
    
    it("rejects a record for a leaf, where the member's own key already sits", () => {
        const tree = buildTree(seats(4));
        tree.nodes.push({nodeIndex: 2, generation: 0, publicKey: "pk:2" as types.core.EccPubKey});
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "UNEXPECTED_NODE");
    });
    
    it("rejects a record outside the tree", () => {
        const tree = buildTree(seats(64));
        tree.nodes.push({nodeIndex: 159, generation: 0, publicKey: "pk:159" as types.core.EccPubKey});
        assertHas(TreeValidator.validateState(tree, roster(seats(64)), EPOCH), "UNEXPECTED_NODE");
    });
    
    it("rejects two records for one node", () => {
        const tree = buildTree(seats(4));
        tree.nodes.push({...tree.nodes[0]});
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "DUPLICATE_NODE");
    });
    
    it("rejects a negative or fractional generation", () => {
        const tree = buildTree(seats(4));
        tree.nodes[0].generation = -1;
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "BAD_GENERATION");
    });
    
    it("rejects a blank root — every commit re-keys it, and the grant edge has nothing else to wrap to", () => {
        const tree = buildTree(seats(4));
        delete tree.nodes[0].publicKey;
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "ROOT_NOT_FILLED");
    });
    
    it("rejects a missing root record the same way", () => {
        const tree = buildTree(seats(4));
        tree.nodes = [];
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "ROOT_NOT_FILLED");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// edges
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeValidator.validateState edge set", () => {
    const assignment = seats(64);
    
    it("SECURITY: rejects a missing edge, which would leave a member unable to climb", () => {
        const tree = buildTree(assignment);
        tree.edges = tree.edges.filter(e => e.childUserId !== "u40");
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "MISSING_EDGE");
    });
    
    it("SECURITY: rejects a wrap that skips a filled node — a key handed past the node that should gate it", () => {
        // u0 sits under the filled 31; the root may wrap to 31, never to u0 directly.
        const tree = buildTree(assignment);
        tree.edges.push({parentIndex: 63, parentGeneration: 0, childKind: "user", childUserId: user("u0"), data: "x" as types.core.UserKeyData});
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "UNEXPECTED_EDGE");
    });
    
    it("SECURITY: rejects a wrap to somebody outside the parent's subtree", () => {
        const tree = buildTree(assignment);
        tree.edges.push({parentIndex: 31, parentGeneration: 0, childKind: "user", childUserId: user("u40"), data: "x" as types.core.UserKeyData});
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "UNEXPECTED_EDGE");
    });
    
    it("SECURITY: rejects an edge to a blank leaf, the shape of a quietly reinstated member", () => {
        const tree = buildTree(["u0", "u1", "u2", ""]);
        tree.edges.push({parentIndex: 3, parentGeneration: 0, childKind: "user", childUserId: user("u3"), data: "x" as types.core.UserKeyData});
        assertHas(TreeValidator.validateState(tree, roster(["u0", "u1", "u2"]), EPOCH), "UNEXPECTED_EDGE");
    });
    
    it("rejects a duplicated edge", () => {
        const tree = buildTree(assignment);
        tree.edges.push({...tree.edges[0]});
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "DUPLICATE_EDGE");
    });
    
    it("SECURITY: rejects an edge naming a stale parent generation", () => {
        const tree = buildTree(assignment);
        tree.edges.find(e => e.parentIndex === 31)!.parentGeneration = 5;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "STALE_PARENT_GENERATION");
    });
    
    it("SECURITY: rejects an edge naming a stale child generation", () => {
        const tree = buildTree(assignment);
        tree.edges.find(e => e.childIndex === 31 && !e.isGrantEdge)!.childGeneration = 5;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "STALE_CHILD_GENERATION");
    });
    
    it("rejects an edge carrying no ciphertext", () => {
        const tree = buildTree(assignment);
        tree.edges[0].data = "" as types.core.UserKeyData;
        assertHas(TreeValidator.validateState(tree, roster(assignment), EPOCH), "EMPTY_EDGE_DATA");
    });
    
    it("SECURITY: rejects wraps left behind by a blanked node", () => {
        // What the storage rule exists to prevent: 95 blank, yet its old wraps — readable by whoever held its
        // old key — still stored.
        const before = planCommit(buildTree(assignment), EPOCH, {kind: "selfUpdate", committer: "u40"}).after;
        const after = cloneTree(planCommit(before, EPOCH, {kind: "remove", committer: "u0", removed: ["u41"]}).after);
        after.edges.push(...before.edges.filter(e => e.parentIndex === 95 && e.childUserId !== "u41"));
        const remaining = assignment.filter(a => a !== "u41");
        assertHas(TreeValidator.validateState(after, roster(remaining), EPOCH + 1), "UNEXPECTED_EDGE");
    });
});

describe("TreeValidator.validateState grant edge", () => {
    it("requires exactly one", () => {
        const tree = buildTree(seats(4));
        tree.edges = tree.edges.filter(e => !e.isGrantEdge);
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "GRANT_EDGE_COUNT");
    });
    
    it("rejects a second one, which would mean two grant keys reaching one root", () => {
        const tree = buildTree(seats(4));
        tree.edges.push({...tree.edges.find(e => e.isGrantEdge)!});
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "GRANT_EDGE_COUNT");
    });
    
    it("SECURITY: rejects a grant edge addressed to another epoch", () => {
        const tree = buildTree(seats(4));
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH + 1), "GRANT_EDGE_WRONG_EPOCH");
    });
    
    it("rejects a grant edge pointing below the root", () => {
        const tree = buildTree(seats(64));
        tree.edges.find(e => e.isGrantEdge)!.childIndex = 31;
        assertHas(TreeValidator.validateState(tree, roster(seats(64)), EPOCH), "GRANT_EDGE_WRONG_CHILD");
    });
    
    it("rejects a grant edge naming a stale root generation", () => {
        const tree = buildTree(seats(4));
        tree.edges.find(e => e.isGrantEdge)!.childGeneration = 3;
        assertHas(TreeValidator.validateState(tree, roster(seats(4)), EPOCH), "STALE_CHILD_GENERATION");
    });
    
    it("wraps straight to the member in a one-member group, where the root is a leaf", () => {
        const tree = buildTree(["u0"]);
        assert.deepStrictEqual(tree.nodes, []);
        assert.deepStrictEqual(TreeValidator.validateState(tree, roster(["u0"]), EPOCH), []);
    });
    
    it("rejects a one-member grant edge addressed to somebody else", () => {
        const tree = buildTree(["u0"]);
        tree.edges[0].childUserId = user("u1");
        assertHas(TreeValidator.validateState(tree, roster(["u0"]), EPOCH), "GRANT_EDGE_WRONG_CHILD");
    });
});
