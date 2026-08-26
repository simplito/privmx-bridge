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
 * Why a submitted transition was rejected.
 *
 * `STALE_BASE_*` are the preconditions that make a delta safe to apply at all. The rest mirror the rules
 * `TreeValidator` applies to a whole submitted tree — the same requirements, checked against the state the bridge
 * already holds instead of against a copy the client sends back.
 */
export type TransitionRejection =
    | {kind: "STALE_BASE_EPOCH", expected: number, got: number}
    | {kind: "STALE_BASE_GENERATION", nodeIndex: number, expected: number, got: number}
    | {kind: "MEMBER_HAS_NO_LEAF", userId: types.cloud.UserId}
    | {kind: "WRONG_SEAT", expected: number, got: number}
    | {kind: "REFRESH_NOT_THE_PATH", missing: number[], unexpected: number[]}
    | {kind: "NODE_NOT_REFRESHED", nodeIndex: number}
    | {kind: "NODE_KEY_REUSED", nodeIndex: number}
    | {kind: "EMPTY_NODE_PUBKEY", nodeIndex: number}
    | {kind: "MISSING_EDGE", parent: string, child: string}
    | {kind: "UNEXPECTED_EDGE", parent: string, child: string}
    | {kind: "DUPLICATE_EDGE", parent: string, child: string}
    | {kind: "STALE_PARENT_GENERATION", parent: string, child: string, expected: number, got: number}
    | {kind: "STALE_CHILD_GENERATION", parent: string, child: string, expected: number, got: number}
    | {kind: "EMPTY_EDGE_DATA", parent: string, child: string}
    | {kind: "GRANT_EDGE_COUNT", count: number}
    | {kind: "GRANT_EDGE_WRONG_EPOCH", expected: number, got: number}
    | {kind: "GRANT_EDGE_WRONG_CHILD", expected: string, got: string}
    | {kind: "SEAT_NOT_BLANK", position: number, occupant: types.cloud.UserId}
    | {kind: "SEAT_OUT_OF_RANGE", position: number, numLeaves: number}
    | {kind: "ALREADY_SEATED", userId: types.cloud.UserId, position: number}
    | {kind: "NODE_NOT_NEW", nodeIndex: number}
    | {kind: "MINTED_NODE_NOT_AT_ZERO", nodeIndex: number, got: number};

/** The stored state a transition is checked against — the path and copath of the affected seat, nothing more. */
export interface StoredPathState {
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    keyVersion: number;
    /** Nodes on the path and the copath of the blanked seat, as stored. */
    nodes: types.cloud.GroupTreeNode[];
}

/**
 * Checks a transition against stored state rather than re-validating the whole tree: the stored state was
 * validated when written, this delta is checked against it, and the two give the same guarantee by induction.
 *
 * That argument holds only while **nothing writes tree state without passing through a validator**. A migration
 * or repair script that skips one breaks the invariant silently — run `verifyGroupTrees.ts` after any such write.
 */
export class TreeTransitionValidator {
    
    static validateRemoval(
        stored: StoredPathState,
        transition: types.cloud.GroupTreeTransition,
        removedUser: types.cloud.UserId,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        if (transition.baseKeyVersion !== stored.keyVersion) {
            // Nothing else is worth checking: every generation in the delta was read at another epoch.
            return [{kind: "STALE_BASE_EPOCH", expected: stored.keyVersion, got: transition.baseKeyVersion}];
        }
        const position = stored.leafAssignment.indexOf(removedUser);
        if (position < 0) {
            return [{kind: "MEMBER_HAS_NO_LEAF", userId: removedUser}];
        }
        if (transition.blankedPosition !== position) {
            return [{kind: "WRONG_SEAT", expected: position, got: transition.blankedPosition}];
        }
        
        const path = TreeMath.directPath(position, stored.numLeaves);
        const storedNodes = new Map(stored.nodes.map(node => [node.nodeIndex, node]));
        const refreshed = new Map(transition.refreshedNodes.map(node => [node.nodeIndex, node]));
        problems.push(...TreeTransitionValidator.checkRefreshedNodes(path, storedNodes, refreshed));
        if (problems.length > 0) {
            // Generations below are computed from the refresh set; checking edges against a wrong one only
            // produces noise.
            return problems;
        }
        const newEpoch = stored.keyVersion + 1;
        problems.push(...TreeTransitionValidator.checkEdges(stored, transition, position, path, storedNodes, refreshed, newEpoch));
        return problems;
    }
    
    /**
     * Checks an addition delta. Two things differ from a removal: the epoch **does not move**, and the path is
     * evaluated in the geometry seating the newcomer produces — appending past the last leaf mints nodes that do
     * not exist yet, so a seated node may legitimately have no previous generation.
     */
    static validateAddition(
        stored: StoredPathState,
        transition: types.cloud.GroupTreeAdditionTransition,
        addedUser: types.cloud.UserId,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        if (transition.baseKeyVersion !== stored.keyVersion) {
            return [{kind: "STALE_BASE_EPOCH", expected: stored.keyVersion, got: transition.baseKeyVersion}];
        }
        const alreadyAt = stored.leafAssignment.indexOf(addedUser);
        if (alreadyAt >= 0) {
            return [{kind: "ALREADY_SEATED", userId: addedUser, position: alreadyAt}];
        }
        const position = transition.position;
        if (!Number.isInteger(position) || position < 0 || position > stored.numLeaves) {
            // Seats are filled lowest-blank-first and only ever appended, so anything past the end is a client
            // that computed against a different tree.
            return [{kind: "SEAT_OUT_OF_RANGE", position, numLeaves: stored.numLeaves}];
        }
        if (position < stored.numLeaves && stored.leafAssignment[position] !== "") {
            return [{kind: "SEAT_NOT_BLANK", position, occupant: stored.leafAssignment[position]}];
        }
        
        const numLeaves = TreeMath.numLeavesToSeat(position, stored.numLeaves);
        const path = TreeMath.directPath(position, numLeaves);
        const storedNodes = new Map(stored.nodes.map(node => [node.nodeIndex, node]));
        const seated = new Map(transition.seatedNodes.map(node => [node.nodeIndex, node]));
        problems.push(...TreeTransitionValidator.checkSeatedNodes(path, storedNodes, seated));
        if (problems.length > 0) {
            return problems;
        }
        problems.push(...TreeTransitionValidator.checkAdditionEdges(
            stored, transition, addedUser, position, numLeaves, path, storedNodes, seated,
        ));
        return problems;
    }
    
    /**
     * Exactly the new leaf's path: nodes that existed advance one generation with a new key, nodes that did not
     * arrive at generation 0.
     *
     * A node claimed as minted when the bridge holds one is refused: that would overwrite a live key with a
     * generation the edges of everyone below it do not name.
     */
    private static checkSeatedNodes(
        path: number[],
        storedNodes: Map<number, types.cloud.GroupTreeNode>,
        seated: Map<number, types.cloud.GroupTreeSeatedNode>,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        const missing = path.filter(nodeIndex => !seated.has(nodeIndex));
        const unexpected = [...seated.keys()].filter(nodeIndex => !path.includes(nodeIndex));
        if (missing.length > 0 || unexpected.length > 0) {
            return [{kind: "REFRESH_NOT_THE_PATH", missing, unexpected}];
        }
        for (const nodeIndex of path) {
            const submitted = seated.get(nodeIndex)!;
            const current = storedNodes.get(nodeIndex);
            if (!submitted.publicKey) {
                problems.push({kind: "EMPTY_NODE_PUBKEY", nodeIndex});
            }
            if (!current) {
                if (submitted.fromGeneration !== undefined) {
                    problems.push({kind: "NODE_NOT_NEW", nodeIndex});
                }
                else if (submitted.generation !== 0) {
                    problems.push({kind: "MINTED_NODE_NOT_AT_ZERO", nodeIndex, got: submitted.generation});
                }
                continue;
            }
            if (submitted.fromGeneration === undefined) {
                problems.push({kind: "NODE_NOT_NEW", nodeIndex});
                continue;
            }
            if (submitted.fromGeneration !== current.generation) {
                problems.push({
                    kind: "STALE_BASE_GENERATION",
                    nodeIndex,
                    expected: current.generation,
                    got: submitted.fromGeneration,
                });
                continue;
            }
            if (submitted.generation !== current.generation + 1) {
                problems.push({kind: "NODE_NOT_REFRESHED", nodeIndex});
            }
            if (submitted.publicKey && submitted.publicKey === current.publicKey) {
                problems.push({kind: "NODE_KEY_REUSED", nodeIndex});
            }
        }
        return problems;
    }
    
    /**
     * The edges an addition owes: for every seated node, one edge to each of its children in the new geometry —
     * the newcomer's own among them — plus the grant edge re-issued to the new root **at the unchanged epoch**.
     *
     * Requiring the whole child set is what stops an addition from locking somebody out: growth re-parents leaves
     * along the truncated right edge, and a member whose new parent never wrapped to them can no longer climb.
     */
    private static checkAdditionEdges(
        stored: StoredPathState,
        transition: types.cloud.GroupTreeAdditionTransition,
        addedUser: types.cloud.UserId,
        position: number,
        numLeaves: number,
        path: number[],
        storedNodes: Map<number, types.cloud.GroupTreeNode>,
        seated: Map<number, types.cloud.GroupTreeSeatedNode>,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        const seating: types.cloud.UserId[] = [...stored.leafAssignment];
        while (seating.length < numLeaves) {
            seating.push("" as types.cloud.UserId);
        }
        seating[position] = addedUser;
        
        const required = new Map<string, {parentGeneration: number, childGeneration?: number, describe: {parent: string, child: string}}>();
        for (const parentIndex of path) {
            const parentGeneration = seated.get(parentIndex)!.generation;
            for (const childIndex of TreeMath.children(parentIndex, numLeaves)) {
                if (TreeMath.isLeaf(childIndex)) {
                    const holder = seating[TreeMath.leafPosition(childIndex)];
                    if (!holder) {
                        continue;
                    }
                    required.set(`${parentIndex}>user:${holder}`, {
                        parentGeneration,
                        describe: {parent: `node:${parentIndex}`, child: `user:${holder}`},
                    });
                    continue;
                }
                const childGeneration = seated.has(childIndex)
                    ? seated.get(childIndex)!.generation
                    : storedNodes.get(childIndex)?.generation;
                required.set(`${parentIndex}>node:${childIndex}`, {
                    parentGeneration,
                    ...(childGeneration === undefined ? {} : {childGeneration}),
                    describe: {parent: `node:${parentIndex}`, child: `node:${childIndex}`},
                });
            }
        }
        
        const seen = new Set<string>();
        let grantEdges = 0;
        for (const edge of transition.edges) {
            const describe = TreeTransitionValidator.describe(edge);
            if (!edge.data) {
                problems.push({kind: "EMPTY_EDGE_DATA", ...describe});
            }
            if (edge.isGrantEdge) {
                grantEdges++;
                problems.push(...TreeTransitionValidator.checkAdditionGrantEdge(edge, numLeaves, seated, stored.keyVersion));
                continue;
            }
            const child = edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`;
            const key = `${edge.parentIndex ?? -1}>${child}`;
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
                problems.push({kind: "MISSING_EDGE", ...expected.describe});
            }
        }
        if (grantEdges !== 1) {
            problems.push({kind: "GRANT_EDGE_COUNT", count: grantEdges});
        }
        return problems;
    }
    
    private static checkAdditionGrantEdge(
        edge: types.cloud.GroupTreeEdge,
        numLeaves: number,
        seated: Map<number, types.cloud.GroupTreeSeatedNode>,
        epoch: number,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        if (edge.parentGeneration !== epoch) {
            // An addition that moved the epoch would stale every container the group reads — the expensive
            // operation wearing the cheap one's clothes.
            problems.push({kind: "GRANT_EDGE_WRONG_EPOCH", expected: epoch, got: edge.parentGeneration});
        }
        const rootIndex = TreeMath.root(numLeaves);
        if (edge.childKind !== "node" || edge.childIndex !== rootIndex) {
            problems.push({
                kind: "GRANT_EDGE_WRONG_CHILD",
                expected: `node:${rootIndex}`,
                got: `${edge.childKind}:${edge.childUserId ?? edge.childIndex}`,
            });
            return problems;
        }
        const expectedGeneration = seated.get(rootIndex)?.generation;
        if (expectedGeneration !== undefined && edge.childGeneration !== expectedGeneration) {
            problems.push({
                kind: "STALE_CHILD_GENERATION",
                parent: `grant@${epoch}`,
                child: `node:${rootIndex}`,
                expected: expectedGeneration,
                got: edge.childGeneration ?? -1,
            });
        }
        return problems;
    }
    
    /** Exactly the direct path, each node one generation on, each with a genuinely new key. */
    private static checkRefreshedNodes(
        path: number[],
        storedNodes: Map<number, types.cloud.GroupTreeNode>,
        refreshed: Map<number, types.cloud.GroupTreeRefreshedNode>,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        const missing = path.filter(nodeIndex => !refreshed.has(nodeIndex));
        const unexpected = [...refreshed.keys()].filter(nodeIndex => !path.includes(nodeIndex));
        if (missing.length > 0 || unexpected.length > 0) {
            return [{kind: "REFRESH_NOT_THE_PATH", missing, unexpected}];
        }
        for (const nodeIndex of path) {
            const submitted = refreshed.get(nodeIndex);
            const current = storedNodes.get(nodeIndex);
            if (!submitted || !current) {
                problems.push({kind: "NODE_NOT_REFRESHED", nodeIndex});
                continue;
            }
            if (submitted.fromGeneration !== current.generation) {
                problems.push({
                    kind: "STALE_BASE_GENERATION",
                    nodeIndex,
                    expected: current.generation,
                    got: submitted.fromGeneration,
                });
                continue;
            }
            if (submitted.generation !== current.generation + 1) {
                problems.push({kind: "NODE_NOT_REFRESHED", nodeIndex});
            }
            if (!submitted.publicKey) {
                problems.push({kind: "EMPTY_NODE_PUBKEY", nodeIndex});
            }
            else if (submitted.publicKey === current.publicKey) {
                // A bumped generation carrying the same key is a removal that looks done and is not.
                //
                // Only reuse of the key being *replaced* is detectable here: the bridge keeps one generation per
                // node, so a manager republishing some older generation's key looks like a fresh one to it, and
                // the endpoint's climb — which checks a recovered key against this same published value — cannot
                // tell either. A removal is only as good as the manager performing it minting new randomness
                // (see `planRemoval` in the endpoint); detecting otherwise would mean storing every key a node
                // has ever had, which is the unbounded history this design exists to avoid.
                problems.push({kind: "NODE_KEY_REUSED", nodeIndex});
            }
        }
        return problems;
    }
    
    /**
     * The edge set a refresh owes: for every refreshed node, one edge to each of its children that still exists,
     * except the seat being blanked — plus the grant edge at the new epoch.
     *
     * Generations are what tie it down: an edge into a refreshed child must name the child's *new* generation, an
     * edge into a copath child its stored one. That is the same rule the whole-tree validator applies, which is
     * why a transition cannot smuggle in an edge that would not have passed there.
     */
    private static checkEdges(
        stored: StoredPathState,
        transition: types.cloud.GroupTreeTransition,
        position: number,
        path: number[],
        storedNodes: Map<number, types.cloud.GroupTreeNode>,
        refreshed: Map<number, types.cloud.GroupTreeRefreshedNode>,
        newEpoch: number,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        const blankedLeaf = TreeMath.leafNode(position);
        const seating = [...stored.leafAssignment];
        seating[position] = "" as types.cloud.UserId;
        
        const required = new Map<string, {parentGeneration: number, childGeneration?: number, describe: {parent: string, child: string}}>();
        for (const parentIndex of path) {
            const parentGeneration = refreshed.get(parentIndex)!.generation;
            for (const childIndex of TreeMath.children(parentIndex, stored.numLeaves)) {
                if (childIndex === blankedLeaf) {
                    continue;
                }
                if (TreeMath.isLeaf(childIndex)) {
                    const holder = seating[TreeMath.leafPosition(childIndex)];
                    if (!holder) {
                        continue;
                    }
                    required.set(`${parentIndex}>user:${holder}`, {
                        parentGeneration,
                        describe: {parent: `node:${parentIndex}`, child: `user:${holder}`},
                    });
                    continue;
                }
                const childGeneration = refreshed.has(childIndex)
                    ? refreshed.get(childIndex)!.generation
                    : storedNodes.get(childIndex)?.generation;
                required.set(`${parentIndex}>node:${childIndex}`, {
                    parentGeneration,
                    ...(childGeneration === undefined ? {} : {childGeneration}),
                    describe: {parent: `node:${parentIndex}`, child: `node:${childIndex}`},
                });
            }
        }
        
        const seen = new Set<string>();
        let grantEdges = 0;
        for (const edge of transition.edges) {
            const describe = TreeTransitionValidator.describe(edge);
            if (!edge.data) {
                problems.push({kind: "EMPTY_EDGE_DATA", ...describe});
            }
            if (edge.isGrantEdge) {
                grantEdges++;
                problems.push(...TreeTransitionValidator.checkGrantEdge(edge, stored, refreshed, newEpoch));
                continue;
            }
            const child = edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`;
            const key = `${edge.parentIndex ?? -1}>${child}`;
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
                problems.push({kind: "MISSING_EDGE", ...expected.describe});
            }
        }
        if (grantEdges !== 1) {
            problems.push({kind: "GRANT_EDGE_COUNT", count: grantEdges});
        }
        return problems;
    }
    
    private static checkGrantEdge(
        edge: types.cloud.GroupTreeEdge,
        stored: StoredPathState,
        refreshed: Map<number, types.cloud.GroupTreeRefreshedNode>,
        newEpoch: number,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        if (edge.parentGeneration !== newEpoch) {
            problems.push({kind: "GRANT_EDGE_WRONG_EPOCH", expected: newEpoch, got: edge.parentGeneration});
        }
        const rootIndex = TreeMath.root(stored.numLeaves);
        if (edge.childKind !== "node" || edge.childIndex !== rootIndex) {
            problems.push({
                kind: "GRANT_EDGE_WRONG_CHILD",
                expected: `node:${rootIndex}`,
                got: `${edge.childKind}:${edge.childUserId ?? edge.childIndex}`,
            });
            return problems;
        }
        const expectedGeneration = refreshed.get(rootIndex)?.generation;
        if (expectedGeneration !== undefined && edge.childGeneration !== expectedGeneration) {
            problems.push({
                kind: "STALE_CHILD_GENERATION",
                parent: `grant@${newEpoch}`,
                child: `node:${rootIndex}`,
                expected: expectedGeneration,
                got: edge.childGeneration ?? -1,
            });
        }
        return problems;
    }
    
    private static describe(edge: types.cloud.GroupTreeEdge): {parent: string, child: string} {
        return {
            parent: edge.isGrantEdge ? "grant" : `node:${edge.parentIndex ?? -1}`,
            child: edge.childKind === "user" ? `user:${edge.childUserId ?? ""}` : `node:${edge.childIndex ?? -1}`,
        };
    }
    
    /** Which nodes the bridge has to read to check a removal at `position`: the path and its copath. */
    static nodesNeededFor(position: number, numLeaves: number): number[] {
        return [
            ...TreeMath.directPath(position, numLeaves),
            ...TreeMath.copath(position, numLeaves).filter(nodeIndex => !TreeMath.isLeaf(nodeIndex)),
        ];
    }
    
    /**
     * Which nodes checking an addition at `position` needs, in the geometry seating it produces.
     *
     * Indices that do not exist yet are included and simply come back absent — growth mints them, and the
     * validator needs to know they were absent rather than assume it.
     */
    static nodesNeededForSeat(position: number, numLeaves: number): number[] {
        const grown = TreeMath.numLeavesToSeat(position, numLeaves);
        return [
            ...TreeMath.directPath(position, grown),
            ...TreeMath.copath(position, grown).filter(nodeIndex => !TreeMath.isLeaf(nodeIndex)),
        ];
    }
}
