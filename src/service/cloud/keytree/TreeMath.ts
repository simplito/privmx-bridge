/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Array-indexed left-balanced binary tree arithmetic for the hidden key tree.
 *
 * Layout follows RFC 9420 §4.1 — this arithmetic is the only thing borrowed from MLS. For `N` leaves the
 * tree occupies node indices `0 .. 2N-2`; leaf `i` sits at index `2i`; internal nodes are at odd indices.
 *
 * The topology is a pure function of `numLeaves`, so nothing about the tree structure is stored anywhere.
 * See documents/nested_groups/09-hidden-key-tree.md §2.
 *
 * The bridge needs this identically to the client: without it the server cannot know which nodes a removal
 * is obliged to refresh, and therefore cannot enforce path completeness — the check that stops a removed
 * member from keeping a current node key. See §6 of that document.
 *
 * **Left-balanced means the right edge may be incomplete.** With `N = 3` the root is at index 3, but index 5
 * does not exist, so node 3's right child is node 4 (found by walking down) and node 4's parent is node 3
 * (found by walking up). Both walks are implemented here; callers must always use the size-aware variants.
 */
export class TreeMath {
    
    /** Total number of nodes in a tree with `numLeaves` leaves. */
    static nodeCount(numLeaves: number): number {
        TreeMath.assertNumLeaves(numLeaves);
        return 2 * numLeaves - 1;
    }
    
    /** Node index of the leaf at the given position. */
    static leafNode(position: number): number {
        if (!Number.isInteger(position) || position < 0) {
            throw new Error(`invalid leaf position: ${position}`);
        }
        return 2 * position;
    }
    
    /** Leaf position of a leaf node index. Throws when the node is internal. */
    static leafPosition(nodeIndex: number): number {
        if (!TreeMath.isLeaf(nodeIndex)) {
            throw new Error(`node ${nodeIndex} is not a leaf`);
        }
        return nodeIndex / 2;
    }
    
    /** Leaves sit at even indices, internal nodes at odd ones. */
    static isLeaf(nodeIndex: number): boolean {
        TreeMath.assertNodeIndex(nodeIndex);
        return nodeIndex % 2 === 0;
    }
    
    /**
     * Level of a node: the number of trailing 1-bits of its index. Leaves are level 0.
     *
     * e.g. `7 = 0b111` → 3, `11 = 0b1011` → 2, `13 = 0b1101` → 1, `6 = 0b110` → 0.
     */
    static level(nodeIndex: number): number {
        TreeMath.assertNodeIndex(nodeIndex);
        let k = 0;
        let x = nodeIndex;
        while (x % 2 === 1) {
            k += 1;
            x = (x - 1) / 2;
        }
        return k;
    }
    
    /** `2^exponent`, spelled out so the module needs no bitwise operators. */
    private static pow2(exponent: number): number {
        let value = 1;
        for (let i = 0; i < exponent; i++) {
            value *= 2;
        }
        return value;
    }
    
    /** Root index for a tree with `numLeaves` leaves: `2^ceil(log2 N) - 1`. */
    static root(numLeaves: number): number {
        TreeMath.assertNumLeaves(numLeaves);
        let w = 1;
        while (w < numLeaves) {
            w *= 2;
        }
        return w - 1;
    }
    
    /** Depth of the tree: `ceil(log2 N)`. Also the maximum length of a direct path. */
    static depth(numLeaves: number): number {
        TreeMath.assertNumLeaves(numLeaves);
        let d = 0;
        let w = 1;
        while (w < numLeaves) {
            w *= 2;
            d += 1;
        }
        return d;
    }
    
    /** Whether the node exists in a tree of the given size. */
    static exists(nodeIndex: number, numLeaves: number): boolean {
        TreeMath.assertNodeIndex(nodeIndex);
        return nodeIndex < TreeMath.nodeCount(numLeaves);
    }
    
    // ── Structural steps (size-unaware; internal building blocks) ─────────────
    
    /** Left child of an internal node, ignoring tree size. Always in range when the node is. */
    static leftStep(nodeIndex: number): number {
        const k = TreeMath.level(nodeIndex);
        if (k === 0) {
            throw new Error(`leaf ${nodeIndex} has no children`);
        }
        return nodeIndex - TreeMath.pow2(k - 1);
    }
    
    /** Right child of an internal node, ignoring tree size. May fall outside a truncated tree. */
    static rightStep(nodeIndex: number): number {
        const k = TreeMath.level(nodeIndex);
        if (k === 0) {
            throw new Error(`leaf ${nodeIndex} has no children`);
        }
        return nodeIndex + TreeMath.pow2(k - 1);
    }
    
    /**
     * Parent of a node, ignoring tree size. May fall outside a truncated tree.
     *
     * The bitwise form is `(x | 2^k) & ~(2^(k+1))`. Since a node of level `k` has exactly `k` trailing
     * 1-bits, its bit `k` is 0, so the OR is an addition; the AND then clears bit `k+1` if it is set.
     */
    static parentStep(nodeIndex: number): number {
        const k = TreeMath.level(nodeIndex);
        const bit = TreeMath.pow2(k);
        const withBitSet = nodeIndex + bit;
        const nextBit = bit * 2;
        const nextBitIsSet = Math.floor(withBitSet / nextBit) % 2 === 1;
        return nextBitIsSet ? withBitSet - nextBit : withBitSet;
    }
    
    // ── Size-aware relations (the ones callers must use) ─────────────────────
    
    /** Left child within a tree of the given size. */
    static left(nodeIndex: number, numLeaves: number): number {
        const l = TreeMath.leftStep(nodeIndex);
        if (!TreeMath.exists(l, numLeaves)) {
            // Unreachable for a left child: leftStep only decreases the index.
            throw new Error(`left child ${l} of ${nodeIndex} outside tree of ${numLeaves} leaves`);
        }
        return l;
    }
    
    /**
     * Right child within a tree of the given size.
     *
     * In a truncated tree the naive right child may not exist; the real right child is then the root of the
     * truncated right subtree, found by walking down-left. e.g. `right(3, numLeaves=3) === 4`.
     */
    static right(nodeIndex: number, numLeaves: number): number {
        let r = TreeMath.rightStep(nodeIndex);
        while (!TreeMath.exists(r, numLeaves)) {
            r = TreeMath.leftStep(r);
        }
        return r;
    }
    
    /**
     * Parent within a tree of the given size.
     *
     * In a truncated tree the naive parent may not exist; the real parent is then found by walking further
     * up. e.g. `parent(4, numLeaves=3) === 3`, because index 5 does not exist.
     *
     * @throws when called on the root, which has no parent
     */
    static parent(nodeIndex: number, numLeaves: number): number {
        const rootIndex = TreeMath.root(numLeaves);
        if (nodeIndex === rootIndex) {
            throw new Error(`root ${nodeIndex} has no parent`);
        }
        if (!TreeMath.exists(nodeIndex, numLeaves)) {
            throw new Error(`node ${nodeIndex} outside tree of ${numLeaves} leaves`);
        }
        let p = TreeMath.parentStep(nodeIndex);
        while (!TreeMath.exists(p, numLeaves)) {
            p = TreeMath.parentStep(p);
        }
        return p;
    }
    
    /** The other child of this node's parent. */
    static sibling(nodeIndex: number, numLeaves: number): number {
        const p = TreeMath.parent(nodeIndex, numLeaves);
        return nodeIndex < p ? TreeMath.right(p, numLeaves) : TreeMath.left(p, numLeaves);
    }
    
    /** Existing children of a node: two for an internal node, none for a leaf. */
    static children(nodeIndex: number, numLeaves: number): number[] {
        if (TreeMath.isLeaf(nodeIndex)) {
            return [];
        }
        return [TreeMath.left(nodeIndex, numLeaves), TreeMath.right(nodeIndex, numLeaves)];
    }
    
    // ── Paths ────────────────────────────────────────────────────────────────
    
    /**
     * Nodes from the leaf's parent up to and including the root, bottom-up.
     *
     * This is **exactly** the set of nodes a removal must refresh. The bridge compares it against what the
     * client submitted — no less (a hole in post-removal confidentiality) and no more (an unrequested epoch
     * change). See documents/nested_groups/09-hidden-key-tree.md §6.
     *
     * Empty for a single-leaf tree, where the leaf is itself the root.
     */
    static directPath(position: number, numLeaves: number): number[] {
        const leaf = TreeMath.leafNode(position);
        TreeMath.assertLeafInTree(leaf, numLeaves);
        const rootIndex = TreeMath.root(numLeaves);
        const path: number[] = [];
        let current = leaf;
        while (current !== rootIndex) {
            current = TreeMath.parent(current, numLeaves);
            path.push(current);
        }
        return path;
    }
    
    /**
     * Siblings alongside the leaf's direct path — the nodes a refresh wraps to.
     *
     * A member never reaches a copath node. That is where collusion resistance comes from: pooling stale
     * keys from several removed members yields no current key.
     *
     * `copath[i]` is the sibling encountered when stepping to `directPath[i]`, so the two are index-aligned.
     */
    static copath(position: number, numLeaves: number): number[] {
        const leaf = TreeMath.leafNode(position);
        TreeMath.assertLeafInTree(leaf, numLeaves);
        const rootIndex = TreeMath.root(numLeaves);
        const co: number[] = [];
        let current = leaf;
        while (current !== rootIndex) {
            co.push(TreeMath.sibling(current, numLeaves));
            current = TreeMath.parent(current, numLeaves);
        }
        return co;
    }
    
    /** All leaf positions under a node, ascending. Used to decide whether a subtree is entirely blank. */
    static leavesUnder(nodeIndex: number, numLeaves: number): number[] {
        if (TreeMath.isLeaf(nodeIndex)) {
            return [TreeMath.leafPosition(nodeIndex)];
        }
        return [
            ...TreeMath.leavesUnder(TreeMath.left(nodeIndex, numLeaves), numLeaves),
            ...TreeMath.leavesUnder(TreeMath.right(nodeIndex, numLeaves), numLeaves),
        ];
    }
    
    /**
     * Number of leaves the tree must have to seat `position`, growing to the next power of two when needed.
     *
     * Adding a member never moves anyone: positions are filled lowest-blank-first and only ever appended at
     * the end, so growth is the only structural change and it is purely additive.
     */
    static numLeavesToSeat(position: number, currentNumLeaves: number): number {
        if (position < currentNumLeaves) {
            return currentNumLeaves;
        }
        return position + 1;
    }
    
    /** Whether seating `position` changes the root index, i.e. whether the grant edge must be re-linked. */
    static growthChangesRoot(position: number, currentNumLeaves: number): boolean {
        const next = TreeMath.numLeavesToSeat(position, currentNumLeaves);
        return TreeMath.root(next) !== TreeMath.root(currentNumLeaves);
    }
    
    // ── Guards ───────────────────────────────────────────────────────────────
    
    private static assertNumLeaves(numLeaves: number): void {
        if (!Number.isInteger(numLeaves) || numLeaves < 1) {
            throw new Error(`invalid numLeaves: ${numLeaves}`);
        }
    }
    
    private static assertNodeIndex(nodeIndex: number): void {
        if (!Number.isInteger(nodeIndex) || nodeIndex < 0) {
            throw new Error(`invalid node index: ${nodeIndex}`);
        }
    }
    
    private static assertLeafInTree(leaf: number, numLeaves: number): void {
        if (!TreeMath.exists(leaf, numLeaves)) {
            throw new Error(`leaf node ${leaf} outside tree of ${numLeaves} leaves`);
        }
    }
}
