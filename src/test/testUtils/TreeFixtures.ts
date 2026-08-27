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
import { TreeValidator } from "../../service/cloud/keytree/TreeValidator";
import { LadderMath } from "../../service/cloud/keytree/LadderMath";

/**
 * Hidden key tree fixtures for the bridge's tests.
 *
 * The wrapped blobs are recognisable placeholders rather than real ciphertexts, and deliberately so: the bridge
 * cannot decrypt an edge, so every rule it enforces is decidable from indices, generations and roster membership.
 * A fixture that carried real keys would prove nothing extra and hide what is actually being checked. The real
 * crypto is exercised on the endpoint side (see privmx-endpoint/test/tests/unit/TreeKeysTest.cpp).
 */

export function userId(name: string): types.cloud.UserId {
    return name as types.cloud.UserId;
}

/** Builds a well-formed tree for the given seating. `""` marks a blank left by a removal. */
export function buildTree(
    assignment: string[],
    keyVersion: number,
    generations: Map<number, number> = new Map(),
): types.cloud.GroupTreeState {
    const numLeaves = assignment.length;
    const generationOf = (nodeIndex: number) => generations.get(nodeIndex) ?? 0;
    const nodes: types.cloud.GroupTreeNode[] = TreeValidator.internalNodes(numLeaves).map(nodeIndex => ({
        nodeIndex,
        generation: generationOf(nodeIndex),
        publicKey: `pk:${nodeIndex}g${generationOf(nodeIndex)}` as types.core.EccPubKey,
    }));
    const edges: types.cloud.GroupTreeEdge[] = [];
    for (const parentIndex of TreeValidator.internalNodes(numLeaves)) {
        for (const childIndex of TreeMath.children(parentIndex, numLeaves)) {
            if (TreeMath.isLeaf(childIndex)) {
                const holder = assignment[TreeMath.leafPosition(childIndex)];
                if (!holder) {
                    continue;
                }
                edges.push({
                    parentIndex,
                    parentGeneration: generationOf(parentIndex),
                    childKind: "user",
                    childUserId: userId(holder),
                    data: `wrap:${parentIndex}->${holder}` as types.core.UserKeyData,
                });
            }
            else {
                edges.push({
                    parentIndex,
                    parentGeneration: generationOf(parentIndex),
                    childKind: "node",
                    childIndex,
                    childGeneration: generationOf(childIndex),
                    data: `wrap:${parentIndex}->${childIndex}` as types.core.UserKeyData,
                });
            }
        }
    }
    const rootIndex = TreeMath.root(numLeaves);
    if (TreeMath.isLeaf(rootIndex)) {
        // A one-member group has no internal node: the root is the member's own leaf.
        edges.push({
            isGrantEdge: true,
            parentGeneration: keyVersion,
            childKind: "user",
            childUserId: userId(assignment[0]),
            data: `wrap:grant->${assignment[0]}` as types.core.UserKeyData,
        });
    }
    else {
        edges.push({
            isGrantEdge: true,
            parentGeneration: keyVersion,
            childKind: "node",
            childIndex: rootIndex,
            childGeneration: generationOf(rootIndex),
            data: `wrap:grant->${rootIndex}` as types.core.UserKeyData,
        });
    }
    return {numLeaves, leafAssignment: assignment.map(userId), nodes, edges};
}

export function cloneTree(tree: types.cloud.GroupTreeState): types.cloud.GroupTreeState {
    return JSON.parse(JSON.stringify(tree)) as types.cloud.GroupTreeState;
}

/** Refreshes the given nodes and re-wraps every edge naming them, the way an honest client would. */
export function refreshNodes(tree: types.cloud.GroupTreeState, nodeIndices: number[]): types.cloud.GroupTreeState {
    const result = cloneTree(tree);
    for (const nodeIndex of nodeIndices) {
        const node = result.nodes.find(n => n.nodeIndex === nodeIndex);
        if (!node) {
            continue;
        }
        node.generation += 1;
        node.publicKey = `pk:${nodeIndex}g${node.generation}` as types.core.EccPubKey;
    }
    const generationOf = (nodeIndex: number) => result.nodes.find(n => n.nodeIndex === nodeIndex)?.generation ?? 0;
    for (const edge of result.edges) {
        if (edge.isGrantEdge) {
            if (edge.childKind === "node" && edge.childIndex !== undefined) {
                edge.childGeneration = generationOf(edge.childIndex);
            }
            continue;
        }
        if (edge.parentIndex !== undefined) {
            edge.parentGeneration = generationOf(edge.parentIndex);
        }
        if (edge.childKind === "node" && edge.childIndex !== undefined) {
            edge.childGeneration = generationOf(edge.childIndex);
        }
    }
    return result;
}

/**
 * The tree an honest client submits when removing the member at `position`: leaf blanked, direct path refreshed,
 * the departing member's edge dropped, and the grant edge re-addressed to the new epoch.
 */
export function treeAfterRemoval(
    assignment: string[],
    position: number,
    oldKeyVersion: number,
): {before: types.cloud.GroupTreeState, after: types.cloud.GroupTreeState} {
    const before = buildTree(assignment, oldKeyVersion);
    return {before, after: applyRemoval(before, position, oldKeyVersion + 1)};
}

/** The same removal applied to a tree that was served rather than freshly built — the only way to chain two
 *  operations, since the second starts from generations the first advanced. */
export function applyRemoval(
    tree: types.cloud.GroupTreeState,
    position: number,
    newKeyVersion: number,
): types.cloud.GroupTreeState {
    const removed = tree.leafAssignment[position];
    const after = refreshNodes(tree, TreeMath.directPath(position, tree.numLeaves));
    after.leafAssignment[position] = "" as types.cloud.UserId;
    after.edges = after.edges.filter(e => !(e.childKind === "user" && e.childUserId === removed));
    const grant = after.edges.find(e => e.isGrantEdge);
    if (grant) {
        grant.parentGeneration = newKeyVersion;
    }
    return after;
}

/** Seating a newcomer in a blank: one new edge, nothing refreshed, epoch unchanged. */
export function applyAddition(
    tree: types.cloud.GroupTreeState,
    newMember: types.cloud.UserId,
    position: number,
): types.cloud.GroupTreeState {
    const after = cloneTree(tree);
    after.leafAssignment[position] = newMember;
    const parentIndex = TreeMath.parent(TreeMath.leafNode(position), after.numLeaves);
    after.edges.push({
        parentIndex,
        parentGeneration: after.nodes.find(n => n.nodeIndex === parentIndex)?.generation ?? 0,
        childKind: "user",
        childUserId: newMember,
        data: `wrap:${parentIndex}->${newMember}` as types.core.UserKeyData,
    });
    return after;
}

/**
 * Seating a newcomer the way a client that cannot borrow anybody's node key has to: the new leaf's direct path
 * refreshed, every edge under it re-wrapped, the grant edge re-linked — all at the same epoch.
 *
 * Nodes that did not exist before start at generation 0; the rest advance by one. Off-path nodes keep their
 * generation, and since the fixture's public keys are a function of `(nodeIndex, generation)` they come through
 * byte-identical, which is what the validator requires of them.
 */
export function applyAdditionWithPathRefresh(
    tree: types.cloud.GroupTreeState,
    newMember: types.cloud.UserId,
    position: number,
    keyVersion: number,
): types.cloud.GroupTreeState {
    const newNumLeaves = TreeMath.numLeavesToSeat(position, tree.numLeaves);
    const assignment: string[] = [...tree.leafAssignment];
    while (assignment.length < newNumLeaves) {
        assignment.push("");
    }
    assignment[position] = newMember;
    const generations = new Map(tree.nodes.map(node => [node.nodeIndex, node.generation]));
    for (const nodeIndex of TreeMath.directPath(position, newNumLeaves)) {
        generations.set(nodeIndex, (generations.get(nodeIndex) ?? -1) + 1);
    }
    return buildTree(assignment, keyVersion, generations);
}

/**
 * The addition an honest client submits as a delta: the new leaf's path re-keyed in the geometry seating it
 * produces, every edge that re-keying owes, and the grant edge re-issued to the new root **at the same epoch**.
 */
export function additionTransition(
    tree: types.cloud.GroupTreeState,
    newMember: types.cloud.UserId,
    position: number,
    keyVersion: number,
): types.cloud.GroupTreeAdditionTransition {
    const numLeaves = TreeMath.numLeavesToSeat(position, tree.numLeaves);
    const path = TreeMath.directPath(position, numLeaves);
    const stored = new Map(tree.nodes.map(node => [node.nodeIndex, node]));
    const seatedNodes: types.cloud.GroupTreeSeatedNode[] = path.map(nodeIndex => {
        const current = stored.get(nodeIndex);
        const generation = current === undefined ? 0 : current.generation + 1;
        return {
            nodeIndex,
            ...(current === undefined ? {} : {fromGeneration: current.generation}),
            generation,
            publicKey: `pk:${nodeIndex}g${generation}` as types.core.EccPubKey,
        };
    });
    const seated = new Map(seatedNodes.map(node => [node.nodeIndex, node]));
    const generationOf = (nodeIndex: number) =>
        seated.get(nodeIndex)?.generation ?? stored.get(nodeIndex)?.generation ?? 0;
    const seating: types.cloud.UserId[] = [...tree.leafAssignment];
    while (seating.length < numLeaves) {
        seating.push("" as types.cloud.UserId);
    }
    seating[position] = newMember;
    
    const edges: types.cloud.GroupTreeEdge[] = [];
    for (const parentIndex of path) {
        for (const childIndex of TreeMath.children(parentIndex, numLeaves)) {
            if (TreeMath.isLeaf(childIndex)) {
                const holder = seating[TreeMath.leafPosition(childIndex)];
                if (!holder) {
                    continue;
                }
                edges.push({
                    parentIndex,
                    parentGeneration: generationOf(parentIndex),
                    childKind: "user",
                    childUserId: holder,
                    data: `wrap:${parentIndex}->${holder}` as types.core.UserKeyData,
                });
                continue;
            }
            edges.push({
                parentIndex,
                parentGeneration: generationOf(parentIndex),
                childKind: "node",
                childIndex,
                childGeneration: generationOf(childIndex),
                data: `wrap:${parentIndex}->${childIndex}` as types.core.UserKeyData,
            });
        }
    }
    const rootIndex = TreeMath.root(numLeaves);
    edges.push({
        isGrantEdge: true,
        // Unchanged: an addition that moved the epoch would stale every container the group reads.
        parentGeneration: keyVersion,
        childKind: "node",
        childIndex: rootIndex,
        childGeneration: generationOf(rootIndex),
        data: "wrap:grant->root" as types.core.UserKeyData,
    });
    return {baseKeyVersion: keyVersion, position, seatedNodes, edges};
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
 * unit tests calling the service directly do not need. Keyed by `(nodeIndex, generation)` so a memoizing caller
 * keeps untouched nodes identical and gives refreshed ones a genuinely different key.
 */
export function withNodeKeys(
    tree: types.cloud.GroupTreeState,
    keyFor: (nodeIndex: number, generation: number) => types.core.EccPubKey,
): types.cloud.GroupTreeState {
    const result = cloneTree(tree);
    for (const node of result.nodes) {
        node.publicKey = keyFor(node.nodeIndex, node.generation);
    }
    return result;
}

/**
 * The removal an honest client submits as a delta: the path refreshed one generation on, the edges that refresh
 * owes, and the grant edge re-linked to the new epoch.
 *
 * Built from whatever view of the tree it is given — a path view is enough, which is the point of the shape.
 */
export function removalTransition(
    tree: types.cloud.GroupTreeState,
    position: number,
    baseKeyVersion: number,
): types.cloud.GroupTreeTransition {
    const path = TreeMath.directPath(position, tree.numLeaves);
    const generationOf = (nodeIndex: number) => tree.nodes.find(n => n.nodeIndex === nodeIndex)?.generation ?? 0;
    const refreshedNodes = path.map(nodeIndex => ({
        nodeIndex,
        fromGeneration: generationOf(nodeIndex),
        generation: generationOf(nodeIndex) + 1,
        publicKey: `pk:${nodeIndex}g${generationOf(nodeIndex) + 1}` as types.core.EccPubKey,
    }));
    const newGenerationOf = (nodeIndex: number) =>
        refreshedNodes.find(n => n.nodeIndex === nodeIndex)?.generation ?? generationOf(nodeIndex);
    const blankedLeaf = TreeMath.leafNode(position);
    const seating = [...tree.leafAssignment];
    seating[position] = "" as types.cloud.UserId;
    
    const edges: types.cloud.GroupTreeEdge[] = [];
    for (const parentIndex of path) {
        for (const childIndex of TreeMath.children(parentIndex, tree.numLeaves)) {
            if (childIndex === blankedLeaf) {
                continue;
            }
            if (TreeMath.isLeaf(childIndex)) {
                const holder = seating[TreeMath.leafPosition(childIndex)];
                if (!holder) {
                    continue;
                }
                edges.push({
                    parentIndex,
                    parentGeneration: newGenerationOf(parentIndex),
                    childKind: "user",
                    childUserId: holder,
                    data: `wrap:${parentIndex}->${holder}` as types.core.UserKeyData,
                });
                continue;
            }
            edges.push({
                parentIndex,
                parentGeneration: newGenerationOf(parentIndex),
                childKind: "node",
                childIndex,
                childGeneration: newGenerationOf(childIndex),
                data: `wrap:${parentIndex}->${childIndex}` as types.core.UserKeyData,
            });
        }
    }
    const rootIndex = TreeMath.root(tree.numLeaves);
    edges.push({
        isGrantEdge: true,
        parentGeneration: baseKeyVersion + 1,
        childKind: "node",
        childIndex: rootIndex,
        childGeneration: newGenerationOf(rootIndex),
        data: "wrap:grant->root" as types.core.UserKeyData,
    });
    return {baseKeyVersion, blankedPosition: position, refreshedNodes, edges};
}

/** Swaps the placeholder keys of a transition's refreshed nodes, as `withNodeKeys` does for a whole tree. */
export function withTransitionNodeKeys(
    transition: types.cloud.GroupTreeTransition,
    keyFor: (nodeIndex: number, generation: number) => types.core.EccPubKey,
): types.cloud.GroupTreeTransition {
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
