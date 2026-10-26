/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import { Crypto } from "../../../utils/crypto/Crypto";
import { TreeMath } from "./TreeMath";
import { ByteWriter } from "./ByteWriter";
import type { TreeCommit } from "./TreeTransitionValidator";

/** What the tree hash reads: geometry, seating, and the node records by index. */
export interface HashableTree {
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    nodes: Map<number, {generation: number, publicKey?: types.core.EccPubKey, setBy?: number}>;
}

/**
 * The tree and roster hashes a commit statement signs (addendum spec §1). Byte-identical with the endpoint's.
 *
 * The tree hash covers the seating and every node record — key, generation and the statement that set it — so a
 * statement signed over it pins all of them at once: a bridge cannot swap a node key, seat an outsider or roll a
 * record back without the latest statement no longer matching. Unkeyed nodes contribute only their position, which
 * is what lets a client holding one path recompute the whole hash from the copath hashes alone.
 */
export class TreeHash {
    
    static leafHash(position: number, userId: string): Buffer {
        return Crypto.sha256(new ByteWriter().tag("pmx-tree-leaf").u32(position).lp(userId).bytes());
    }
    
    /** `CH(x)`: a leaf's hash for a leaf, the node hash otherwise. Every `CH` computed on the way is put in `memo`
     *  when one is given. */
    static childHash(tree: HashableTree, nodeIndex: number, memo?: Map<number, Buffer>): Buffer {
        const cached = memo?.get(nodeIndex);
        if (cached) {
            return cached;
        }
        if (TreeMath.isLeaf(nodeIndex)) {
            const position = TreeMath.leafPosition(nodeIndex);
            const hash = TreeHash.leafHash(position, tree.leafAssignment[position] ?? "");
            memo?.set(nodeIndex, hash);
            return hash;
        }
        const [left, right] = TreeMath.children(nodeIndex, tree.numLeaves);
        const hash = TreeHash.nodeHash(tree, nodeIndex, TreeHash.childHash(tree, left, memo), TreeHash.childHash(tree, right, memo));
        memo?.set(nodeIndex, hash);
        return hash;
    }
    
    /** `NH` of an internal node from its two children's `CH` — the step a client repeats up its path. */
    static nodeHash(tree: HashableTree, nodeIndex: number, left: Buffer, right: Buffer): Buffer {
        const writer = new ByteWriter();
        if (TreeMath.isKeyed(nodeIndex, tree.numLeaves)) {
            writer.tag("pmx-tree-node").u32(nodeIndex);
            const record = tree.nodes.get(nodeIndex);
            writer.u8(record ? 1 : 0);
            if (record) {
                const filled = !!record.publicKey;
                writer.u32(record.generation).u8(filled ? 1 : 0);
                if (filled) {
                    // A filled record without `setBy` hashes as 0, a seq no statement has: the hash is still
                    // defined, and can never match one a member signed.
                    writer.lp(record.publicKey!).u64(record.setBy ?? 0);
                }
            }
        }
        else {
            writer.tag("pmx-tree-inner").u32(nodeIndex);
        }
        return Crypto.sha256(writer.raw(left).raw(right).bytes());
    }
    
    /** `CH` of every node and leaf, in one pass — what every seat's copath hashes read off. */
    static childHashes(tree: HashableTree): Map<number, Buffer> {
        const memo = new Map<number, Buffer>();
        TreeHash.childHash(tree, TreeMath.root(tree.numLeaves), memo);
        return memo;
    }
    
    static treeHash(tree: HashableTree, memo?: Map<number, Buffer>): Buffer {
        return Crypto.sha256(new ByteWriter()
            .tag("pmx-tree")
            .u32(tree.numLeaves)
            .raw(TreeHash.childHash(tree, TreeMath.root(tree.numLeaves), memo))
            .bytes());
    }
    
    /** `CH(c)` for each `c` on the seat's copath, aligned with `TreeMath.copath` — what a client holding only its
     *  own path needs to recompute the tree hash. `hashes` (`childHashes`, or any subset of it) saves recomputing
     *  them; it is only read, never added to, so a cache can hand over a map it keeps bounded. */
    static copathHashes(tree: HashableTree, position: number, hashes?: Map<number, Buffer>): Buffer[] {
        return TreeMath.copath(position, tree.numLeaves).map(nodeIndex => hashes?.get(nodeIndex) ?? TreeHash.childHash(tree, nodeIndex));
    }
    
    /** Each list deduplicated and sorted bytewise (as UTF-8), so both sides agree whatever order they hold it in. */
    static rosterHash(users: string[], managers: string[]): Buffer {
        const writer = new ByteWriter().tag("pmx-tree-roster");
        for (const list of [users, managers]) {
            const sorted = TreeHash.sortedUnique(list);
            writer.u32(sorted.length);
            sorted.forEach(userId => writer.lp(userId));
        }
        return Crypto.sha256(writer.bytes());
    }
    
    /** Deduplicated and sorted by UTF-8 bytes — not by UTF-16 code units, which is what `Array.sort` compares. */
    static sortedUnique<T extends string>(values: T[]): T[] {
        return [...new Set(values)].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    }
    
    /**
     * The state an accepted commit leaves behind, as its statement must hash it: blanked records lose key and
     * `setBy`, un-keyed ones go, and the re-keyed path is vouched for by the statement being written (`seq`).
     */
    static afterCommit(storedNodes: types.cloud.GroupTreeNode[], commit: TreeCommit, seq: number): HashableTree {
        const blanked = new Set(commit.blanked);
        const unkeyed = new Set(commit.unkeyed);
        const nodes: HashableTree["nodes"] = new Map();
        for (const node of storedNodes) {
            if (!unkeyed.has(node.nodeIndex)) {
                nodes.set(node.nodeIndex, blanked.has(node.nodeIndex) ? {generation: node.generation} : node);
            }
        }
        for (const node of commit.refreshed) {
            nodes.set(node.nodeIndex, {generation: node.generation, publicKey: node.publicKey, setBy: seq});
        }
        return {numLeaves: commit.numLeaves, leafAssignment: commit.leafAssignment, nodes};
    }
    
    /** The records of a served or stored state, as `treeHash` reads them. */
    static of(tree: {numLeaves: number, leafAssignment: types.cloud.UserId[], nodes: types.cloud.GroupTreeNode[]}): HashableTree {
        return {numLeaves: tree.numLeaves, leafAssignment: tree.leafAssignment, nodes: new Map(tree.nodes.map(node => [node.nodeIndex, node]))};
    }
}
