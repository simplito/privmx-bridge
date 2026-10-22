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
import { CommitOp, CommitResult, StoredTree, SubmittedCommit, TreeCommit, TreeTransitionValidator } from "../../../../service/cloud/keytree/TreeTransitionValidator";
import { TreeValidator } from "../../../../service/cloud/keytree/TreeValidator";
import { TreeMath } from "../../../../service/cloud/keytree/TreeMath";
import { buildTree, commitOpFor, Plan, PlanOp, planCommit, settersOf, userId } from "../../../testUtils/TreeFixtures";
import * as types from "../../../../types";

/**
 * A commit submitted as a delta, checked against what the bridge holds.
 *
 * The whole-state check gets its safety from re-checking everything. A delta cannot, so it rests on what the
 * bridge derives itself — the blank set, the committer's path, the post seating — and on the edges being exactly
 * what that path owes on the post state. These tests are that argument: every honest commit passes and leaves a
 * state `validateState` accepts, and every way of deviating from it is refused.
 *
 * Tests marked SECURITY guard confidentiality and fail silently at runtime if the guard regresses.
 */

const EPOCH = 5;

function seats(n: number, blanks: number[] = []): string[] {
    return Array.from({length: n}, (_, i) => blanks.includes(i) ? "" : `u${i}`);
}

function storedOf(tree: types.cloud.GroupTreeState, keyVersion = EPOCH): StoredTree {
    return {numLeaves: tree.numLeaves, leafAssignment: tree.leafAssignment, keyVersion, nodes: tree.nodes, setters: settersOf(tree)};
}

interface Case {
    stored: StoredTree;
    op: CommitOp;
    submitted: SubmittedCommit;
    plan: Plan;
}

/** An honest commit: what the bridge holds, what it derives from the caller, and what the endpoint sends. */
function honest(tree: types.cloud.GroupTreeState, op: PlanOp, keyVersion = EPOCH): Case {
    const plan = planCommit(tree, keyVersion, op);
    return {
        stored: storedOf(tree, keyVersion),
        op: commitOpFor(op, plan),
        submitted: {baseKeyVersion: keyVersion, refreshedNodes: plan.refreshedNodes, edges: plan.edges},
        plan,
    };
}

/** A creation, checked the way `GroupService.createGroup` checks it: an empty tree in the final seating. */
function honestCreate(assignment: string[], creator = assignment.find(a => a !== "")!): Case {
    return honest({numLeaves: assignment.length, leafAssignment: assignment.map(userId), nodes: [], edges: []}, {kind: "create", committer: creator}, 0);
}

function run(c: Case): CommitResult {
    return TreeTransitionValidator.validateCommit(c.stored, c.op, c.submitted);
}

function accepted(c: Case): TreeCommit {
    const result = run(c);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.rejections));
    return result.commit;
}

function rejectionKinds(c: Case): string[] {
    const result = run(c);
    assert.ok(!result.ok, "expected a rejection");
    return result.rejections.map(r => r.kind);
}

function assertRejected(c: Case, kind: string) {
    const kinds = rejectionKinds(c);
    assert.ok(kinds.includes(kind), `expected ${kind}, got ${JSON.stringify(kinds)}`);
}

function rosterOf(tree: types.cloud.GroupTreeState) {
    return {users: tree.leafAssignment.filter(u => u !== ""), managers: [] as types.cloud.UserId[]};
}

/** The 64-seat group most tests use, created by u0: every keyed node (31, 63, 95) filled by u0 at seq 1. */
const BASE = buildTree(seats(64), EPOCH);

// ─────────────────────────────────────────────────────────────────────────────
// honest commits pass, and leave a valid state
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCommit accepts honest commits", () => {
    each<[number]>([[1], [2], [3], [16], [17], [33], [64], [100]]).it("create, N=%s", ([n]) => {
        const c = honestCreate(seats(n));
        const commit = accepted(c);
        const path = TreeMath.keyedPath(0, n);
        const keyed = TreeMath.keyedNodes(n);
        assert.deepStrictEqual(commit.refreshed.map(node => node.nodeIndex), [...keyed.filter(x => !path.includes(x)), ...path]);
        assert.strictEqual(commit.keyVersion, 1);
    });
    
    it("create by somebody other than the first seat fills the rest first, then its own path", () => {
        const c = honestCreate(seats(64), "u50");
        assert.deepStrictEqual(accepted(c).refreshed.map(node => node.nodeIndex), [31, 95, 63]);
    });
    
    it("add into a blank: the adder fills the newcomer's path and its own, blanks nothing, keeps the epoch", () => {
        const tree = planCommit(BASE, EPOCH, {kind: "selfUpdate", committer: "u40"}).after;
        const removed = planCommit(tree, EPOCH, {kind: "remove", committer: "u0", removed: ["u41"]});
        const c = honest(removed.after, {kind: "add", committer: "u1", members: ["new"], positions: [41]}, EPOCH + 1);
        const commit = accepted(c);
        assert.deepStrictEqual(commit.refreshed.map(node => node.nodeIndex), [95, 31, 63]);
        assert.deepStrictEqual(commit.blanked, []);
        assert.strictEqual(commit.keyVersion, EPOCH + 1);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH + 1), []);
    });
    
    it("add that grows the tree past a power of two moves the root", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["new"], positions: [64]});
        const commit = accepted(c);
        assert.strictEqual(commit.numLeaves, 65);
        assert.deepStrictEqual(commit.refreshed.map(node => node.nodeIndex), [31, 63, 127]);
        assert.deepStrictEqual(commit.unkeyed, [], "63 is level 6 and stays keyed");
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH), []);
    });
    
    it("add that grows a one-bucket tree un-keys the old root and drops its record", () => {
        // N=16 → 17: the root moves from 15 (level 4) to 31, and 15 becomes an ordinary bucket node.
        const tree = buildTree(seats(16), EPOCH);
        const c = honest(tree, {kind: "add", committer: "u3", members: ["new"], positions: [16]});
        const commit = accepted(c);
        assert.deepStrictEqual(commit.unkeyed, [15]);
        assert.deepStrictEqual(commit.refreshed.map(node => node.nodeIndex), [31]);
        assert.deepStrictEqual(c.plan.after.nodes.map(node => node.nodeIndex), [31]);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH), []);
    });
    
    it("add to a one-member group", () => {
        const c = honest(buildTree(["u0"], EPOCH), {kind: "add", committer: "u0", members: ["u1"], positions: [1]});
        assert.deepStrictEqual(accepted(c).refreshed.map(node => node.nodeIndex), [1]);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH), []);
    });
    
    it("a batch addition, blanks and growth together", () => {
        const tree = planCommit(BASE, EPOCH, {kind: "remove", committer: "u0", removed: ["u40", "u3"]}).after;
        const c = honest(tree, {kind: "add", committer: "u10", members: ["a", "b", "c"], positions: [3, 40, 64]}, EPOCH + 1);
        accepted(c);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH + 1), []);
    });
    
    it("remove: the departing member's path blanked, the remover's re-keyed, the epoch advanced", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        const commit = accepted(c);
        assert.deepStrictEqual(commit.refreshed.map(node => node.nodeIndex), [95, 63]);
        assert.deepStrictEqual(commit.blanked, [31]);
        assert.strictEqual(commit.keyVersion, EPOCH + 1);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH + 1), []);
    });
    
    it("SECURITY: remove of the creator by its bucket neighbour still blanks what the creator set", () => {
        const c = honest(BASE, {kind: "remove", committer: "u1", removed: ["u0"]});
        assert.deepStrictEqual(accepted(c).blanked, [95]);
    });
    
    it("remove of the creator, by a member in the other half", () => {
        const c = honest(buildTree(seats(100), EPOCH), {kind: "remove", committer: "u99", removed: ["u0"]});
        accepted(c);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH + 1), []);
    });
    
    it("a batch removal advances the epoch once", () => {
        const c = honest(BASE, {kind: "remove", committer: "u20", removed: ["u0", "u40", "u63"]});
        const commit = accepted(c);
        assert.strictEqual(commit.keyVersion, EPOCH + 1);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH + 1), []);
    });
    
    it("selfUpdate re-keys the caller's path and nothing else", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u40"});
        const commit = accepted(c);
        assert.deepStrictEqual(commit.refreshed.map(node => [node.nodeIndex, node.fromGeneration, node.generation]), [[95, 0, 1], [63, 0, 1]]);
        assert.deepStrictEqual(commit.blanked, []);
        assert.strictEqual(commit.keyVersion, EPOCH);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), EPOCH), []);
    });
    
    it("selfUpdate in a one-member group re-issues the grant edge alone", () => {
        const c = honest(buildTree(["u0"], EPOCH), {kind: "selfUpdate", committer: "u0"});
        assert.deepStrictEqual(c.submitted.refreshedNodes, []);
        assert.strictEqual(c.submitted.edges.length, 1);
        accepted(c);
    });
    
    it("refilling a blank continues from its stored generation", () => {
        const tree = planCommit(planCommit(BASE, EPOCH, {kind: "selfUpdate", committer: "u40"}).after, EPOCH,
            {kind: "remove", committer: "u0", removed: ["u41"]}).after;
        const c = honest(tree, {kind: "selfUpdate", committer: "u40"}, EPOCH + 1);
        const node95 = accepted(c).refreshed.find(node => node.nodeIndex === 95)!;
        assert.deepStrictEqual([node95.fromGeneration, node95.generation], [1, 2]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// the invariant, over random histories
// ─────────────────────────────────────────────────────────────────────────────

/** A small deterministic PRNG, so a failure reproduces. */
function prng(seed: number) {
    let state = seed;
    return (bound: number) => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state % bound;
    };
}

/**
 * Every key a holder of `known` can reach over `edges`: the closure under "I hold the child, so I can open the
 * wrap and hold the parent". Keys are `node:<index>@<generation>`, `user:<id>` and `grant@<epoch>`.
 */
function closure(known: Set<string>, edges: types.cloud.GroupTreeEdge[]): Set<string> {
    const reached = new Set(known);
    let grew = true;
    while (grew) {
        grew = false;
        for (const edge of edges) {
            const child = edge.childKind === "user" ? `user:${edge.childUserId}` : `node:${edge.childIndex}@${edge.childGeneration}`;
            const parent = edge.isGrantEdge ? `grant@${edge.parentGeneration}` : `node:${edge.parentIndex}@${edge.parentGeneration}`;
            if (reached.has(child) && !reached.has(parent)) {
                reached.add(parent);
                grew = true;
            }
        }
    }
    return reached;
}

describe("validateCommit over random histories", () => {
    each<[number]>([[1], [2], [3], [4], [5], [6]]).it("seed %s: every commit passes, every state is valid, removed members lose the epoch", ([seed]) => {
        const random = prng(seed);
        let tree = buildTree(seats(20 + random(60)), 1);
        let epoch = 1;
        let nextId = 1000;
        // What each member has ever been able to open: its own leaf, whatever it minted, whatever it could reach.
        const knowledge = new Map<string, Set<string>>();
        const learn = () => {
            for (const member of tree.leafAssignment.filter(u => u !== "")) {
                knowledge.set(member, closure(new Set([...(knowledge.get(member) ?? []), `user:${member}`]), tree.edges));
            }
        };
        learn();
        const removedEver = new Set<string>();
        for (let step = 0; step < 40; step++) {
            const members = tree.leafAssignment.filter(u => u !== "");
            const committer = members[random(members.length)];
            const roll = random(10);
            let op: PlanOp;
            if (roll < 4 && members.length > 2) {
                const others = members.filter(m => m !== committer);
                const removed = [...new Set([others[random(others.length)], others[random(others.length)]])];
                op = {kind: "remove", committer, removed};
            }
            else if (roll < 7) {
                const blanks = tree.leafAssignment.map((u, i) => u === "" ? i : -1).filter(i => i >= 0);
                const position = blanks.length > 0 && random(2) === 0 ? blanks[0] : tree.numLeaves;
                op = {kind: "add", committer, members: [`n${nextId++}`], positions: [position]};
            }
            else {
                op = {kind: "selfUpdate", committer};
            }
            const c = honest(tree, op, epoch);
            const commit = accepted(c);
            assert.deepStrictEqual(commit.blanked, c.plan.blanked, "the bridge derives the same blank set as the planner");
            if (op.kind === "remove") {
                // SECURITY: whatever the leavers ever knew, closed over the old edges, is blank or re-keyed now.
                for (const removed of op.removed) {
                    const known = closure(knowledge.get(removed)!, c.stored.nodes.length > 0 ? tree.edges : []);
                    for (const node of c.plan.after.nodes.filter(record => record.publicKey)) {
                        assert.ok(!known.has(`node:${node.nodeIndex}@${node.generation}`), `step ${step}: ${removed} keeps node ${node.nodeIndex}`);
                    }
                }
            }
            tree = c.plan.after;
            epoch = c.plan.keyVersion;
            assert.deepStrictEqual(TreeValidator.validateState(tree, rosterOf(tree), epoch), [], `step ${step}: ${JSON.stringify(op)}`);
            // The committer knows what it minted.
            const minted = c.plan.refreshedNodes.map(node => `node:${node.nodeIndex}@${node.generation}`);
            knowledge.set(committer, new Set([...knowledge.get(committer)!, ...minted, `grant@${epoch}`]));
            if (op.kind === "remove") {
                op.removed.forEach(r => removedEver.add(r));
            }
            learn();
            for (const member of tree.leafAssignment.filter(u => u !== "")) {
                assert.ok(knowledge.get(member)!.has(`grant@${epoch}`), `step ${step}: ${member} cannot climb`);
            }
            for (const removed of removedEver) {
                // SECURITY: everything a removed member ever knew, closed over the current edges, stops short of
                // the current grant key.
                assert.ok(!closure(knowledge.get(removed)!, tree.edges).has(`grant@${epoch}`), `step ${step}: ${removed} still reaches epoch ${epoch}`);
            }
        }
    });
    
    it("SECURITY: a self-update minting a node outside the committer's path", () => {
        // A key minted outside one's own subtree without an addition is one nobody asked for; refused outright.
        const c = honest(BASE, {kind: "selfUpdate", committer: "u0"});
        c.submitted.refreshedNodes.push({nodeIndex: 95, fromGeneration: 0, generation: 1, publicKey: "pk:95" as types.core.EccPubKey});
        assert.deepStrictEqual(run(c), {ok: false, rejections: [{kind: "REFRESH_NOT_THE_PATH", missing: [], unexpected: [95]}]});
    });
    
    it("a creation filling only the creator's path", () => {
        const c = honestCreate(seats(64));
        c.submitted.refreshedNodes = c.submitted.refreshedNodes.filter(node => node.nodeIndex !== 95);
        assert.deepStrictEqual(run(c), {ok: false, rejections: [{kind: "REFRESH_NOT_THE_PATH", missing: [95], unexpected: []}]});
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// operation-level refusals
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCommit refuses the operation itself", () => {
    it("a commit planned at another epoch", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u0"});
        c.submitted.baseKeyVersion = EPOCH - 1;
        assert.deepStrictEqual(rejectionKinds(c), ["STALE_BASE_EPOCH"]);
    });
    
    it("SECURITY: a committer holding no seat", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u0"});
        c.op = {kind: "selfUpdate", committer: userId("outsider")};
        assert.deepStrictEqual(rejectionKinds(c), ["MEMBER_HAS_NO_LEAF"]);
    });
    
    it("SECURITY: an outsider seating themselves to become the committer", () => {
        const tree = planCommit(BASE, EPOCH, {kind: "remove", committer: "u0", removed: ["u5"]}).after;
        const c = honest(tree, {kind: "add", committer: "u0", members: ["outsider"], positions: [5]}, EPOCH + 1);
        c.op = {kind: "add", committer: userId("outsider"), addedUsers: [userId("outsider")], positions: [5]};
        assert.deepStrictEqual(rejectionKinds(c), ["MEMBER_HAS_NO_LEAF"]);
    });
    
    it("a creation whose seating leaves the creator out", () => {
        const c = honestCreate(seats(4));
        c.op = {kind: "create", committer: userId("outsider")};
        assert.deepStrictEqual(rejectionKinds(c), ["MEMBER_HAS_NO_LEAF"]);
    });
    
    it("SECURITY: removing yourself", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.op = {kind: "remove", committer: userId("u40"), removedUsers: [userId("u0"), userId("u40")], blankedPositions: [0, 40]};
        assert.deepStrictEqual(rejectionKinds(c), ["SELF_REMOVAL"]);
    });
    
    it("removing somebody who holds no seat", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.op = {kind: "remove", committer: userId("u40"), removedUsers: [userId("ghost")], blankedPositions: [0]};
        assert.deepStrictEqual(rejectionKinds(c), ["MEMBER_HAS_NO_LEAF"]);
    });
    
    it("a removal whose seats do not match its members", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.op = {kind: "remove", committer: userId("u40"), removedUsers: [userId("u0")], blankedPositions: [1]};
        assert.deepStrictEqual(rejectionKinds(c), ["WRONG_SEATS"]);
    });
    
    it("an empty batch", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u0"});
        c.op = {kind: "remove", committer: userId("u0"), removedUsers: [], blankedPositions: []};
        assert.deepStrictEqual(rejectionKinds(c), ["EMPTY_BATCH"]);
        c.op = {kind: "add", committer: userId("u0"), addedUsers: [], positions: []};
        assert.deepStrictEqual(rejectionKinds(c), ["EMPTY_BATCH"]);
    });
    
    it("the same member twice", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.op = {kind: "remove", committer: userId("u40"), removedUsers: [userId("u0"), userId("u0")], blankedPositions: [0, 0]};
        assert.deepStrictEqual(rejectionKinds(c), ["DUPLICATE_MEMBER"]);
    });
    
    it("two newcomers on one seat", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        c.op = {kind: "add", committer: userId("u0"), addedUsers: [userId("a"), userId("b")], positions: [64, 64]};
        assert.deepStrictEqual(rejectionKinds(c), ["DUPLICATE_POSITION"]);
    });
    
    it("more members than seats", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        c.op = {kind: "add", committer: userId("u0"), addedUsers: [userId("a"), userId("b")], positions: [64]};
        assert.deepStrictEqual(rejectionKinds(c), ["MEMBER_COUNT_MISMATCH"]);
    });
    
    it("seating over somebody", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        c.op = {kind: "add", committer: userId("u0"), addedUsers: [userId("a")], positions: [3]};
        assert.deepStrictEqual(rejectionKinds(c), ["SEAT_NOT_BLANK"]);
    });
    
    it("an append that skips a seat", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        c.op = {kind: "add", committer: userId("u0"), addedUsers: [userId("a")], positions: [65]};
        assert.deepStrictEqual(rejectionKinds(c), ["SEAT_OUT_OF_RANGE"]);
    });
    
    it("seating somebody who already holds a seat", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        c.op = {kind: "add", committer: userId("u0"), addedUsers: [userId("u7")], positions: [64]};
        assert.deepStrictEqual(rejectionKinds(c), ["ALREADY_SEATED"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// the re-keyed set
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCommit refuses a wrong re-keyed set", () => {
    it("SECURITY: a remover re-keying the departing member's path instead of its own", () => {
        // The old shape of a removal: u40 mints 31 — a key for a subtree it is not in, and one it keeps.
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.submitted.refreshedNodes = c.submitted.refreshedNodes.map(node => node.nodeIndex === 95 ? {...node, nodeIndex: 31, fromGeneration: 0, generation: 1} : node);
        const result = run(c);
        assert.ok(!result.ok);
        assert.deepStrictEqual(result.rejections, [{kind: "REFRESH_NOT_THE_PATH", missing: [95], unexpected: [31]}]);
    });
    
    it("SECURITY: leaving out the root", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u40"});
        c.submitted.refreshedNodes = c.submitted.refreshedNodes.filter(node => node.nodeIndex !== 63);
        assertRejected(c, "REFRESH_NOT_THE_PATH");
    });
    
    it("a record for a bucket node", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u40"});
        c.submitted.refreshedNodes.push({nodeIndex: 79, generation: 0, publicKey: "pk:79" as types.core.EccPubKey});
        assert.deepStrictEqual(rejectionKinds(c), ["UNEXPECTED_NODE"]);
    });
    
    it("the same node twice", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u40"});
        c.submitted.refreshedNodes.push({...c.submitted.refreshedNodes[0]});
        assert.deepStrictEqual(rejectionKinds(c), ["DUPLICATE_NODE"]);
    });
    
    it("claiming a base generation for a node that has no record", () => {
        // Growth to 65 seats creates the root 127, which has no record yet.
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        const root = c.submitted.refreshedNodes.findIndex(node => node.nodeIndex === 127);
        c.submitted.refreshedNodes[root] = {...c.submitted.refreshedNodes[root], fromGeneration: 0, generation: 1};
        assertRejected(c, "NODE_NOT_NEW");
    });
    
    it("minting a node at a generation other than 0", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        c.submitted.refreshedNodes.find(node => node.nodeIndex === 127)!.generation = 3;
        assertRejected(c, "MINTED_NODE_NOT_AT_ZERO");
    });
    
    it("a base generation the node has moved past", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u40"});
        const root = c.submitted.refreshedNodes.find(node => node.nodeIndex === 63)!;
        root.fromGeneration = 7;
        assertRejected(c, "STALE_BASE_GENERATION");
    });
    
    it("no base generation for a node somebody has filled since", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u40"});
        const root = c.submitted.refreshedNodes.find(node => node.nodeIndex === 63)!;
        delete root.fromGeneration;
        assertRejected(c, "STALE_BASE_GENERATION");
    });
    
    it("a generation that skips ahead", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u40"});
        c.submitted.refreshedNodes.find(node => node.nodeIndex === 63)!.generation = 5;
        assertRejected(c, "NODE_NOT_REFRESHED");
    });
    
    it("SECURITY: a bumped generation carrying the old key", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u0"});
        c.submitted.refreshedNodes.find(node => node.nodeIndex === 31)!.publicKey = BASE.nodes.find(node => node.nodeIndex === 31)!.publicKey!;
        assertRejected(c, "NODE_KEY_REUSED");
    });
    
    it("a node with no key", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u0"});
        c.submitted.refreshedNodes[0].publicKey = "" as types.core.EccPubKey;
        assertRejected(c, "EMPTY_NODE_PUBKEY");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// the edges
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCommit refuses a wrong edge set", () => {
    it("SECURITY: an edge to the member being removed", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u1"]});
        c.submitted.edges.push({parentIndex: 63, parentGeneration: 1, childKind: "user", childUserId: userId("u1"), data: "x" as types.core.UserKeyData});
        assertRejected(c, "UNEXPECTED_EDGE");
    });
    
    it("SECURITY: wrapping the new root to a node the removal blanked", () => {
        // 31 held a key the departing u0 knew; wrapping the new root to it hands u0 the new epoch.
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.submitted.edges.push({parentIndex: 63, parentGeneration: 1, childKind: "node", childIndex: 31, childGeneration: 0, data: "x" as types.core.UserKeyData});
        assertRejected(c, "UNEXPECTED_EDGE");
    });
    
    // The edge kinds themselves are TreeValidator.checkEdges's (TreeValidator.test); this one checks the wiring.
    it("SECURITY: leaving out an edge the path owes", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.submitted.edges = c.submitted.edges.filter(edge => edge.childUserId !== "u5");
        assertRejected(c, "MISSING_EDGE");
    });
    
    it("SECURITY: a removal whose grant edge stays at the old epoch", () => {
        const c = honest(BASE, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.submitted.edges.find(edge => edge.isGrantEdge)!.parentGeneration = EPOCH;
        assertRejected(c, "GRANT_EDGE_WRONG_EPOCH");
    });
    
    it("SECURITY: an addition or a self-update that advances the epoch", () => {
        for (const op of [{kind: "selfUpdate", committer: "u0"}, {kind: "add", committer: "u0", members: ["a"], positions: [64]}] as PlanOp[]) {
            const c = honest(BASE, op);
            c.submitted.edges.find(edge => edge.isGrantEdge)!.parentGeneration = EPOCH + 1;
            assertRejected(c, "GRANT_EDGE_WRONG_EPOCH");
        }
    });
    
    it("a grant edge to the old root after growth", () => {
        const c = honest(BASE, {kind: "add", committer: "u0", members: ["a"], positions: [64]});
        const grant = c.submitted.edges.find(edge => edge.isGrantEdge)!;
        grant.childIndex = 63;
        assertRejected(c, "GRANT_EDGE_WRONG_CHILD");
    });
    
    it("a grant edge naming the root's previous generation", () => {
        const c = honest(BASE, {kind: "selfUpdate", committer: "u0"});
        c.submitted.edges.find(edge => edge.isGrantEdge)!.childGeneration = 0;
        assertRejected(c, "STALE_CHILD_GENERATION");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A-prime: dense fill, knowledge-closure blanking (spec §8 vectors)
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCommit derives Know of the removed members", () => {
    const B64 = BASE;
    const B128 = buildTree(seats(128), EPOCH);
    const after = (tree: types.cloud.GroupTreeState, op: PlanOp, keyVersion = EPOCH) => planCommit(tree, keyVersion, op).after;
    const selfUpdates = (tree: types.cloud.GroupTreeState, ...members: string[]) =>
        members.reduce((t, m) => after(t, {kind: "selfUpdate", committer: m}), tree);
    const removalBlanks = (c: Case) => {
        const commit = accepted(c);
        assert.deepStrictEqual(TreeValidator.validateState(c.plan.after, rosterOf(c.plan.after), commit.keyVersion), []);
        return commit.blanked;
    };
    
    it("V3: a healed path makes the creator's removal blank nothing", () => {
        assert.deepStrictEqual(removalBlanks(honest(selfUpdates(B64, "u40"), {kind: "remove", committer: "u5", removed: ["u0"]})), []);
    });
    
    it("V4: the leaver's own path, minus the remover's", () => {
        assert.deepStrictEqual(removalBlanks(honest(B64, {kind: "remove", committer: "u5", removed: ["u40"]})), [95]);
    });
    
    it("SECURITY V5: an ancestor re-keyed by somebody else is blanked when it wraps to a node the leaver set", () => {
        // u40 re-keyed 63, but 63 still wraps to 31 (set by u0): u0 can open 63, so it is in Know(u0).
        assert.deepStrictEqual(removalBlanks(honest(selfUpdates(B128, "u40"), {kind: "remove", committer: "u100", removed: ["u0"]})), [31, 63, 159]);
    });
    
    it("V6: a batch blanks the union", () => {
        const tree = selfUpdates(B128, "u40", "u70", "u100");
        assert.deepStrictEqual(removalBlanks(honest(tree, {kind: "remove", committer: "u40", removed: ["u0", "u70"]})), [31, 159, 191]);
    });
    
    it("V7/V8: the adder's fills are blanked at the adder's removal", () => {
        const v7 = honest(after(B64, {kind: "remove", committer: "u40", removed: ["u5"]}), {kind: "add", committer: "u40", members: ["n5"], positions: [5]}, EPOCH + 1);
        const added = accepted(v7);
        assert.deepStrictEqual(added.refreshed.map(node => [node.nodeIndex, node.fromGeneration, node.generation]), [[31, 0, 1], [95, 1, 2], [63, 1, 2]]);
        assert.deepStrictEqual(added.blanked, []);
        assert.deepStrictEqual(removalBlanks(honest(v7.plan.after, {kind: "remove", committer: "u0", removed: ["u40"]}, EPOCH + 1)), [95]);
    });
    
    it("V9: a creator that also added is blanked for both", () => {
        let tree = after(selfUpdates(B64, "u40"), {kind: "remove", committer: "u5", removed: ["u41"]});
        tree = after(tree, {kind: "add", committer: "u0", members: ["n41"], positions: [41]}, EPOCH + 1);
        assert.deepStrictEqual(removalBlanks(honest(tree, {kind: "remove", committer: "u40", removed: ["u0"]}, EPOCH + 1)), [31]);
    });
    
    it("V10: a batch of the creator and another", () => {
        assert.deepStrictEqual(removalBlanks(honest(B64, {kind: "remove", committer: "u40", removed: ["u0", "u63"]})), [31]);
    });
    
    it("SECURITY: a removal leaving a node of Know filled is refused", () => {
        // V5 with path-only blanking: 159 (set by u0) kept, 191 wrapping to it instead of to the seats below it.
        const c = honest(selfUpdates(B128, "u40"), {kind: "remove", committer: "u100", removed: ["u0"]});
        const node159 = c.stored.nodes.find(node => node.nodeIndex === 159)!;
        const generation191 = c.submitted.refreshedNodes.find(node => node.nodeIndex === 191)!.generation;
        c.submitted.edges = c.submitted.edges.filter(edge => !(edge.parentIndex === 191 && edge.childKind === "user"));
        c.submitted.edges.push({parentIndex: 191, parentGeneration: generation191, childKind: "node", childIndex: 159, childGeneration: node159.generation, data: "x" as types.core.UserKeyData});
        const kinds = rejectionKinds(c);
        assert.ok(kinds.includes("UNEXPECTED_EDGE") && kinds.includes("MISSING_EDGE"), JSON.stringify(kinds));
    });
    
    it("an addition leaving a newcomer's node unfilled is refused", () => {
        const c = honest(after(B64, {kind: "remove", committer: "u40", removed: ["u5"]}), {kind: "add", committer: "u40", members: ["n5"], positions: [5]}, EPOCH + 1);
        c.submitted.refreshedNodes = c.submitted.refreshedNodes.filter(node => node.nodeIndex !== 31);
        assert.deepStrictEqual(run(c), {ok: false, rejections: [{kind: "REFRESH_NOT_THE_PATH", missing: [31], unexpected: []}]});
    });
    
    it("a removal over a node whose statement is missing fails closed", () => {
        const c = honest(B64, {kind: "remove", committer: "u40", removed: ["u0"]});
        c.stored.setters!.delete(1);
        assert.throws(() => run(c), /names no stored statement/);
    });
});
