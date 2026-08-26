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

/** Why a submitted tree state was rejected. */
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
 * Structural validation of the hidden key tree. Decidable from node indices, generations and roster membership
 * alone — no crypto, no database.
 *
 * The load-bearing rule: **every edge must name the current generation of both endpoints.** Refresh coverage
 * then follows for free — a refreshed node invalidates the generation named by every edge into and out of it,
 * forcing the client to resubmit exactly those edges. No separate coverage rule is needed.
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
