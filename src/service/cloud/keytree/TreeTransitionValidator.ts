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
import { EdgeProblem, TreeValidator, TreeView } from "./TreeValidator";

/**
 * Why a submitted commit was rejected.
 *
 * `STALE_BASE_*` are the preconditions that make a delta safe to apply at all; a client seeing one re-reads and
 * re-plans. The edge kinds are the same ones the whole-state check reports.
 */
export type TransitionRejection =
    | EdgeProblem
    | {kind: "STALE_BASE_EPOCH", expected: number, got: number}
    | {kind: "STALE_BASE_GENERATION", nodeIndex: number, expected: number, got: number}
    | {kind: "MEMBER_HAS_NO_LEAF", userId: types.cloud.UserId}
    | {kind: "SELF_REMOVAL", userId: types.cloud.UserId}
    | {kind: "WRONG_SEATS", expected: number[], got: number[]}
    | {kind: "EMPTY_BATCH"}
    | {kind: "DUPLICATE_MEMBER", userId: types.cloud.UserId}
    | {kind: "DUPLICATE_POSITION", position: number}
    | {kind: "MEMBER_COUNT_MISMATCH", members: number, positions: number}
    | {kind: "SEAT_NOT_BLANK", position: number, occupant: types.cloud.UserId}
    | {kind: "SEAT_OUT_OF_RANGE", position: number, numLeaves: number}
    | {kind: "ALREADY_SEATED", userId: types.cloud.UserId, position: number}
    | {kind: "DUPLICATE_NODE", nodeIndex: number}
    | {kind: "UNEXPECTED_NODE", nodeIndex: number}
    | {kind: "REFRESH_NOT_THE_PATH", missing: number[], unexpected: number[]}
    | {kind: "NODE_NOT_NEW", nodeIndex: number}
    | {kind: "MINTED_NODE_NOT_AT_ZERO", nodeIndex: number, got: number}
    | {kind: "NODE_NOT_REFRESHED", nodeIndex: number}
    | {kind: "NODE_KEY_REUSED", nodeIndex: number}
    | {kind: "EMPTY_NODE_PUBKEY", nodeIndex: number};

/** The stored state a commit is checked against: geometry, seating, epoch and every node record of the group. */
export interface StoredTree {
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    keyVersion: number;
    /** All records, filled and blank. A group has at most `numLeaves / 2^BUCKET_LEVEL + 1` of them. */
    nodes: types.cloud.GroupTreeNode[];
    /** Committer of each statement a filled record's `setBy` names. Needed by a removal only. */
    setters?: Map<number, types.cloud.UserId>;
}

/**
 * What changes the tree. `committer` is always the **authenticated caller**, never a field of the request: the
 * keyed path that gets re-keyed is the committer's, so letting the client name it would let it re-key a path it
 * has no business knowing.
 *
 * For `create` the "stored" tree is the one being created, with no records: the seating is the client's, the
 * roster check is `TreeValidator.validateLeaves`'s, and every key is new.
 */
export type CommitOp =
    | {kind: "create", committer: types.cloud.UserId}
    | {kind: "add", committer: types.cloud.UserId, addedUsers: types.cloud.UserId[], positions: number[]}
    | {kind: "remove", committer: types.cloud.UserId, removedUsers: types.cloud.UserId[], blankedPositions: number[]}
    | {kind: "selfUpdate", committer: types.cloud.UserId};

/** What the client sent: the re-keyed nodes and the edges they owe. */
export interface SubmittedCommit {
    baseKeyVersion: number;
    refreshedNodes: types.cloud.GroupTreeRefreshedNode[];
    edges: types.cloud.GroupTreeEdge[];
}

/** An accepted commit, in the form storage applies it — every set here derived by the bridge, not sent. */
export interface TreeCommit {
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    /** The epoch the grant edge is addressed to after the commit. */
    keyVersion: number;
    /** Nodes left blank: `B \ R`. Their records keep `generation` and lose `publicKey`. */
    blanked: number[];
    /** Every node the commit set (`R`), as submitted and checked. */
    refreshed: types.cloud.GroupTreeRefreshedNode[];
    /** Records on nodes the new geometry no longer keys — only ever the old root, when growth moves it out of
     *  the buckets' levels. Dropped together with their edges. */
    unkeyed: number[];
    /** The edges out of `R`, plus the grant edge. */
    edges: types.cloud.GroupTreeEdge[];
}

export type CommitResult = {ok: true, commit: TreeCommit} | {ok: false, rejections: TransitionRejection[]};

/** Post-commit geometry and the blank set, as derived from the stored state and the operation. */
interface Derived {
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    blanked: Set<number>;
    /** Keyed nodes minted besides the committer's path: every other one at creation, the newcomers' paths on
     *  an addition. */
    filled: number[];
    keyVersion: number;
}

/**
 * Checks a commit against stored state rather than re-validating the whole tree: the stored state was valid when
 * written, this delta is checked against it, and the two give the same guarantee by induction.
 *
 * That argument holds only while **nothing writes tree state without passing through a validator**. A migration
 * or repair script that skips one breaks the invariant silently — run `verifyGroupTrees.ts` after any such write.
 */
export class TreeTransitionValidator {
    
    /**
     * The one check every tree-changing operation goes through.
     *
     * The bridge derives everything that decides who can read what — the post seating `A'`, the size `n'`, the
     * blank set `B` and the set-by-this-commit set `R` — from the stored state and the caller, and only checks
     * the client's keys and wraps against them:
     *
     * - `R` is exactly `keyedPath(committer, n')` plus the off-path fills `derive` allows: every keyed node at
     *   creation, the newcomers' paths on an addition. Every node of `R` is set by the committer (`setBy` is this
     *   statement's seq), so a removal of the committer blanks it again. (`REFRESH_NOT_THE_PATH`)
     * - every node of `R` continues from the stored generation with a key it has never had. (`STALE_BASE_*`,
     *   `NODE_*`)
     * - the edges are exactly what `R` owes on the post state — every child resolution, nothing outside the
     *   subtree — plus the grant edge at the right epoch. (edge kinds)
     */
    static validateCommit(stored: StoredTree, op: CommitOp, submitted: SubmittedCommit): CommitResult {
        if (op.kind !== "create" && submitted.baseKeyVersion !== stored.keyVersion) {
            // Nothing else is worth checking: every generation in the delta was read at another epoch.
            return TreeTransitionValidator.reject([{kind: "STALE_BASE_EPOCH", expected: stored.keyVersion, got: submitted.baseKeyVersion}]);
        }
        if (op.kind !== "create" && !stored.leafAssignment.includes(op.committer)) {
            // Checked against the stored seating, before the operation is applied: otherwise an outsider could
            // seat themselves with an addition and be the one who re-keys the path above the seat.
            return TreeTransitionValidator.reject([{kind: "MEMBER_HAS_NO_LEAF", userId: op.committer}]);
        }
        const derived = TreeTransitionValidator.derive(stored, op);
        if (Array.isArray(derived)) {
            return TreeTransitionValidator.reject(derived);
        }
        const seat = derived.leafAssignment.indexOf(op.committer);
        if (seat < 0) {
            // Only reachable for a creation whose seating leaves the creator out.
            return TreeTransitionValidator.reject([{kind: "MEMBER_HAS_NO_LEAF", userId: op.committer}]);
        }
        const path = [...new Set([...TreeMath.keyedPath(seat, derived.numLeaves), ...derived.filled])];
        const records = new Map(stored.nodes.map(node => [node.nodeIndex, node]));
        const nodeProblems = TreeTransitionValidator.checkRefreshedNodes(path, derived.numLeaves, records, submitted.refreshedNodes);
        if (nodeProblems.length > 0) {
            // The edges below are computed from the refreshed generations; checking them against a wrong set
            // only produces noise.
            return TreeTransitionValidator.reject(nodeProblems);
        }
        
        // The post state: blanks dropped, the path filled with what was submitted, unkeyed records gone.
        const unkeyed = stored.nodes.map(node => node.nodeIndex).filter(nodeIndex => !TreeMath.isKeyed(nodeIndex, derived.numLeaves));
        const post: TreeView = {numLeaves: derived.numLeaves, leafAssignment: derived.leafAssignment, nodes: new Map()};
        for (const node of stored.nodes) {
            if (unkeyed.includes(node.nodeIndex)) {
                continue;
            }
            post.nodes.set(node.nodeIndex, derived.blanked.has(node.nodeIndex) ? {generation: node.generation} : node);
        }
        for (const node of submitted.refreshedNodes) {
            post.nodes.set(node.nodeIndex, node);
        }
        const edgeProblems = TreeValidator.checkEdges(
            submitted.edges,
            TreeValidator.requiredEdges(post, path),
            TreeValidator.grantExpectation(post, derived.keyVersion),
        );
        if (edgeProblems.length > 0) {
            return TreeTransitionValidator.reject(edgeProblems);
        }
        return {ok: true, commit: {
            numLeaves: derived.numLeaves,
            leafAssignment: derived.leafAssignment,
            keyVersion: derived.keyVersion,
            blanked: [...derived.blanked].filter(nodeIndex => !path.includes(nodeIndex)).sort((a, b) => a - b),
            refreshed: submitted.refreshedNodes,
            unkeyed,
            edges: submitted.edges,
        }};
    }
    
    private static reject(rejections: TransitionRejection[]): CommitResult {
        return {ok: false, rejections};
    }
    
    /** `A'`, `n'`, `B` and the epoch after the commit, per operation — or why the operation itself is refused. */
    private static derive(stored: StoredTree, op: CommitOp): Derived|TransitionRejection[] {
        const unchanged = {numLeaves: stored.numLeaves, leafAssignment: stored.leafAssignment};
        switch (op.kind) {
            case "create":
                // The creator fills every keyed node, so every later commit finds its path filled. Nothing to
                // blank: no keyed node has a record yet. The epoch is the group's first.
                return {...unchanged, blanked: new Set(), filled: TreeMath.keyedNodes(stored.numLeaves), keyVersion: 1};
            case "selfUpdate":
                return {...unchanged, blanked: new Set(), filled: [], keyVersion: stored.keyVersion};
            case "add":
                return TreeTransitionValidator.deriveAddition(stored, op);
            case "remove":
                return TreeTransitionValidator.deriveRemoval(stored, op);
        }
    }
    
    /**
     * A removal blanks everything a departing member may know, and the epoch advances once for the whole batch.
     *
     * `Know(r)` is `r`'s keyed path plus every filled node `r` set, closed upwards: an ancestor of a node `r`
     * knows wraps (directly or through blanks) to it, so `r` can open it too. A self-update above a node `r` set
     * re-keys the ancestor but still wraps it to that node, which is why `setBy` alone is not enough. The remover
     * re-keys its own path, which covers the root and so the new grant key; the rest of `Know` is left blank and
     * refilled by self-updates of members seated under it.
     */
    private static deriveRemoval(stored: StoredTree, op: Extract<CommitOp, {kind: "remove"}>): Derived|TransitionRejection[] {
        if (op.removedUsers.length === 0) {
            return [{kind: "EMPTY_BATCH"}];
        }
        const repeated = TreeTransitionValidator.firstDuplicate(op.removedUsers);
        if (repeated !== undefined) {
            // Naming somebody twice would blank one seat and count two removals — the roster and the tree would
            // disagree from then on.
            return [{kind: "DUPLICATE_MEMBER", userId: repeated}];
        }
        if (op.removedUsers.includes(op.committer)) {
            // The remover mints the new grant key. Removing yourself would mean the one member who is supposed to
            // lose the epoch is the one who chose its key.
            return [{kind: "SELF_REMOVAL", userId: op.committer}];
        }
        const positions: number[] = [];
        for (const removedUser of op.removedUsers) {
            const position = stored.leafAssignment.indexOf(removedUser);
            if (position < 0) {
                return [{kind: "MEMBER_HAS_NO_LEAF", userId: removedUser}];
            }
            positions.push(position);
        }
        // Seats are derived from the roster, never taken from the request: the client says *who* leaves, the
        // bridge says *where* they sat. The submitted set only has to agree.
        const expectedSeats = [...positions].sort((a, b) => a - b);
        const gotSeats = [...op.blankedPositions].sort((a, b) => a - b);
        if (expectedSeats.length !== gotSeats.length || expectedSeats.some((seat, i) => seat !== gotSeats[i])) {
            return [{kind: "WRONG_SEATS", expected: expectedSeats, got: gotSeats}];
        }
        const leafAssignment = [...stored.leafAssignment];
        const blanked = new Set<number>();
        const n = stored.numLeaves;
        for (const position of positions) {
            leafAssignment[position] = "" as types.cloud.UserId;
            TreeMath.keyedPath(position, n).forEach(nodeIndex => blanked.add(nodeIndex));
        }
        for (const node of stored.nodes.filter(record => record.publicKey)) {
            const setter = node.setBy === undefined ? undefined : stored.setters?.get(node.setBy);
            if (setter === undefined) {
                // Statements are never deleted while the group lives: only corrupt storage gets here. Fail closed.
                throw new Error(`node ${node.nodeIndex} names no stored statement (setBy ${node.setBy ?? "none"})`);
            }
            if (!op.removedUsers.includes(setter)) {
                continue;
            }
            for (let x = node.nodeIndex; ; x = TreeMath.parent(x, n)) {
                if (TreeMath.isKeyed(x, n)) {
                    blanked.add(x);
                }
                if (x === TreeMath.root(n)) {
                    break;
                }
            }
        }
        return {numLeaves: n, leafAssignment, blanked, filled: [], keyVersion: stored.keyVersion + 1};
    }
    
    /**
     * An addition seats the newcomers and has the adder mint their keyed paths in the grown geometry. The epoch
     * does not move: a newcomer learns the current grant key by climbing, which is the whole reason an addition is
     * cheap.
     *
     * Re-keying matters: a node above a newcomer that kept its old key would hand the newcomer every earlier wrap
     * made under it. The adder knows these new keys outside its own subtree, but it is a member anyway, and its
     * removal blanks every node it set.
     */
    private static deriveAddition(stored: StoredTree, op: Extract<CommitOp, {kind: "add"}>): Derived|TransitionRejection[] {
        if (op.addedUsers.length === 0) {
            return [{kind: "EMPTY_BATCH"}];
        }
        // `positions[i]` is where `addedUsers[i]` sits: the two travel as parallel lists, so a length mismatch
        // would silently seat somebody at another member's coordinate.
        if (op.positions.length !== op.addedUsers.length) {
            return [{kind: "MEMBER_COUNT_MISMATCH", members: op.addedUsers.length, positions: op.positions.length}];
        }
        const repeatedUser = TreeTransitionValidator.firstDuplicate(op.addedUsers);
        if (repeatedUser !== undefined) {
            return [{kind: "DUPLICATE_MEMBER", userId: repeatedUser}];
        }
        const repeatedSeat = TreeTransitionValidator.firstDuplicate(op.positions);
        if (repeatedSeat !== undefined) {
            // Two newcomers on one seat: the second overwrites the first in `leafAssignment`, leaving a member
            // on the roster with no leaf to climb from.
            return [{kind: "DUPLICATE_POSITION", position: repeatedSeat}];
        }
        for (const addedUser of op.addedUsers) {
            const alreadyAt = stored.leafAssignment.indexOf(addedUser);
            if (alreadyAt >= 0) {
                return [{kind: "ALREADY_SEATED", userId: addedUser, position: alreadyAt}];
            }
        }
        // Walked in seat order, because appends have to be contiguous: seats are filled lowest-blank-first and
        // only ever appended, so a batch that skips one would burn a seat nothing can ever reuse.
        let grown = stored.numLeaves;
        for (const position of [...op.positions].sort((a, b) => a - b)) {
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
        const leafAssignment = [...stored.leafAssignment];
        while (leafAssignment.length < grown) {
            leafAssignment.push("" as types.cloud.UserId);
        }
        const filled = new Set<number>();
        op.positions.forEach((position, i) => {
            leafAssignment[position] = op.addedUsers[i];
            TreeMath.keyedPath(position, grown).forEach(nodeIndex => filled.add(nodeIndex));
        });
        return {numLeaves: grown, leafAssignment, blanked: new Set(), filled: [...filled], keyVersion: stored.keyVersion};
    }
    
    /**
     * Exactly `R` (`path`), each node advancing one generation from the stored record (or minted at
     * 0 where there is none) with a key it never had.
     */
    private static checkRefreshedNodes(
        path: number[],
        numLeaves: number,
        records: Map<number, types.cloud.GroupTreeNode>,
        submitted: types.cloud.GroupTreeRefreshedNode[],
    ): TransitionRejection[] {
        const problems: TransitionRejection[] = [];
        const byIndex = new Map<number, types.cloud.GroupTreeRefreshedNode>();
        for (const node of submitted) {
            if (byIndex.has(node.nodeIndex)) {
                // Two keys claiming one node and generation: whichever landed last would orphan the other's edges.
                problems.push({kind: "DUPLICATE_NODE", nodeIndex: node.nodeIndex});
            }
            else if (!Number.isInteger(node.nodeIndex) || node.nodeIndex < 0 || !TreeMath.isKeyed(node.nodeIndex, numLeaves)) {
                problems.push({kind: "UNEXPECTED_NODE", nodeIndex: node.nodeIndex});
            }
            byIndex.set(node.nodeIndex, node);
        }
        if (problems.length > 0) {
            return problems;
        }
        const missing = path.filter(nodeIndex => !byIndex.has(nodeIndex));
        const unexpected = [...byIndex.keys()].filter(nodeIndex => !path.includes(nodeIndex));
        if (missing.length > 0 || unexpected.length > 0) {
            return [{kind: "REFRESH_NOT_THE_PATH", missing, unexpected}];
        }
        for (const nodeIndex of path) {
            const node = byIndex.get(nodeIndex)!;
            const record = records.get(nodeIndex);
            if (!node.publicKey) {
                problems.push({kind: "EMPTY_NODE_PUBKEY", nodeIndex});
            }
            if (!record) {
                if (node.fromGeneration !== undefined) {
                    problems.push({kind: "NODE_NOT_NEW", nodeIndex});
                }
                else if (node.generation !== 0) {
                    problems.push({kind: "MINTED_NODE_NOT_AT_ZERO", nodeIndex, got: node.generation});
                }
                continue;
            }
            if (node.fromGeneration !== record.generation) {
                // Also when the client saw no record at all: somebody filled the node since, and re-planning
                // against the new generation is the answer — the same one as for a moved generation.
                problems.push({kind: "STALE_BASE_GENERATION", nodeIndex, expected: record.generation, got: node.fromGeneration ?? -1});
                continue;
            }
            if (node.generation !== record.generation + 1) {
                problems.push({kind: "NODE_NOT_REFRESHED", nodeIndex});
            }
            if (record.publicKey && node.publicKey === record.publicKey) {
                // A bumped generation carrying the same key revokes nothing.
                //
                // Only reuse of the key being *replaced* is detectable here: the bridge keeps one generation per
                // node, so a client republishing some older generation's key looks like a fresh one to it. A
                // commit is only as good as the committer minting new randomness; detecting otherwise would mean
                // storing every key a node has ever had.
                problems.push({kind: "NODE_KEY_REUSED", nodeIndex});
            }
        }
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
}
