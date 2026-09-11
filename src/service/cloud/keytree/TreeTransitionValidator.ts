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
    | {kind: "WRONG_SEATS", expected: number[], got: number[]}
    | {kind: "EMPTY_BATCH"}
    | {kind: "DUPLICATE_MEMBER", userId: types.cloud.UserId}
    | {kind: "DUPLICATE_POSITION", position: number}
    | {kind: "MEMBER_COUNT_MISMATCH", members: number, positions: number}
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
    
    /**
     * Checks a removal delta covering one or more members.
     *
     * The batch is not n removals checked in turn: the members' paths overlap, and every shared ancestor must be
     * refreshed exactly once. So the refresh set is the **union** of their direct paths, and the epoch advances
     * once for the whole batch — which is also why a batch is cheaper than the same removals done one by one, and
     * why it cannot half-land.
     */
    static validateRemoval(
        stored: StoredPathState,
        transition: types.cloud.GroupTreeTransition,
        removedUsers: types.cloud.UserId[],
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        if (transition.baseKeyVersion !== stored.keyVersion) {
            // Nothing else is worth checking: every generation in the delta was read at another epoch.
            return [{kind: "STALE_BASE_EPOCH", expected: stored.keyVersion, got: transition.baseKeyVersion}];
        }
        if (removedUsers.length === 0) {
            return [{kind: "EMPTY_BATCH"}];
        }
        const repeated = TreeTransitionValidator.firstDuplicate(removedUsers);
        if (repeated !== undefined) {
            // Naming somebody twice would blank one seat and count two removals — the roster and the tree would
            // disagree from then on.
            return [{kind: "DUPLICATE_MEMBER", userId: repeated}];
        }
        const positions: number[] = [];
        for (const removedUser of removedUsers) {
            const position = stored.leafAssignment.indexOf(removedUser);
            if (position < 0) {
                return [{kind: "MEMBER_HAS_NO_LEAF", userId: removedUser}];
            }
            positions.push(position);
        }
        // Seats are derived from the roster, never taken from the request: the client says *who* leaves, the
        // bridge says *where* they sat. The submitted set only has to agree.
        const expectedSeats = [...positions].sort((a, b) => a - b);
        const gotSeats = [...transition.blankedPositions].sort((a, b) => a - b);
        if (expectedSeats.length !== gotSeats.length || expectedSeats.some((seat, i) => seat !== gotSeats[i])) {
            return [{kind: "WRONG_SEATS", expected: expectedSeats, got: gotSeats}];
        }
        
        const frontier = TreeMath.frontier(positions, stored.numLeaves);
        const storedNodes = new Map(stored.nodes.map(node => [node.nodeIndex, node]));
        const refreshed = new Map(transition.refreshedNodes.map(node => [node.nodeIndex, node]));
        problems.push(...TreeTransitionValidator.checkRefreshedNodes(frontier, storedNodes, refreshed));
        if (problems.length > 0) {
            // Generations below are computed from the refresh set; checking edges against a wrong one only
            // produces noise.
            return problems;
        }
        const newEpoch = stored.keyVersion + 1;
        problems.push(...TreeTransitionValidator.checkEdges(stored, transition, positions, frontier, storedNodes, refreshed, newEpoch));
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
        addedUsers: types.cloud.UserId[],
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        if (transition.baseKeyVersion !== stored.keyVersion) {
            return [{kind: "STALE_BASE_EPOCH", expected: stored.keyVersion, got: transition.baseKeyVersion}];
        }
        if (addedUsers.length === 0) {
            return [{kind: "EMPTY_BATCH"}];
        }
        // `positions[i]` is where `addedUsers[i]` sits: the two travel as parallel lists, so a length mismatch
        // would silently seat somebody at another member's coordinate.
        if (transition.positions.length !== addedUsers.length) {
            return [{kind: "MEMBER_COUNT_MISMATCH", members: addedUsers.length, positions: transition.positions.length}];
        }
        const repeatedUser = TreeTransitionValidator.firstDuplicate(addedUsers);
        if (repeatedUser !== undefined) {
            return [{kind: "DUPLICATE_MEMBER", userId: repeatedUser}];
        }
        const repeatedSeat = TreeTransitionValidator.firstDuplicate(transition.positions);
        if (repeatedSeat !== undefined) {
            // Two newcomers on one seat: the second overwrites the first in `leafAssignment`, leaving a member
            // on the roster with no leaf to climb from.
            return [{kind: "DUPLICATE_POSITION", position: repeatedSeat}];
        }
        for (const addedUser of addedUsers) {
            const alreadyAt = stored.leafAssignment.indexOf(addedUser);
            if (alreadyAt >= 0) {
                return [{kind: "ALREADY_SEATED", userId: addedUser, position: alreadyAt}];
            }
        }
        // Walked in seat order, because appends have to be contiguous: seats are filled lowest-blank-first and
        // only ever appended, so a batch that skips one would burn a seat nothing can ever reuse.
        let grown = stored.numLeaves;
        for (const position of [...transition.positions].sort((a, b) => a - b)) {
            if (!Number.isInteger(position) || position < 0 || position > grown) {
                return [{kind: "SEAT_OUT_OF_RANGE", position, numLeaves: grown}];
            }
            if (position < stored.numLeaves) {
                if (stored.leafAssignment[position] !== "") {
                    return [{kind: "SEAT_NOT_BLANK", position, occupant: stored.leafAssignment[position]}];
                }
                continue;
            }
            grown = position + 1;
        }
        
        const numLeaves = grown;
        const frontier = TreeMath.frontier(transition.positions, numLeaves);
        const storedNodes = new Map(stored.nodes.map(node => [node.nodeIndex, node]));
        const seated = new Map(transition.seatedNodes.map(node => [node.nodeIndex, node]));
        problems.push(...TreeTransitionValidator.checkSeatedNodes(frontier, storedNodes, seated));
        if (problems.length > 0) {
            return problems;
        }
        problems.push(...TreeTransitionValidator.checkAdditionEdges(
            stored, transition, addedUsers, numLeaves, frontier, storedNodes, seated,
        ));
        return problems;
    }
    
    /** First value that appears twice, or `undefined`. */
    private static firstDuplicate<T>(values: T[]): T|undefined {
        const seen = new Set<T>();
        for (const value of values) {
            if (seen.has(value)) {
                return value;
            }
            seen.add(value);
        }
        return undefined;
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
        addedUsers: types.cloud.UserId[],
        numLeaves: number,
        frontier: number[],
        storedNodes: Map<number, types.cloud.GroupTreeNode>,
        seated: Map<number, types.cloud.GroupTreeSeatedNode>,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        const seating: types.cloud.UserId[] = [...stored.leafAssignment];
        while (seating.length < numLeaves) {
            seating.push("" as types.cloud.UserId);
        }
        transition.positions.forEach((position, i) => {
            seating[position] = addedUsers[i];
        });
        
        const required = new Map<string, {parentGeneration: number, childGeneration?: number, describe: {parent: string, child: string}}>();
        for (const parentIndex of frontier) {
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
        positions: number[],
        frontier: number[],
        storedNodes: Map<number, types.cloud.GroupTreeNode>,
        refreshed: Map<number, types.cloud.GroupTreeRefreshedNode>,
        newEpoch: number,
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        const blankedLeaves = new Set(positions.map(position => TreeMath.leafNode(position)));
        const seating = [...stored.leafAssignment];
        for (const position of positions) {
            seating[position] = "" as types.cloud.UserId;
        }
        
        const required = new Map<string, {parentGeneration: number, childGeneration?: number, describe: {parent: string, child: string}}>();
        for (const parentIndex of frontier) {
            const parentGeneration = refreshed.get(parentIndex)!.generation;
            for (const childIndex of TreeMath.children(parentIndex, stored.numLeaves)) {
                if (blankedLeaves.has(childIndex)) {
                    // No edge to a seat nobody holds. A node whose children are *all* blanked ends up owing none
                    // at all: it still gets a fresh key so the refresh reaches the root, but nothing can climb
                    // into it — the same shape the whole-tree validator accepts for an empty subtree.
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
    
    /**
     * Which nodes the bridge has to read to check a removal of `positions`: their paths and copaths.
     *
     * Deduplicated, so a batch of neighbours costs barely more than one of them — the shared ancestors and the
     * copath nodes they have in common are read once.
     */
    static nodesNeededFor(positions: number[], numLeaves: number): number[] {
        const needed = new Set<number>();
        for (const position of positions) {
            for (const nodeIndex of TreeMath.directPath(position, numLeaves)) {
                needed.add(nodeIndex);
            }
            for (const nodeIndex of TreeMath.copath(position, numLeaves)) {
                if (!TreeMath.isLeaf(nodeIndex)) {
                    needed.add(nodeIndex);
                }
            }
        }
        return [...needed];
    }
    
    /**
     * Which nodes checking an addition at `positions` needs, in the geometry seating them produces.
     *
     * Indices that do not exist yet are included and simply come back absent — growth mints them, and the
     * validator needs to know they were absent rather than assume it.
     */
    static nodesNeededForSeat(positions: number[], numLeaves: number): number[] {
        return TreeTransitionValidator.nodesNeededFor(positions, TreeMath.numLeavesToSeatAll(positions, numLeaves));
    }
}
