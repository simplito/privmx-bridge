/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import { TreeMath } from "./TreeMath";

/**
 * Why a submitted tree state was rejected. Every one of these is decidable from integers and string equality —
 * the bridge holds no key material and needs none to catch a malformed or dishonest submission.
 */
export type TreeProblem =
    | {kind: "BAD_NUM_LEAVES", numLeaves: number}
    | {kind: "LEAF_COUNT_MISMATCH", expected: number, got: number}
    | {kind: "NO_OCCUPIED_LEAF"}
    | {kind: "DUPLICATE_LEAF_MEMBER", userId: types.cloud.UserId}
    | {kind: "LEAF_MEMBER_NOT_IN_ROSTER", userId: types.cloud.UserId}
    | {kind: "ROSTER_MEMBER_WITHOUT_LEAF", userId: types.cloud.UserId}
    | {kind: "DUPLICATE_NODE", nodeIndex: number}
    | {kind: "MISSING_NODE", nodeIndex: number}
    | {kind: "UNEXPECTED_NODE", nodeIndex: number}
    | {kind: "BAD_GENERATION", nodeIndex: number, generation: number}
    | {kind: "EMPTY_NODE_PUBKEY", nodeIndex: number}
    | {kind: "GRANT_EDGE_COUNT", count: number}
    | {kind: "GRANT_EDGE_WRONG_CHILD", expected: string, got: string}
    | {kind: "GRANT_EDGE_WRONG_EPOCH", expected: number, got: number}
    | {kind: "DUPLICATE_EDGE", edge: EdgeKey}
    | {kind: "MISSING_EDGE", edge: EdgeKey}
    | {kind: "UNEXPECTED_EDGE", edge: EdgeKey}
    | {kind: "STALE_PARENT_GENERATION", edge: EdgeKey, expected: number, got: number}
    | {kind: "STALE_CHILD_GENERATION", edge: EdgeKey, expected: number, got: number}
    | {kind: "EMPTY_EDGE_DATA", edge: EdgeKey};

/** Why a submitted transition (a removal or an addition) was rejected. */
export type TransitionProblem =
    | {kind: "NUM_LEAVES_CHANGED", from: number, to: number}
    | {kind: "NUM_LEAVES_WRONG_FOR_POSITION", expected: number, got: number}
    | {kind: "MEMBER_HAS_NO_LEAF", userId: types.cloud.UserId}
    | {kind: "LEAF_NOT_BLANKED", position: number}
    | {kind: "LEAF_ASSIGNMENT_CHANGED", position: number, from: string, to: string}
    | {kind: "SEAT_NOT_TAKEN", position: number, got: string}
    | {kind: "SEAT_NOT_BLANK_BEFORE", position: number, occupant: string}
    | {kind: "NODE_NOT_REFRESHED", nodeIndex: number}
    | {kind: "NODE_KEY_REUSED", nodeIndex: number}
    | {kind: "NODE_REFRESHED_NEEDLESSLY", nodeIndex: number}
    | {kind: "EPOCH_NOT_ADVANCED", from: number, to: number}
    | {kind: "EPOCH_CHANGED", epoch: number};

/** Identifies an edge for error reporting: which parent, which child. */
export interface EdgeKey {
    parent: string;
    child: string;
}

interface Roster {
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
}

/**
 * Structural validation of the hidden key tree.
 *
 * The bridge cannot decrypt an edge, so it cannot check that a wrap contains what it claims. What it *can*
 * check is that the submitted state is the right shape, and that a transition touched exactly the nodes it was
 * obliged to touch — no fewer (which would leave a removed member reading new content) and no more (which
 * would be unrequested work charged to everyone else). Both reduce to comparing node indices and generations,
 * which is why this file is pure arithmetic and has no dependency on crypto or the database.
 *
 * The rule that does most of the work is deceptively small: **every edge must name the current generation of
 * both endpoints.** Coverage of a refresh then follows for free. If a node is refreshed, each edge into it and
 * out of it names a generation that no longer matches, so the client is forced to resubmit exactly the edges
 * the refresh invalidated — no separate coverage rule is needed. See
 * documents/nested_groups/09-hidden-key-tree.md §6.
 */
export class TreeValidator {
    
    /**
     * Validates a complete tree state against the roster and the epoch it claims to serve.
     *
     * @param tree       the submitted state
     * @param roster     the group's users and managers; every member gets exactly one leaf, and no leaf may
     *                   hold a non-member
     * @param keyVersion the epoch the grant edge must be addressed to
     */
    static validateState(tree: types.cloud.GroupTreeState, roster: Roster, keyVersion: number): TreeProblem[] {
        const problems: TreeProblem[] = [];
        if (!Number.isInteger(tree.numLeaves) || tree.numLeaves < 1) {
            return [{kind: "BAD_NUM_LEAVES", numLeaves: tree.numLeaves}];
        }
        const numLeaves = tree.numLeaves;
        if (tree.leafAssignment.length !== numLeaves) {
            return [{kind: "LEAF_COUNT_MISMATCH", expected: numLeaves, got: tree.leafAssignment.length}];
        }
        problems.push(...TreeValidator.checkLeaves(tree, roster));
        const generations = TreeValidator.checkNodes(tree, numLeaves, problems);
        problems.push(...TreeValidator.checkEdges(tree, numLeaves, keyVersion, generations));
        return problems;
    }
    
    /**
     * Validates a removal: the leaf is blanked, every node on its direct path is refreshed with a genuinely new
     * key, nothing off that path is touched, and the epoch advances.
     *
     * The epoch must advance because the grant keypair is replaced — that is what makes every container holding
     * a wrap of the old grant key stale, and so what makes the removal effective rather than cosmetic.
     */
    static validateRemoval(
        oldTree: types.cloud.GroupTreeState,
        newTree: types.cloud.GroupTreeState,
        removedUser: types.cloud.UserId,
        oldKeyVersion: number,
        newKeyVersion: number,
    ): TransitionProblem[] {
        const problems: TransitionProblem[] = [];
        if (oldTree.numLeaves !== newTree.numLeaves) {
            // A removal leaves a blank rather than compacting the array: moving members would invalidate
            // everyone's cached position for no gain.
            return [{kind: "NUM_LEAVES_CHANGED", from: oldTree.numLeaves, to: newTree.numLeaves}];
        }
        if (newKeyVersion <= oldKeyVersion) {
            problems.push({kind: "EPOCH_NOT_ADVANCED", from: oldKeyVersion, to: newKeyVersion});
        }
        const position = oldTree.leafAssignment.indexOf(removedUser);
        if (position < 0) {
            problems.push({kind: "MEMBER_HAS_NO_LEAF", userId: removedUser});
            return problems;
        }
        if (newTree.leafAssignment[position] !== "") {
            problems.push({kind: "LEAF_NOT_BLANKED", position});
        }
        for (let i = 0; i < oldTree.numLeaves; i++) {
            if (i !== position && oldTree.leafAssignment[i] !== newTree.leafAssignment[i]) {
                problems.push({
                    kind: "LEAF_ASSIGNMENT_CHANGED",
                    position: i,
                    from: oldTree.leafAssignment[i],
                    to: newTree.leafAssignment[i],
                });
            }
        }
        const mustRefresh = new Set(TreeMath.directPath(position, oldTree.numLeaves));
        problems.push(...TreeValidator.compareNodes(oldTree, newTree, mustRefresh));
        return problems;
    }
    
    /**
     * Validates an addition: the newcomer takes a blank (or an appended position), the epoch does not move, and
     * nothing outside the new leaf's direct path changes.
     *
     * The epoch not moving is the reason the grant keypair sits one indirection above the root. Growth may
     * create a new root and re-link the grant edge to it, but the grant keypair itself is untouched, so no
     * container holding a wrap of it goes stale. Adding a member costs the group nothing beyond one path.
     *
     * The path **may** be refreshed, and usually has to be. An edge wraps the parent's private key, so seating
     * somebody under an existing node means holding that node's private key — and keys are only ever recovered
     * by climbing from one's own leaf, which reaches exactly one lowest-level node: the caller's own parent. A
     * caller who cannot refresh can therefore fill only the seat next to their own, which is not a permission
     * rule and not one anybody can satisfy on purpose. Refreshing the path replaces that with wraps to public
     * keys, which need no secret at all.
     *
     * Unlike a removal, the refresh is optional rather than obligatory: nobody loses access here, and the
     * newcomer learns the current keys on their path either way. A client that can seat somebody without
     * refreshing still may.
     */
    static validateAddition(
        oldTree: types.cloud.GroupTreeState,
        newTree: types.cloud.GroupTreeState,
        addedUser: types.cloud.UserId,
        position: number,
        oldKeyVersion: number,
        newKeyVersion: number,
    ): TransitionProblem[] {
        const problems: TransitionProblem[] = [];
        if (oldKeyVersion !== newKeyVersion) {
            problems.push({kind: "EPOCH_CHANGED", epoch: newKeyVersion});
        }
        const expectedLeaves = TreeMath.numLeavesToSeat(position, oldTree.numLeaves);
        if (newTree.numLeaves !== expectedLeaves) {
            problems.push({kind: "NUM_LEAVES_WRONG_FOR_POSITION", expected: expectedLeaves, got: newTree.numLeaves});
            return problems;
        }
        if (position < oldTree.numLeaves && oldTree.leafAssignment[position] !== "") {
            problems.push({kind: "SEAT_NOT_BLANK_BEFORE", position, occupant: oldTree.leafAssignment[position]});
        }
        if (newTree.leafAssignment[position] !== addedUser) {
            problems.push({kind: "SEAT_NOT_TAKEN", position, got: newTree.leafAssignment[position]});
        }
        for (let i = 0; i < newTree.numLeaves; i++) {
            if (i === position) {
                continue;
            }
            const before = i < oldTree.numLeaves ? oldTree.leafAssignment[i] : "";
            if (before !== newTree.leafAssignment[i]) {
                problems.push({kind: "LEAF_ASSIGNMENT_CHANGED", position: i, from: before, to: newTree.leafAssignment[i]});
            }
        }
        // Nodes on the new leaf's path may be refreshed; nodes that did not exist before (growth creates them)
        // are free — they carry no history anyone relies on. Everything else must come through untouched.
        const mayRefresh = new Set(TreeMath.directPath(position, newTree.numLeaves));
        problems.push(...TreeValidator.compareNodes(oldTree, newTree, new Set(), mayRefresh));
        return problems;
    }
    
    /**
     * Compares node sets: `mustRefresh` has to advance its generation and change its public key, `mayRefresh` is
     * allowed to do either that or nothing at all, and everything else present in both trees has to be
     * byte-identical.
     */
    private static compareNodes(
        oldTree: types.cloud.GroupTreeState,
        newTree: types.cloud.GroupTreeState,
        mustRefresh: Set<number>,
        mayRefresh: Set<number> = new Set(),
    ): TransitionProblem[] {
        const problems: TransitionProblem[] = [];
        const before = new Map(oldTree.nodes.map(n => [n.nodeIndex, n]));
        const after = new Map(newTree.nodes.map(n => [n.nodeIndex, n]));
        for (const [nodeIndex, oldNode] of before) {
            const newNode = after.get(nodeIndex);
            if (!newNode) {
                // Reported by validateState as a missing node; nothing to add here.
                continue;
            }
            if (mustRefresh.has(nodeIndex)) {
                if (newNode.generation <= oldNode.generation) {
                    problems.push({kind: "NODE_NOT_REFRESHED", nodeIndex});
                }
                if (newNode.publicKey === oldNode.publicKey) {
                    // A bumped generation carrying the same public key is the exact shape of a removal that
                    // looks done and is not: the removed member still holds the matching private key.
                    problems.push({kind: "NODE_KEY_REUSED", nodeIndex});
                }
            }
            else if (newNode.generation === oldNode.generation && newNode.publicKey === oldNode.publicKey) {
                continue; // untouched, which is what every node outside a refresh has to be
            }
            else if (!mayRefresh.has(nodeIndex)) {
                problems.push({kind: "NODE_REFRESHED_NEEDLESSLY", nodeIndex});
            }
            else {
                // Refreshing was allowed, so the only thing left to check is that it is a real refresh: a bumped
                // generation carrying the old public key, or a new key at the old generation, leaves the stored
                // state describing something that is not what the client holds.
                if (newNode.generation <= oldNode.generation) {
                    problems.push({kind: "NODE_NOT_REFRESHED", nodeIndex});
                }
                if (newNode.publicKey === oldNode.publicKey) {
                    problems.push({kind: "NODE_KEY_REUSED", nodeIndex});
                }
            }
        }
        for (const nodeIndex of mustRefresh) {
            if (before.has(nodeIndex) && !after.has(nodeIndex)) {
                problems.push({kind: "NODE_NOT_REFRESHED", nodeIndex});
            }
        }
        return problems;
    }
    
    private static checkLeaves(tree: types.cloud.GroupTreeState, roster: Roster): TreeProblem[] {
        const problems: TreeProblem[] = [];
        const members = new Set<string>([...roster.users, ...roster.managers]);
        const seated = new Set<string>();
        let occupied = 0;
        for (const userId of tree.leafAssignment) {
            if (userId === "") {
                continue;
            }
            occupied++;
            if (seated.has(userId)) {
                problems.push({kind: "DUPLICATE_LEAF_MEMBER", userId});
                continue;
            }
            seated.add(userId);
            if (!members.has(userId)) {
                problems.push({kind: "LEAF_MEMBER_NOT_IN_ROSTER", userId});
            }
        }
        for (const userId of members) {
            if (!seated.has(userId)) {
                problems.push({kind: "ROSTER_MEMBER_WITHOUT_LEAF", userId: userId as types.cloud.UserId});
            }
        }
        if (occupied === 0) {
            problems.push({kind: "NO_OCCUPIED_LEAF"});
        }
        return problems;
    }
    
    /** Checks the node set covers exactly the internal nodes, and returns nodeIndex → current generation. */
    private static checkNodes(
        tree: types.cloud.GroupTreeState,
        numLeaves: number,
        problems: TreeProblem[],
    ): Map<number, number> {
        const generations = new Map<number, number>();
        for (const node of tree.nodes) {
            if (generations.has(node.nodeIndex)) {
                problems.push({kind: "DUPLICATE_NODE", nodeIndex: node.nodeIndex});
                continue;
            }
            generations.set(node.nodeIndex, node.generation);
            if (!Number.isInteger(node.nodeIndex) || node.nodeIndex < 0
                || !TreeMath.exists(node.nodeIndex, numLeaves) || TreeMath.isLeaf(node.nodeIndex)) {
                // Leaves carry no node keypair: a member's own long-term key *is* the leaf. Publishing one
                // would be a second key where the design has one.
                problems.push({kind: "UNEXPECTED_NODE", nodeIndex: node.nodeIndex});
            }
            if (!Number.isInteger(node.generation) || node.generation < 0) {
                problems.push({kind: "BAD_GENERATION", nodeIndex: node.nodeIndex, generation: node.generation});
            }
            if (!node.publicKey) {
                problems.push({kind: "EMPTY_NODE_PUBKEY", nodeIndex: node.nodeIndex});
            }
        }
        for (const nodeIndex of TreeValidator.internalNodes(numLeaves)) {
            if (!generations.has(nodeIndex)) {
                problems.push({kind: "MISSING_NODE", nodeIndex});
            }
        }
        return generations;
    }
    
    /**
     * Checks the edge set is exactly the required one: two edges per internal node (one per existing child,
     * skipping blank leaves), plus one grant edge, all naming current generations.
     */
    private static checkEdges(
        tree: types.cloud.GroupTreeState,
        numLeaves: number,
        keyVersion: number,
        generations: Map<number, number>,
    ): TreeProblem[] {
        const problems: TreeProblem[] = [];
        const required = TreeValidator.requiredEdges(tree, numLeaves, generations);
        const seen = new Set<string>();
        let grantEdges = 0;
        
        for (const edge of tree.edges) {
            if (!edge.data) {
                problems.push({kind: "EMPTY_EDGE_DATA", edge: TreeValidator.describe(edge)});
            }
            if (edge.isGrantEdge) {
                grantEdges++;
                problems.push(...TreeValidator.checkGrantEdge(edge, tree, numLeaves, keyVersion, generations));
                continue;
            }
            const key = TreeValidator.edgeId(edge);
            if (seen.has(key)) {
                problems.push({kind: "DUPLICATE_EDGE", edge: TreeValidator.describe(edge)});
                continue;
            }
            seen.add(key);
            const expected = required.get(key);
            if (!expected) {
                problems.push({kind: "UNEXPECTED_EDGE", edge: TreeValidator.describe(edge)});
                continue;
            }
            if (edge.parentGeneration !== expected.parentGeneration) {
                problems.push({
                    kind: "STALE_PARENT_GENERATION",
                    edge: TreeValidator.describe(edge),
                    expected: expected.parentGeneration,
                    got: edge.parentGeneration,
                });
            }
            if (expected.childGeneration !== undefined && edge.childGeneration !== expected.childGeneration) {
                problems.push({
                    kind: "STALE_CHILD_GENERATION",
                    edge: TreeValidator.describe(edge),
                    expected: expected.childGeneration,
                    got: edge.childGeneration ?? -1,
                });
            }
        }
        for (const [key, expected] of required) {
            if (!seen.has(key)) {
                problems.push({kind: "MISSING_EDGE", edge: expected.describe});
            }
        }
        if (grantEdges !== 1) {
            problems.push({kind: "GRANT_EDGE_COUNT", count: grantEdges});
        }
        return problems;
    }
    
    /**
     * The grant edge joins the grant keypair of the current epoch to the tree root. Its `parentGeneration`
     * carries the epoch rather than a node generation, which is what ties the tree to `keyVersion`.
     */
    private static checkGrantEdge(
        edge: types.cloud.GroupTreeEdge,
        tree: types.cloud.GroupTreeState,
        numLeaves: number,
        keyVersion: number,
        generations: Map<number, number>,
    ): TreeProblem[] {
        const problems: TreeProblem[] = [];
        if (edge.parentGeneration !== keyVersion) {
            problems.push({kind: "GRANT_EDGE_WRONG_EPOCH", expected: keyVersion, got: edge.parentGeneration});
        }
        const rootIndex = TreeMath.root(numLeaves);
        if (TreeMath.isLeaf(rootIndex)) {
            // A one-member group has no internal node at all: the root *is* the member's leaf, so the grant key
            // is wrapped straight to them.
            const holder = tree.leafAssignment[0];
            if (edge.childKind !== "user" || edge.childUserId !== holder) {
                problems.push({
                    kind: "GRANT_EDGE_WRONG_CHILD",
                    expected: `user:${holder}`,
                    got: `${edge.childKind}:${edge.childUserId ?? edge.childIndex}`,
                });
            }
            return problems;
        }
        if (edge.childKind !== "node" || edge.childIndex !== rootIndex) {
            problems.push({
                kind: "GRANT_EDGE_WRONG_CHILD",
                expected: `node:${rootIndex}`,
                got: `${edge.childKind}:${edge.childUserId ?? edge.childIndex}`,
            });
            return problems;
        }
        const rootGeneration = generations.get(rootIndex);
        if (rootGeneration !== undefined && edge.childGeneration !== rootGeneration) {
            problems.push({
                kind: "STALE_CHILD_GENERATION",
                edge: {parent: `grant@${keyVersion}`, child: `node:${rootIndex}`},
                expected: rootGeneration,
                got: edge.childGeneration ?? -1,
            });
        }
        return problems;
    }
    
    /**
     * The edge set a well-formed tree must carry: for each internal node, one edge to each existing child,
     * except that a blank leaf gets none — there is nobody to wrap to.
     */
    private static requiredEdges(
        tree: types.cloud.GroupTreeState,
        numLeaves: number,
        generations: Map<number, number>,
    ): Map<string, {parentGeneration: number, childGeneration?: number, describe: EdgeKey}> {
        const required = new Map<string, {parentGeneration: number, childGeneration?: number, describe: EdgeKey}>();
        for (const parentIndex of TreeValidator.internalNodes(numLeaves)) {
            const parentGeneration = generations.get(parentIndex);
            if (parentGeneration === undefined) {
                continue; // already reported as a missing node
            }
            for (const childIndex of TreeMath.children(parentIndex, numLeaves)) {
                if (TreeMath.isLeaf(childIndex)) {
                    const userId = tree.leafAssignment[TreeMath.leafPosition(childIndex)];
                    if (!userId) {
                        continue;
                    }
                    required.set(`${parentIndex}>user:${userId}`, {
                        parentGeneration,
                        describe: {parent: `node:${parentIndex}`, child: `user:${userId}`},
                    });
                }
                else {
                    const childGeneration = generations.get(childIndex);
                    const entry: {parentGeneration: number, childGeneration?: number, describe: EdgeKey} = {
                        parentGeneration,
                        describe: {parent: `node:${parentIndex}`, child: `node:${childIndex}`},
                    };
                    if (childGeneration !== undefined) {
                        entry.childGeneration = childGeneration;
                    }
                    required.set(`${parentIndex}>node:${childIndex}`, entry);
                }
            }
        }
        return required;
    }
    
    /** Internal nodes of a tree of the given size: the odd indices, leaves being the even ones. */
    static internalNodes(numLeaves: number): number[] {
        const count = TreeMath.nodeCount(numLeaves);
        const result: number[] = [];
        for (let nodeIndex = 1; nodeIndex < count; nodeIndex += 2) {
            result.push(nodeIndex);
        }
        return result;
    }
    
    private static edgeId(edge: types.cloud.GroupTreeEdge): string {
        const child = edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`;
        return `${edge.parentIndex ?? -1}>${child}`;
    }
    
    private static describe(edge: types.cloud.GroupTreeEdge): EdgeKey {
        return {
            parent: edge.isGrantEdge ? "grant" : `node:${edge.parentIndex ?? -1}`,
            child: edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`,
        };
    }
}
