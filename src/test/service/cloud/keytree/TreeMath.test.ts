/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as assert from "assert";
import { TreeMath } from "../../../../service/cloud/keytree/TreeMath";

/**
 * Unit tests for the hidden key tree arithmetic.
 *
 * The truncated cases (N not a power of two) are the ones that break naive implementations, so they get the
 * most coverage.
 */

describe("TreeMath.level", () => {
    // level(x) = number of trailing 1-bits. Table for the N=8 tree from the spec.
    each<[number, number]>([
        [0, 0], [1, 1], [2, 0], [3, 2], [4, 0], [5, 1], [6, 0], [7, 3],
        [8, 0], [9, 1], [10, 0], [11, 2], [12, 0], [13, 1], [14, 0],
    ]).it("level(%s)", ([node, expected]) => {
        assert.strictEqual(TreeMath.level(node), expected);
    });
    
    it("leaves are always level 0", () => {
        for (let position = 0; position < 64; position++) {
            assert.strictEqual(TreeMath.level(TreeMath.leafNode(position)), 0);
        }
    });
    
    it("rejects a negative or fractional index", () => {
        assert.throws(() => TreeMath.level(-1));
        assert.throws(() => TreeMath.level(1.5));
    });
});

describe("TreeMath.isLeaf / leafNode / leafPosition", () => {
    it("leaf i sits at index 2i and round-trips", () => {
        for (let position = 0; position < 32; position++) {
            const node = TreeMath.leafNode(position);
            assert.strictEqual(node, 2 * position);
            assert.strictEqual(TreeMath.isLeaf(node), true);
            assert.strictEqual(TreeMath.leafPosition(node), position);
        }
    });
    
    it("odd indices are internal", () => {
        for (const node of [1, 3, 5, 7, 9, 11, 13]) {
            assert.strictEqual(TreeMath.isLeaf(node), false);
        }
    });
    
    it("leafPosition rejects an internal node", () => {
        assert.throws(() => TreeMath.leafPosition(3));
    });
});

describe("TreeMath.root / depth / nodeCount", () => {
    each<[number, number, number, number]>([
        // numLeaves, root, depth, nodeCount
        [1, 0, 0, 1],
        [2, 1, 1, 3],
        [3, 3, 2, 5],
        [4, 3, 2, 7],
        [5, 7, 3, 9],
        [6, 7, 3, 11],
        [7, 7, 3, 13],
        [8, 7, 3, 15],
        [9, 15, 4, 17],
        [1000, 1023, 10, 1999],
    ]).it("numLeaves=%s", ([numLeaves, root, depth, nodeCount]) => {
        assert.strictEqual(TreeMath.root(numLeaves), root);
        assert.strictEqual(TreeMath.depth(numLeaves), depth);
        assert.strictEqual(TreeMath.nodeCount(numLeaves), nodeCount);
    });
    
    it("rejects numLeaves below 1", () => {
        assert.throws(() => TreeMath.root(0));
        assert.throws(() => TreeMath.depth(-1));
        assert.throws(() => TreeMath.nodeCount(0));
    });
});

describe("TreeMath.parent — complete trees", () => {
    // N=4: leaves 0,2,4,6; node 1 = parent(0,2); node 5 = parent(4,6); node 3 = root.
    each<[number, number]>([
        [0, 1], [2, 1], [1, 3], [5, 3], [4, 5], [6, 5],
    ]).it("parent(%s, N=4)", ([node, expected]) => {
        assert.strictEqual(TreeMath.parent(node, 4), expected);
    });
    
    it("root has no parent", () => {
        assert.throws(() => TreeMath.parent(3, 4));
        assert.throws(() => TreeMath.parent(0, 1));
    });
});

describe("TreeMath.parent — truncated right edge", () => {
    /**
     * N=3: nodes 0..4, root=3. Node 5 does not exist, so node 4's naive parent (5) must be walked past,
     * landing on 3. This is the case that breaks implementations using the bare formula.
     */
    it("walks past a non-existent parent (N=3)", () => {
        assert.strictEqual(TreeMath.parentStep(4), 5, "naive parent is out of range");
        assert.strictEqual(TreeMath.exists(5, 3), false);
        assert.strictEqual(TreeMath.parent(4, 3), 3);
    });
    
    it("N=5: leaf 4 attaches directly to the root", () => {
        // nodes 0..8, root=7. parentStep(8)=9 (absent) -> parentStep(9)=11 (absent) -> ... -> 7
        assert.strictEqual(TreeMath.exists(9, 5), false);
        assert.strictEqual(TreeMath.parent(8, 5), 7);
    });
    
    it("N=6: node 9 is the parent of leaves 8 and 10", () => {
        // nodes 0..10, root=7
        assert.strictEqual(TreeMath.parent(8, 6), 9);
        assert.strictEqual(TreeMath.parent(10, 6), 9);
        assert.strictEqual(TreeMath.parent(9, 6), 7);
    });
    
    it("every non-root node has a parent that exists, for all N up to 40", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            const rootIndex = TreeMath.root(numLeaves);
            for (let node = 0; node < TreeMath.nodeCount(numLeaves); node++) {
                if (node === rootIndex) {
                    continue;
                }
                const p = TreeMath.parent(node, numLeaves);
                assert.ok(TreeMath.exists(p, numLeaves), `parent(${node}, ${numLeaves})=${p} must exist`);
                assert.ok(p !== node, "parent must differ from the node");
            }
        }
    });
});

describe("TreeMath.right — truncated right edge", () => {
    it("walks down to the truncated right subtree (N=3)", () => {
        assert.strictEqual(TreeMath.rightStep(3), 5, "naive right child is out of range");
        assert.strictEqual(TreeMath.right(3, 3), 4);
        assert.strictEqual(TreeMath.left(3, 3), 1);
    });
    
    it("N=5: root's right child is the lone leaf 8", () => {
        assert.strictEqual(TreeMath.right(7, 5), 8);
    });
    
    it("children are mutual with parent, for all N up to 40", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            for (let node = 1; node < TreeMath.nodeCount(numLeaves); node += 2) {
                for (const child of TreeMath.children(node, numLeaves)) {
                    assert.strictEqual(
                        TreeMath.parent(child, numLeaves), node,
                        `parent(child ${child} of ${node}, N=${numLeaves})`,
                    );
                }
            }
        }
    });
    
    it("leaves have no children", () => {
        assert.deepStrictEqual(TreeMath.children(0, 4), []);
        assert.throws(() => TreeMath.leftStep(0));
        assert.throws(() => TreeMath.rightStep(2));
    });
});

describe("TreeMath.sibling", () => {
    each<[number, number, number, number]>([
        // node, numLeaves, expected sibling
        [0, 4, 2, 0], [2, 4, 0, 0], [1, 4, 5, 0], [5, 4, 1, 0],
        [4, 4, 6, 0], [6, 4, 4, 0],
    ]).it("sibling(%s, N=%s)", ([node, numLeaves, expected]) => {
        assert.strictEqual(TreeMath.sibling(node, numLeaves), expected);
    });
    
    it("truncated: sibling(4, N=3) is the subtree rooted at 1", () => {
        assert.strictEqual(TreeMath.sibling(4, 3), 1);
        assert.strictEqual(TreeMath.sibling(1, 3), 4);
    });
    
    it("sibling is symmetric, for all N up to 40", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            const rootIndex = TreeMath.root(numLeaves);
            for (let node = 0; node < TreeMath.nodeCount(numLeaves); node++) {
                if (node === rootIndex) {
                    continue;
                }
                const s = TreeMath.sibling(node, numLeaves);
                assert.strictEqual(TreeMath.sibling(s, numLeaves), node, `N=${numLeaves} node=${node}`);
            }
        }
    });
});

describe("TreeMath.directPath", () => {
    it("matches the spec table for N=8, leaf 0", () => {
        assert.deepStrictEqual(TreeMath.directPath(0, 8), [1, 3, 7]);
    });
    
    each<[number, number, number[]]>([
        [4, 0, [1, 3]],
        [4, 1, [1, 3]],
        [4, 2, [5, 3]],
        [4, 3, [5, 3]],
        [8, 7, [13, 11, 7]],
        [2, 0, [1]],
        [2, 1, [1]],
    ]).it("directPath in N=%s from position %s", ([numLeaves, position, expected]) => {
        assert.deepStrictEqual(TreeMath.directPath(position, numLeaves), expected);
    });
    
    it("is empty for a single-leaf tree, where the leaf is the root", () => {
        assert.deepStrictEqual(TreeMath.directPath(0, 1), []);
    });
    
    it("truncated N=3: leaf 0 climbs two levels, leaf 2 only one", () => {
        assert.deepStrictEqual(TreeMath.directPath(0, 3), [1, 3]);
        assert.deepStrictEqual(TreeMath.directPath(1, 3), [1, 3]);
        assert.deepStrictEqual(TreeMath.directPath(2, 3), [3]);
    });
    
    it("always ends at the root and never exceeds depth, for all N up to 64", () => {
        for (let numLeaves = 1; numLeaves <= 64; numLeaves++) {
            const rootIndex = TreeMath.root(numLeaves);
            for (let position = 0; position < numLeaves; position++) {
                const path = TreeMath.directPath(position, numLeaves);
                if (numLeaves > 1) {
                    assert.strictEqual(path[path.length - 1], rootIndex, `N=${numLeaves} pos=${position}`);
                }
                assert.ok(
                    path.length <= TreeMath.depth(numLeaves),
                    `N=${numLeaves} pos=${position} path=${path.length} depth=${TreeMath.depth(numLeaves)}`,
                );
                assert.strictEqual(new Set(path).size, path.length, "no repeats");
            }
        }
    });
    
    it("contains no leaves", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            for (let position = 0; position < numLeaves; position++) {
                for (const node of TreeMath.directPath(position, numLeaves)) {
                    assert.strictEqual(TreeMath.isLeaf(node), false, `N=${numLeaves} node=${node}`);
                }
            }
        }
    });
    
    it("rejects a position outside the tree", () => {
        assert.throws(() => TreeMath.directPath(4, 4));
        assert.throws(() => TreeMath.directPath(-1, 4));
    });
});

describe("TreeMath.copath", () => {
    it("matches the spec table for N=8, leaf 0", () => {
        assert.deepStrictEqual(TreeMath.copath(0, 8), [2, 5, 11]);
    });
    
    it("is index-aligned with directPath", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            for (let position = 0; position < numLeaves; position++) {
                const path = TreeMath.directPath(position, numLeaves);
                const co = TreeMath.copath(position, numLeaves);
                assert.strictEqual(co.length, path.length, `N=${numLeaves} pos=${position}`);
                // co[i] and the node stepped from must be the two children of path[i]
                let current = TreeMath.leafNode(position);
                for (let i = 0; i < path.length; i++) {
                    const kids = TreeMath.children(path[i], numLeaves).sort((a, b) => a - b);
                    assert.deepStrictEqual(
                        [current, co[i]].sort((a, b) => a - b), kids,
                        `N=${numLeaves} pos=${position} level=${i}`,
                    );
                    current = path[i];
                }
            }
        }
    });
    
    it("never contains a node on the direct path", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            for (let position = 0; position < numLeaves; position++) {
                const path = new Set(TreeMath.directPath(position, numLeaves));
                for (const node of TreeMath.copath(position, numLeaves)) {
                    assert.strictEqual(path.has(node), false, `N=${numLeaves} pos=${position} node=${node}`);
                }
            }
        }
    });
    
    it("a member's own leaf is never on its copath", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            for (let position = 0; position < numLeaves; position++) {
                const own = TreeMath.leafNode(position);
                assert.strictEqual(TreeMath.copath(position, numLeaves).includes(own), false);
            }
        }
    });
});

describe("TreeMath.isKeyed / keyedPath — shared expectations with the endpoint (spec §2)", () => {
    // Literal values, computed once from the definition by an independent implementation and checked by hand for
    // the small cases. The endpoint's TreeMathTest carries the same table; if either side's arithmetic drifts the
    // bridge rejects every honest commit, or accepts one that re-keys a node off the committer's path.
    each<[number, number, number, [number, number[]][]]>([
        // numLeaves, root, number of keyed nodes, [position, keyedPath]...
        [1, 0, 0, [[0, []]]],
        [2, 1, 1, [[0, [1]], [1, [1]]]],
        [3, 3, 1, [[0, [3]], [1, [3]], [2, [3]]]],
        [16, 15, 1, [[0, [15]], [8, [15]], [15, [15]]]],
        [17, 31, 1, [[0, [31]], [8, [31]], [16, [31]]]],
        [31, 31, 1, [[0, [31]], [15, [31]], [30, [31]]]],
        [32, 31, 1, [[0, [31]], [16, [31]], [31, [31]]]],
        [33, 63, 2, [[0, [31, 63]], [16, [31, 63]], [32, [63]]]],
        [100, 127, 6, [[0, [31, 63, 127]], [50, [95, 63, 127]], [99, [191, 127]]]],
        [1000, 1023, 62, [[0, [31, 63, 127, 255, 511, 1023]], [500, [991, 959, 895, 767, 511, 1023]], [999, [1983, 1919, 1791, 1535, 1023]]]],
        [16384, 16383, 1023, [
            [0, [31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383]],
            [8192, [16415, 16447, 16511, 16639, 16895, 17407, 18431, 20479, 24575, 16383]],
            [16383, [32735, 32703, 32639, 32511, 32255, 31743, 30719, 28671, 24575, 16383]],
        ]],
    ]).it("N=%s", ([numLeaves, rootIndex, keyedCount, paths]) => {
        assert.strictEqual(TreeMath.root(numLeaves), rootIndex);
        let count = 0;
        for (let nodeIndex = 0; nodeIndex < TreeMath.nodeCount(numLeaves); nodeIndex++) {
            if (TreeMath.isKeyed(nodeIndex, numLeaves)) {
                count++;
            }
        }
        assert.strictEqual(count, keyedCount, "keyed nodes");
        for (const [position, expected] of paths) {
            assert.deepStrictEqual(TreeMath.keyedPath(position, numLeaves), expected, `keyedPath(${position})`);
        }
    });
    
    it("N=64: exactly the level-5 and level-6 nodes are keyed — 31, 95 and the root 63", () => {
        // 31 = 0b011111 and 95 = 0b1011111 have five trailing ones (level 5), 63 = 0b111111 has six and is the
        // root. Every other internal node sits at level 1..4, inside a bucket of 16 seats.
        const keyed = [...Array(TreeMath.nodeCount(64)).keys()].filter(nodeIndex => TreeMath.isKeyed(nodeIndex, 64));
        assert.deepStrictEqual(keyed, [31, 63, 95]);
        assert.deepStrictEqual(TreeMath.keyedPath(0, 64), [31, 63]);
        assert.deepStrictEqual(TreeMath.keyedPath(63, 64), [95, 63]);
    });
    
    it("the root is keyed whatever its level, and only while it is the root", () => {
        assert.strictEqual(TreeMath.isKeyed(3, 3), true, "root of N=3, level 2");
        assert.strictEqual(TreeMath.isKeyed(3, 5), false, "the same node once N=5 moved the root to 7");
        assert.strictEqual(TreeMath.isKeyed(7, 5), true);
        assert.strictEqual(TreeMath.isKeyed(15, 16), true, "root of a full bucket");
        assert.strictEqual(TreeMath.isKeyed(15, 17), false, "a level-4 node under a level-5 root");
    });
    
    it("leaves, nodes outside the tree and bucket nodes are never keyed", () => {
        assert.strictEqual(TreeMath.isKeyed(0, 1), false, "a one-leaf tree's root is a leaf");
        assert.strictEqual(TreeMath.isKeyed(4, 64), false, "a leaf");
        assert.strictEqual(TreeMath.isKeyed(1, 64), false, "level 1");
        assert.strictEqual(TreeMath.isKeyed(31, 16), false, "outside a 16-leaf tree");
        assert.strictEqual(TreeMath.isKeyed(159, 81), true, "level 5, in range");
        assert.strictEqual(TreeMath.isKeyed(159, 80), false, "level 5, past the truncated right edge");
    });
    
    it("keyedPath is directPath filtered by isKeyed, ends at the root, and is empty only for one leaf", () => {
        for (const numLeaves of [1, 2, 5, 16, 17, 33, 47, 64, 65, 129, 300]) {
            for (let position = 0; position < numLeaves; position++) {
                const keyed = TreeMath.keyedPath(position, numLeaves);
                const expected = TreeMath.directPath(position, numLeaves)
                    .filter(nodeIndex => TreeMath.level(nodeIndex) > TreeMath.BUCKET_LEVEL || nodeIndex === TreeMath.root(numLeaves));
                assert.deepStrictEqual(keyed, expected, `N=${numLeaves} p=${position}`);
                if (numLeaves === 1) {
                    assert.deepStrictEqual(keyed, []);
                }
                else {
                    assert.strictEqual(keyed[keyed.length - 1], TreeMath.root(numLeaves), `N=${numLeaves} p=${position}`);
                }
            }
        }
    });
    
    it("truncated right edges: a lone last seat climbs straight to the root", () => {
        // N=17: seat 16 is leaf 32, whose parents 33..47 do not exist; its parent is the root 31.
        assert.deepStrictEqual(TreeMath.directPath(16, 17), [31]);
        // N=33: seat 32 (leaf 64) hangs directly off the root 63 — level-5 node 95 does not exist yet.
        assert.deepStrictEqual(TreeMath.directPath(32, 33), [63]);
        assert.deepStrictEqual(TreeMath.keyedPath(32, 33), [63]);
        // N=49: node 95 exists from here on (2·49 - 1 = 97 nodes), so seat 48 (leaf 96) climbs through it even
        // though 95's own right subtree is a single leaf.
        assert.deepStrictEqual(TreeMath.keyedPath(48, 49), [95, 63]);
    });
    
    it("version constants", () => {
        assert.strictEqual(TreeMath.TREE_VERSION, 3);
        assert.strictEqual(TreeMath.BUCKET_LEVEL, 4);
    });
});
