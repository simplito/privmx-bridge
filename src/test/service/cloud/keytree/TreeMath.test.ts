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
 * Reference tables are taken from documents/nested_groups/09-hidden-key-tree.md §2 so that a reader can check
 * them by hand. The truncated cases (N not a power of two) are the ones that actually break naive
 * implementations, so they get the most coverage.
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

describe("TreeMath.directPath — the set a removal must refresh", () => {
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
    
    it("contains no leaves — only internal nodes get refreshed", () => {
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

describe("TreeMath.copath — the set a refresh wraps to", () => {
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

describe("TreeMath.leavesUnder", () => {
    it("root covers every leaf", () => {
        for (let numLeaves = 1; numLeaves <= 40; numLeaves++) {
            const leaves = TreeMath.leavesUnder(TreeMath.root(numLeaves), numLeaves);
            assert.deepStrictEqual(leaves, [...Array(numLeaves).keys()], `N=${numLeaves}`);
        }
    });
    
    it("a leaf covers only itself", () => {
        assert.deepStrictEqual(TreeMath.leavesUnder(4, 4), [2]);
    });
    
    it("children partition their parent's leaves", () => {
        for (let numLeaves = 2; numLeaves <= 40; numLeaves++) {
            for (let node = 1; node < TreeMath.nodeCount(numLeaves); node += 2) {
                const [l, r] = TreeMath.children(node, numLeaves);
                assert.deepStrictEqual(
                    TreeMath.leavesUnder(node, numLeaves),
                    [...TreeMath.leavesUnder(l, numLeaves), ...TreeMath.leavesUnder(r, numLeaves)],
                    `N=${numLeaves} node=${node}`,
                );
            }
        }
    });
});

describe("TreeMath — cost properties from the whitepaper", () => {
    /**
     * A removal refreshes `directPath` and wraps to two children per refreshed node, minus the blanked leaf.
     * The whitepaper claims `2·depth - 1` wraps for the tree part; assert it holds for the balanced case.
     */
    each<[number, number]>([
        [8, 5],      // 2*3 - 1
        [16, 7],     // 2*4 - 1
        [1024, 19],  // 2*10 - 1
        [32768, 29], // 2*15 - 1
    ]).it("balanced N=%s costs the documented number of wraps", ([numLeaves, expectedWraps]) => {
        const path = TreeMath.directPath(0, numLeaves);
        assert.strictEqual(path.length, TreeMath.depth(numLeaves));
        const wraps = path.reduce((sum, node, i) => {
            // Bottom node skips the blanked leaf; every other node wraps to both children.
            return sum + (i === 0 ? TreeMath.children(node, numLeaves).length - 1 : 2);
        }, 0);
        assert.strictEqual(wraps, expectedWraps);
    });
    
    it("N=32768 removal touches 15 nodes, not 32768", () => {
        assert.strictEqual(TreeMath.directPath(0, 32768).length, 15);
    });
    
    it("growth changes the root exactly at powers of two", () => {
        assert.strictEqual(TreeMath.growthChangesRoot(4, 4), true, "seating a 5th member grows the tree");
        assert.strictEqual(TreeMath.growthChangesRoot(2, 4), false, "filling a blank does not");
        assert.strictEqual(TreeMath.growthChangesRoot(4, 8), false, "room already exists");
        assert.strictEqual(TreeMath.numLeavesToSeat(4, 4), 5);
        assert.strictEqual(TreeMath.numLeavesToSeat(1, 4), 4);
    });
});
