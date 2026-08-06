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
    const after = refreshNodes(before, TreeMath.directPath(position, assignment.length));
    after.leafAssignment[position] = "" as types.cloud.UserId;
    after.edges = after.edges.filter(e => !(e.childKind === "user" && e.childUserId === userId(assignment[position])));
    const grant = after.edges.find(e => e.isGrantEdge);
    if (grant) {
        grant.parentGeneration = oldKeyVersion + 1;
    }
    return {before, after};
}
