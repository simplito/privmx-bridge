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

/** Why a submitted edge set was rejected. Shared by the whole-state check and the commit check. */
export type EdgeProblem =
    | {kind: "GRANT_EDGE_COUNT", count: number}
    | {kind: "GRANT_EDGE_WRONG_CHILD", expected: string, got: string}
    | {kind: "GRANT_EDGE_WRONG_EPOCH", expected: number, got: number}
    | {kind: "DUPLICATE_EDGE", parent: string, child: string}
    | {kind: "MISSING_EDGE", parent: string, child: string}
    | {kind: "UNEXPECTED_EDGE", parent: string, child: string}
    | {kind: "STALE_PARENT_GENERATION", parent: string, child: string, expected: number, got: number}
    | {kind: "STALE_CHILD_GENERATION", parent: string, child: string, expected: number, got: number}
    | {kind: "EMPTY_EDGE_DATA", parent: string, child: string};

/** Why a stored or submitted tree state was rejected. */
export type TreeProblem =
    | EdgeProblem
    | {kind: "BAD_NUM_LEAVES", numLeaves: number}
    | {kind: "LEAF_COUNT_MISMATCH", expected: number, got: number}
    | {kind: "NO_OCCUPIED_LEAF"}
    | {kind: "DUPLICATE_LEAF_MEMBER", userId: types.cloud.UserId}
    | {kind: "LEAF_MEMBER_NOT_IN_ROSTER", userId: types.cloud.UserId}
    | {kind: "ROSTER_MEMBER_WITHOUT_LEAF", userId: types.cloud.UserId}
    | {kind: "DUPLICATE_NODE", nodeIndex: number}
    | {kind: "UNEXPECTED_NODE", nodeIndex: number}
    | {kind: "BAD_GENERATION", nodeIndex: number, generation: number}
    | {kind: "ROOT_NOT_FILLED", nodeIndex: number};

interface Roster {
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
}

/** What `resolve` and `requiredEdges` read: geometry, seating, and the node records by index. */
export interface TreeView {
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    nodes: Map<number, {generation: number, publicKey?: types.core.EccPubKey}>;
}

/** One element of a resolution: a filled keyed node, or a seated member. */
export type Resolved =
    | {kind: "node", nodeIndex: number, generation: number}
    | {kind: "user", userId: types.cloud.UserId};

/** An edge a state owes, keyed by `edgeId`. `childGeneration` only for a node child. */
export interface RequiredEdge {
    parent: string;
    child: string;
    parentGeneration: number;
    childGeneration?: number;
}

/** What the single grant edge must look like. */
export interface GrantExpectation {
    epoch: number;
    child: string;
    childGeneration?: number;
}

/**
 * Structural validation of the hidden key tree. Decidable from node indices, generations and roster membership
 * alone — no crypto, no database.
 *
 * **The invariant (tree version 2).** A node's private key is known only to members seated in its subtree. That
 * holds because every edge wraps a node key to something *below* it, and the set of edges is not chosen by the
 * client but forced by the state: each filled keyed node `v` wraps to exactly the resolution of each of its
 * children (`resolve`), and nothing else is stored apart from the one grant edge. A blank node passes its
 * children's resolutions up, which is why an edge's parent is the child's lowest *filled* keyed ancestor rather
 * than its structural parent.
 *
 * Every edge also names the current generation of both of its ends, so a re-keyed node invalidates every edge
 * into and out of it and forces exactly those to be resubmitted.
 */
export class TreeValidator {
    
    /**
     * Validates a complete tree state against the roster and the epoch it claims to serve. Used where a whole
     * state is in hand — `verifyGroupTrees.ts` and the conformance test — never on the write path, which checks
     * deltas instead (`TreeTransitionValidator.validateCommit`).
     *
     * @param tree       the state; `nodes` are all records of the group, filled and blank
     * @param roster     the group's users and managers; every member gets exactly one leaf, and no leaf may
     *                   hold a non-member
     * @param keyVersion the epoch the grant edge must be addressed to
     */
    static validateState(tree: types.cloud.GroupTreeState, roster: Roster, keyVersion: number): TreeProblem[] {
        const problems: TreeProblem[] = TreeValidator.validateLeaves(tree, roster);
        if (problems.some(problem => problem.kind === "BAD_NUM_LEAVES" || problem.kind === "LEAF_COUNT_MISMATCH")) {
            return problems;
        }
        const view = TreeValidator.checkNodes(tree, problems);
        const rootIndex = TreeMath.root(tree.numLeaves);
        if (!TreeMath.isLeaf(rootIndex) && !TreeValidator.isFilled(view, rootIndex)) {
            // Every commit re-keys the root, so a state at rest always has it filled — and the grant edge has
            // nothing else to wrap to.
            problems.push({kind: "ROOT_NOT_FILLED", nodeIndex: rootIndex});
        }
        const filled = [...view.nodes.keys()].filter(nodeIndex => TreeValidator.isFilled(view, nodeIndex));
        problems.push(...TreeValidator.checkEdges(
            tree.edges, TreeValidator.requiredEdges(view, filled), TreeValidator.grantExpectation(view, keyVersion),
        ));
        return problems;
    }
    
    /** Geometry and seating against the roster: every member on exactly one leaf, nobody else on any. */
    static validateLeaves(tree: types.cloud.GroupTreeState, roster: Roster): TreeProblem[] {
        if (!Number.isInteger(tree.numLeaves) || tree.numLeaves < 1) {
            return [{kind: "BAD_NUM_LEAVES", numLeaves: tree.numLeaves}];
        }
        if (tree.leafAssignment.length !== tree.numLeaves) {
            return [{kind: "LEAF_COUNT_MISMATCH", expected: tree.numLeaves, got: tree.leafAssignment.length}];
        }
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
    
    /** Records only on keyed nodes, one each, with a sane generation. Returns the records as a view. */
    private static checkNodes(tree: types.cloud.GroupTreeState, problems: TreeProblem[]): TreeView {
        const view: TreeView = {numLeaves: tree.numLeaves, leafAssignment: tree.leafAssignment, nodes: new Map()};
        for (const node of tree.nodes) {
            if (view.nodes.has(node.nodeIndex)) {
                problems.push({kind: "DUPLICATE_NODE", nodeIndex: node.nodeIndex});
                continue;
            }
            if (!Number.isInteger(node.nodeIndex) || node.nodeIndex < 0 || !TreeMath.isKeyed(node.nodeIndex, tree.numLeaves)) {
                // A record on a leaf would be a second key where the member's long-term key is the design; one
                // on a bucket node would be a key nothing is allowed to wrap to.
                problems.push({kind: "UNEXPECTED_NODE", nodeIndex: node.nodeIndex});
                continue;
            }
            if (!Number.isInteger(node.generation) || node.generation < 0) {
                problems.push({kind: "BAD_GENERATION", nodeIndex: node.nodeIndex, generation: node.generation});
            }
            view.nodes.set(node.nodeIndex, node);
        }
        return view;
    }
    
    /** A keyed node with a record that carries a public key. Anything else resolves through its children. */
    static isFilled(view: TreeView, nodeIndex: number): boolean {
        return TreeMath.isKeyed(nodeIndex, view.numLeaves) && !!view.nodes.get(nodeIndex)?.publicKey;
    }
    
    /**
     * The resolution of a node: the nearest filled keyed nodes and seated members covering its subtree.
     *
     * A seated leaf resolves to its member, a blank leaf to nothing, a filled keyed node to itself; anything else
     * — a blank keyed node, a keyed node with no record, a bucket node — to its two children's resolutions.
     */
    static resolve(view: TreeView, nodeIndex: number): Resolved[] {
        if (TreeMath.isLeaf(nodeIndex)) {
            const userId = view.leafAssignment[TreeMath.leafPosition(nodeIndex)];
            return userId ? [{kind: "user", userId}] : [];
        }
        if (TreeValidator.isFilled(view, nodeIndex)) {
            return [{kind: "node", nodeIndex, generation: view.nodes.get(nodeIndex)!.generation}];
        }
        return TreeMath.children(nodeIndex, view.numLeaves).flatMap(child => TreeValidator.resolve(view, child));
    }
    
    /**
     * The edges the given filled nodes owe in `view`: for each one, a wrap to every element of each child's
     * resolution. This is the whole of what a parent may wrap to — never a node or member outside its subtree.
     */
    static requiredEdges(view: TreeView, parents: number[]): Map<string, RequiredEdge> {
        const required = new Map<string, RequiredEdge>();
        for (const parentIndex of parents) {
            const parentGeneration = view.nodes.get(parentIndex)!.generation;
            for (const childIndex of TreeMath.children(parentIndex, view.numLeaves)) {
                for (const resolved of TreeValidator.resolve(view, childIndex)) {
                    if (resolved.kind === "user") {
                        required.set(`${parentIndex}>user:${resolved.userId}`, {
                            parent: `node:${parentIndex}`, child: `user:${resolved.userId}`, parentGeneration,
                        });
                    }
                    else {
                        required.set(`${parentIndex}>node:${resolved.nodeIndex}`, {
                            parent: `node:${parentIndex}`, child: `node:${resolved.nodeIndex}`, parentGeneration,
                            childGeneration: resolved.generation,
                        });
                    }
                }
            }
        }
        return required;
    }
    
    /**
     * The grant edge joins the grant keypair of the current epoch to the tree root. Its `parentGeneration`
     * carries the epoch rather than a node generation, which is what ties the tree to `keyVersion`. A one-member
     * group has no internal node at all — the root *is* the member's leaf — so the grant key is wrapped straight
     * to them.
     */
    static grantExpectation(view: TreeView, epoch: number): GrantExpectation {
        const rootIndex = TreeMath.root(view.numLeaves);
        if (TreeMath.isLeaf(rootIndex)) {
            return {epoch, child: `user:${view.leafAssignment[0]}`};
        }
        const root = view.nodes.get(rootIndex);
        return {epoch, child: `node:${rootIndex}`, ...(root ? {childGeneration: root.generation} : {})};
    }
    
    /** Checks a submitted edge set is exactly `required` plus one grant edge as `grant` describes. */
    static checkEdges(edges: types.cloud.GroupTreeEdge[], required: Map<string, RequiredEdge>, grant: GrantExpectation): EdgeProblem[] {
        const problems: EdgeProblem[] = [];
        const seen = new Set<string>();
        let grantEdges = 0;
        for (const edge of edges) {
            const describe = TreeValidator.describe(edge);
            if (!edge.data) {
                problems.push({kind: "EMPTY_EDGE_DATA", ...describe});
            }
            if (edge.isGrantEdge) {
                grantEdges++;
                problems.push(...TreeValidator.checkGrantEdge(edge, grant));
                continue;
            }
            const key = TreeValidator.edgeId(edge);
            if (seen.has(key)) {
                problems.push({kind: "DUPLICATE_EDGE", ...describe});
                continue;
            }
            seen.add(key);
            const expected = required.get(key);
            if (!expected) {
                problems.push({kind: "UNEXPECTED_EDGE", ...describe});
                continue;
            }
            if (edge.parentGeneration !== expected.parentGeneration) {
                problems.push({kind: "STALE_PARENT_GENERATION", ...describe, expected: expected.parentGeneration, got: edge.parentGeneration});
            }
            if (expected.childGeneration !== undefined && edge.childGeneration !== expected.childGeneration) {
                problems.push({kind: "STALE_CHILD_GENERATION", ...describe, expected: expected.childGeneration, got: edge.childGeneration ?? -1});
            }
        }
        for (const [key, expected] of required) {
            if (!seen.has(key)) {
                problems.push({kind: "MISSING_EDGE", parent: expected.parent, child: expected.child});
            }
        }
        if (grantEdges !== 1) {
            problems.push({kind: "GRANT_EDGE_COUNT", count: grantEdges});
        }
        return problems;
    }
    
    private static checkGrantEdge(edge: types.cloud.GroupTreeEdge, grant: GrantExpectation): EdgeProblem[] {
        const problems: EdgeProblem[] = [];
        if (edge.parentGeneration !== grant.epoch) {
            problems.push({kind: "GRANT_EDGE_WRONG_EPOCH", expected: grant.epoch, got: edge.parentGeneration});
        }
        const child = TreeValidator.describe(edge).child;
        if (child !== grant.child) {
            problems.push({kind: "GRANT_EDGE_WRONG_CHILD", expected: grant.child, got: child});
            return problems;
        }
        if (grant.childGeneration !== undefined && edge.childGeneration !== grant.childGeneration) {
            problems.push({
                kind: "STALE_CHILD_GENERATION",
                parent: `grant@${grant.epoch}`,
                child,
                expected: grant.childGeneration,
                got: edge.childGeneration ?? -1,
            });
        }
        return problems;
    }
    
    private static edgeId(edge: types.cloud.GroupTreeEdge): string {
        const child = edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`;
        return `${edge.parentIndex ?? -1}>${child}`;
    }
    
    private static describe(edge: types.cloud.GroupTreeEdge): {parent: string, child: string} {
        return {
            parent: edge.isGrantEdge ? "grant" : `node:${edge.parentIndex ?? -1}`,
            child: edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`,
        };
    }
}
