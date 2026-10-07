/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { TreeMath } from "../../service/cloud/keytree/TreeMath";
import { LadderMath } from "../../service/cloud/keytree/LadderMath";
import { CommitOp, TreeCommit, TreeTransitionValidator } from "../../service/cloud/keytree/TreeTransitionValidator";

/**
 * Hidden key tree fixtures for the bridge's tests.
 *
 * The wrapped blobs are recognisable placeholders rather than real ciphertexts, and deliberately so: the bridge
 * cannot decrypt an edge, so every rule it enforces is decidable from indices, generations and roster membership.
 * A fixture that carried real keys would prove nothing extra and hide what is actually being checked. The real
 * crypto is exercised on the endpoint side (see privmx-endpoint/test/tests/unit/TreeKeysTest.cpp).
 *
 * `planCommit` mirrors the endpoint's planner without the crypto, so the tests submit exactly what an honest
 * client would.
 */

export function userId(name: string): types.cloud.UserId {
    return name as types.cloud.UserId;
}

let mintCounter = 0;

/** A placeholder public key, unique per call — what `PrivateKey::generateRandom()` gives the endpoint. */
function freshKey(nodeIndex: number, generation: number): types.core.EccPubKey {
    return `pk:${nodeIndex}g${generation}#${++mintCounter}` as types.core.EccPubKey;
}

/** A placeholder wrap, unique per call so no two edges ever carry the same "ciphertext". */
function wrap(parent: string, child: string): types.core.UserKeyData {
    return `wrap:${parent}->${child}#${++mintCounter}` as types.core.UserKeyData;
}

export type PlanOp =
    | {kind: "create", committer: string}
    | {kind: "add", committer: string, members: string[], positions: number[]}
    | {kind: "remove", committer: string, removed: string[]}
    | {kind: "selfUpdate", committer: string};

/** What an honest endpoint submits for one commit, and the state the bridge holds once it is applied. */
export interface Plan {
    /** The committer's keyed path `R`, re-keyed. */
    refreshedNodes: types.cloud.GroupTreeRefreshedNode[];
    /** The edges `R` owes on the post state, plus the grant edge. */
    edges: types.cloud.GroupTreeEdge[];
    /** For a removal: the departing members' seats. */
    blankedPositions: number[];
    /** `B \ R` — what the commit leaves blank. */
    blanked: number[];
    /** The whole stored state after the commit, edges included, by the storage rule of `applyCommit`. */
    after: types.cloud.GroupTreeState;
    keyVersion: number;
}

type Resolved = {kind: "node", nodeIndex: number, generation: number}|{kind: "user", userId: types.cloud.UserId};

/**
 * Resolution, written out again rather than borrowed from `TreeValidator`: a planner sharing the validator's
 * code would agree with it by construction, and the tests built on it would prove nothing.
 */
function resolve(numLeaves: number, seating: types.cloud.UserId[], records: Map<number, types.cloud.GroupTreeNode>, nodeIndex: number): Resolved[] {
    if (nodeIndex % 2 === 0) {
        const holder = seating[nodeIndex / 2];
        return holder ? [{kind: "user", userId: holder}] : [];
    }
    const record = records.get(nodeIndex);
    if (TreeMath.isKeyed(nodeIndex, numLeaves) && record?.publicKey) {
        return [{kind: "node", nodeIndex, generation: record.generation}];
    }
    return TreeMath.children(nodeIndex, numLeaves).flatMap(child => resolve(numLeaves, seating, records, child));
}

/** The edges the filled nodes `parents` owe in the given state. */
function edgesOwed(numLeaves: number, seating: types.cloud.UserId[], records: Map<number, types.cloud.GroupTreeNode>, parents: number[]): types.cloud.GroupTreeEdge[] {
    const edges: types.cloud.GroupTreeEdge[] = [];
    for (const parentIndex of parents) {
        const parentGeneration = records.get(parentIndex)!.generation;
        for (const child of TreeMath.children(parentIndex, numLeaves)) {
            for (const target of resolve(numLeaves, seating, records, child)) {
                edges.push(target.kind === "user"
                    ? {parentIndex, parentGeneration, childKind: "user", childUserId: target.userId, data: wrap(`${parentIndex}`, target.userId)}
                    : {parentIndex, parentGeneration, childKind: "node", childIndex: target.nodeIndex, childGeneration: target.generation, data: wrap(`${parentIndex}`, `${target.nodeIndex}`)});
            }
        }
    }
    return edges;
}

/**
 * Plans one commit the way the endpoint does (spec §6): work out the post seating and the blank set, re-key the
 * committer's keyed path with fresh keys, wrap each re-keyed node to its children's resolutions on the post
 * state, and re-issue the grant edge. Then applies it to `before` with the bridge's storage rule, so a chain of
 * plans yields the states the bridge would hold.
 *
 * Deliberately does no validation: a test that wants a bad submission edits a good one.
 */
export function planCommit(before: types.cloud.GroupTreeState, keyVersion: number, op: PlanOp): Plan {
    let numLeaves = before.numLeaves;
    const seating = [...before.leafAssignment];
    const blank = new Set<number>();
    const blankedPositions: number[] = [];
    let newKeyVersion = keyVersion;
    if (op.kind === "create") {
        newKeyVersion = 1;
    }
    else if (op.kind === "add") {
        numLeaves = TreeMath.numLeavesToSeatAll(op.positions, numLeaves);
        while (seating.length < numLeaves) {
            seating.push("" as types.cloud.UserId);
        }
        op.positions.forEach((position, i) => {
            seating[position] = userId(op.members[i]);
            TreeMath.keyedPath(position, numLeaves).forEach(nodeIndex => blank.add(nodeIndex));
        });
    }
    else if (op.kind === "remove") {
        for (const removed of op.removed) {
            const position = seating.indexOf(userId(removed));
            blankedPositions.push(position);
            seating[position] = "" as types.cloud.UserId;
            TreeMath.keyedPath(position, numLeaves).forEach(nodeIndex => blank.add(nodeIndex));
        }
        newKeyVersion = keyVersion + 1;
    }
    const path = TreeMath.keyedPath(seating.indexOf(userId(op.committer)), numLeaves);
    
    const records = new Map<number, types.cloud.GroupTreeNode>();
    const unkeyed: number[] = [];
    for (const node of before.nodes) {
        if (!TreeMath.isKeyed(node.nodeIndex, numLeaves)) {
            unkeyed.push(node.nodeIndex);
            continue;
        }
        records.set(node.nodeIndex, blank.has(node.nodeIndex) ? {nodeIndex: node.nodeIndex, generation: node.generation} : {...node});
    }
    const refreshedNodes = path.map(nodeIndex => {
        const record = records.get(nodeIndex);
        const generation = record ? record.generation + 1 : 0;
        const refreshed: types.cloud.GroupTreeRefreshedNode = {
            nodeIndex,
            ...(record ? {fromGeneration: record.generation} : {}),
            generation,
            publicKey: freshKey(nodeIndex, generation),
        };
        records.set(nodeIndex, {nodeIndex, generation, publicKey: refreshed.publicKey});
        return refreshed;
    });
    
    const rootIndex = TreeMath.root(numLeaves);
    const grant: types.cloud.GroupTreeEdge = TreeMath.isLeaf(rootIndex)
        ? {isGrantEdge: true, parentGeneration: newKeyVersion, childKind: "user", childUserId: seating[0], data: wrap("grant", seating[0])}
        : {isGrantEdge: true, parentGeneration: newKeyVersion, childKind: "node", childIndex: rootIndex,
            childGeneration: records.get(rootIndex)!.generation, data: wrap("grant", `${rootIndex}`)};
    const edges = [...edgesOwed(numLeaves, seating, records, path), grant];
    
    const touched = new Set([...blank, ...path, ...unkeyed]);
    const kept = before.edges.filter(edge => !edge.isGrantEdge && !touched.has(edge.parentIndex ?? -1));
    return {
        refreshedNodes,
        edges,
        blankedPositions,
        blanked: [...blank].filter(nodeIndex => !path.includes(nodeIndex)).sort((a, b) => a - b),
        after: {
            numLeaves,
            leafAssignment: seating,
            nodes: [...records.values()].sort((a, b) => a.nodeIndex - b.nodeIndex),
            edges: [...kept, ...edges],
        },
        keyVersion: newKeyVersion,
    };
}

/** The bridge's description of `op` — the caller and the subjects, nothing the client computed. */
export function commitOpFor(op: PlanOp, plan: Plan): CommitOp {
    const committer = userId(op.committer);
    switch (op.kind) {
        case "create": return {kind: "create", committer};
        case "selfUpdate": return {kind: "selfUpdate", committer};
        case "add": return {kind: "add", committer, addedUsers: op.members.map(userId), positions: op.positions};
        case "remove": return {kind: "remove", committer, removedUsers: op.removed.map(userId), blankedPositions: plan.blankedPositions};
    }
}

/** Plans `op` on `tree` and runs it through the production validator — the `TreeCommit` storage receives. */
export function acceptedCommit(tree: types.cloud.GroupTreeState, keyVersion: number, op: PlanOp): {plan: Plan, commit: TreeCommit} {
    const plan = planCommit(tree, keyVersion, op);
    const result = TreeTransitionValidator.validateCommit(
        {numLeaves: tree.numLeaves, leafAssignment: tree.leafAssignment, keyVersion, nodes: tree.nodes},
        commitOpFor(op, plan),
        {baseKeyVersion: keyVersion, refreshedNodes: plan.refreshedNodes, edges: plan.edges},
    );
    if (!result.ok) {
        throw new Error(`honest commit refused: ${JSON.stringify(result.rejections)}`);
    }
    return {plan, commit: result.commit};
}

/**
 * A well-formed tree for the given seating, as created by `creator` (default: the first seated member) and then
 * carried to `keyVersion` — the grant edge is the only part of a tree that names the epoch. `""` marks a blank.
 */
export function buildTree(assignment: string[], keyVersion: number, creator?: string): types.cloud.GroupTreeState {
    const empty: types.cloud.GroupTreeState = {numLeaves: assignment.length, leafAssignment: assignment.map(userId), nodes: [], edges: []};
    const tree = planCommit(empty, 0, {kind: "create", committer: creator ?? assignment.find(a => a !== "")!}).after;
    tree.edges.find(edge => edge.isGrantEdge)!.parentGeneration = keyVersion;
    return tree;
}

export function cloneTree(tree: types.cloud.GroupTreeState): types.cloud.GroupTreeState {
    return JSON.parse(JSON.stringify(tree)) as types.cloud.GroupTreeState;
}

/** The addition delta an honest adder submits. */
export function additionTransition(
    tree: types.cloud.GroupTreeState,
    keyVersion: number,
    committer: string,
    members: string[],
    positions: number[],
): types.cloud.GroupTreeAdditionTransition {
    const plan = planCommit(tree, keyVersion, {kind: "add", committer, members, positions});
    return {baseKeyVersion: keyVersion, positions, seatedNodes: plan.refreshedNodes, edges: plan.edges};
}

/** The removal delta an honest remover submits. */
export function removalTransition(
    tree: types.cloud.GroupTreeState,
    keyVersion: number,
    committer: string,
    removed: string[],
): types.cloud.GroupTreeTransition {
    const plan = planCommit(tree, keyVersion, {kind: "remove", committer, removed});
    return {baseKeyVersion: keyVersion, blankedPositions: plan.blankedPositions, refreshedNodes: plan.refreshedNodes, edges: plan.edges};
}

/** The self-update an honest member submits. */
export function selfUpdateTransition(tree: types.cloud.GroupTreeState, keyVersion: number, committer: string): types.cloud.GroupTreeSelfUpdateTransition {
    const plan = planCommit(tree, keyVersion, {kind: "selfUpdate", committer});
    return {baseKeyVersion: keyVersion, refreshedNodes: plan.refreshedNodes, edges: plan.edges};
}

/** Real ECC keys in an addition delta, for the paths where the API validator insists on them. */
export function withAdditionTransitionNodeKeys(
    transition: types.cloud.GroupTreeAdditionTransition,
    keyFor: (nodeIndex: number, generation: number) => types.core.EccPubKey,
): types.cloud.GroupTreeAdditionTransition {
    return {
        ...transition,
        seatedNodes: transition.seatedNodes.map(node => ({...node, publicKey: keyFor(node.nodeIndex, node.generation)})),
    };
}

/**
 * Swaps placeholder node keys for whatever `keyFor` returns — the API validator insists on real ECC keys, which
 * unit tests calling the service directly do not need. Blank nodes stay blank.
 */
export function withNodeKeys(
    tree: types.cloud.GroupTreeState,
    keyFor: (nodeIndex: number, generation: number) => types.core.EccPubKey,
): types.cloud.GroupTreeState {
    const result = cloneTree(tree);
    for (const node of result.nodes) {
        if (node.publicKey) {
            node.publicKey = keyFor(node.nodeIndex, node.generation);
        }
    }
    return result;
}

/** Swaps the placeholder keys of a transition's refreshed nodes, as `withNodeKeys` does for a whole tree. */
export function withTransitionNodeKeys<T extends {refreshedNodes: types.cloud.GroupTreeRefreshedNode[]}>(
    transition: T,
    keyFor: (nodeIndex: number, generation: number) => types.core.EccPubKey,
): T {
    return {
        ...transition,
        refreshedNodes: transition.refreshedNodes.map(node => ({
            ...node,
            publicKey: keyFor(node.nodeIndex, node.generation),
        })),
    };
}

/**
 * The one edge a rotation writes: the new grant key wrapped to the root, which the rotation does not move.
 *
 * `childGeneration` is taken from the tree rather than assumed, so a fixture built against a refreshed root
 * stays honest — that is exactly the staleness the bridge checks for.
 */
export function rotationGrantEdge(tree: types.cloud.GroupTreeState, newKeyVersion: number): types.cloud.GroupTreeEdge {
    const rootIndex = TreeMath.root(tree.numLeaves);
    const root = tree.nodes.find(node => node.nodeIndex === rootIndex);
    return {
        isGrantEdge: true,
        parentGeneration: newKeyVersion,
        childKind: "node",
        childIndex: rootIndex,
        childGeneration: root?.generation ?? 0,
        data: `wrap:grant->${rootIndex}` as types.core.UserKeyData,
    };
}

/** One epoch's worth of well-formed rungs, as an honest client would submit them. */
export function rungsFor(newKeyVersion: number, eraFloor: number): types.cloud.GroupArchiveRung[] {
    return LadderMath.rungSpansFor(newKeyVersion, eraFloor).map(span => ({
        atKeyVersion: span.at,
        targetKeyVersion: span.target,
        // `epoch`: addressed to the grant key at `at` and naming nobody, which is the ordinary rung and the one
        // ciphertext that serves the whole group. `user`/`group` are the era-crossing kinds, and those have to
        // name their recipient.
        recipientKind: "epoch" as const,
        data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
    }));
}
