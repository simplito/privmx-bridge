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
import * as types from "../../../../types";
import { HashableTree, TreeHash } from "../../../../service/cloud/keytree/TreeHash";
import { CommitStatement } from "../../../../service/cloud/keytree/CommitStatement";
import { TreeMath } from "../../../../service/cloud/keytree/TreeMath";
import { Crypto } from "../../../../utils/crypto/Crypto";

/**
 * Fixed vectors for the hashes and signed bytes both sides must produce byte for byte (addendum spec §1, §3).
 *
 * The expected values were computed once by an independent Python implementation of the spec (hashlib + struct,
 * its own copy of the tree arithmetic — nothing shared with this code), from exactly the inputs below. The
 * endpoint's tests carry the same vectors; a mismatch on either side means the two no longer agree on what a
 * member signs.
 */

const PK = "5jEVvjETy6R1npnr1m5L8of8hgZfhfTjxMy2qQfgBms6dzyvWT" as types.core.EccPubKey;
const PK2 = "6eLBrPe4EsGegDUr4rMQ4RLqfjj9AhbqmpaGE3XEjesV2XHWcu" as types.core.EccPubKey;

function hashable(numLeaves: number, seats: string[], nodes: [number, {generation: number, publicKey?: types.core.EccPubKey, setBy?: number}][]): HashableTree {
    return {numLeaves, leafAssignment: seats as types.cloud.UserId[], nodes: new Map(nodes)};
}

/** Tree A: three seats, the last blank; the root (3) filled at generation 2, vouched for by statement 7. */
const TREE_A = hashable(3, ["alice", "bob", ""], [[3, {generation: 2, publicKey: PK, setBy: 7}]]);

/** Tree B: forty seats `u0..u39` with seat 7 blank; 31 blank at generation 3; the root 63 filled at generation 5
 *  by statement 9. 95 does not exist at this size. */
const SEATS_B = Array.from({length: 40}, (_, i) => i === 7 ? "" : `u${i}`);
const TREE_B = hashable(40, SEATS_B, [[31, {generation: 3}], [63, {generation: 5, publicKey: PK2, setBy: 9}]]);

/** Users given out of order, with a duplicate, an uppercase name, U+FF5E and U+1F600 — the last two sort
 *  differently by UTF-16 code unit (what `Array.sort` does) and by UTF-8 byte (what the spec says). */
const ROSTER_USERS = ["bob", "alice", "alice", "Zed", "～", "\u{1F600}"];
const ROSTER_MANAGERS = ["carol"];

describe("TreeHash vectors", () => {
    it("leaf hash", () => {
        assert.strictEqual(TreeHash.leafHash(0, "alice").toString("hex"), "954e9620d070401e5f6818d005b7236989c82b8fd0a2ea49cc071d4a523a814c");
    });
    
    it("an unkeyed inner node (tree A, node 1)", () => {
        assert.strictEqual(TreeHash.childHash(TREE_A, 1).toString("hex"), "968db0327b02d59523b4a7d497dbb54ade83df50564cb9a62f866b8407fc0599");
    });
    
    it("tree A: 3 leaves, a blank seat, a filled root", () => {
        assert.strictEqual(TreeHash.treeHash(TREE_A).toString("hex"), "9ccf0a6b8e97cb66f4d6d5e9553f93f4c8361acff447b97e4701b98f1e141b3d");
    });
    
    it("tree B: 40 leaves, buckets, a blank keyed record", () => {
        assert.strictEqual(TreeHash.treeHash(TREE_B).toString("hex"), "74a248e41308dc1cbe7fa69e7c5394f2661cd631631c15a1840e178735189677");
    });
    
    it("tree B without the blank record: no record hashes differently from a blank one", () => {
        const noRecord = hashable(40, SEATS_B, [[63, {generation: 5, publicKey: PK2, setBy: 9}]]);
        assert.strictEqual(TreeHash.treeHash(noRecord).toString("hex"), "98719012e56e394253692b48a0d9a0ee92079169bc66295ed63292ffd9b15bca");
    });
    
    it("a one-leaf tree hashes its only leaf", () => {
        assert.strictEqual(TreeHash.treeHash(hashable(1, ["solo"], [])).toString("hex"), "1d949656bc3010296100448ebfa9a0fb2e07c04bac6b9ca49494d9afe8c04e1e");
    });
    
    it("copath hashes of seat 0 in tree B, aligned with the copath", () => {
        assert.deepStrictEqual(TreeMath.copath(0, 40), [2, 5, 11, 23, 47, 71]);
        assert.deepStrictEqual(TreeHash.copathHashes(TREE_B, 0).map(hash => hash.toString("hex").slice(0, 16)),
            ["24ca24f15dc0a989", "0878718be9d4dc41", "5dc12e942f835c33", "215915cd82af53d9", "fa0967908446409d", "25fbb9fd227ecc67"]);
        assert.deepStrictEqual(TreeHash.copathHashes(TREE_B, 0, TreeHash.childHashes(TREE_B)), TreeHash.copathHashes(TREE_B, 0), "read off the precomputed hashes");
    });
    
    it("roster hash: deduplicated, sorted by UTF-8 bytes", () => {
        assert.strictEqual(TreeHash.rosterHash(ROSTER_USERS, ROSTER_MANAGERS).toString("hex"), "26b780f567966ff49d9686e9dab347410f825ecf6ece2da2940e510da5ece283");
        assert.strictEqual(TreeHash.rosterHash([], []).toString("hex"), "86577670052b783c9e991a4dc28658d185d160762025a563e0e88e6ac02a9618");
        // The order matters in exactly the case the bytewise rule exists for.
        assert.deepStrictEqual(TreeHash.sortedUnique(["\u{1F600}", "～"]), ["～", "\u{1F600}"]);
        assert.deepStrictEqual(["\u{1F600}", "～"].sort(), ["\u{1F600}", "～"], "what Array.sort would have done");
    });
    
    it("every recorded field of a keyed node is in its hash", () => {
        const base = TreeHash.treeHash(TREE_A).toString("hex");
        const variants: HashableTree[] = [
            hashable(3, ["alice", "bob", ""], [[3, {generation: 3, publicKey: PK, setBy: 7}]]),
            hashable(3, ["alice", "bob", ""], [[3, {generation: 2, publicKey: PK2, setBy: 7}]]),
            hashable(3, ["alice", "bob", ""], [[3, {generation: 2, publicKey: PK, setBy: 8}]]),
            hashable(3, ["alice", "bob", ""], [[3, {generation: 2}]]),
            hashable(3, ["alice", "bob", "carol"], [[3, {generation: 2, publicKey: PK, setBy: 7}]]),
        ];
        for (const variant of variants) {
            assert.notStrictEqual(TreeHash.treeHash(variant).toString("hex"), base);
        }
    });
});

/** The statement behind the signed-bytes vector. */
const STATEMENT: Omit<types.cloud.GroupTreeCommitStatement, "signature"> = {
    seq: 7,
    op: "remove",
    groupId: "grp-1",
    treeVersion: 2,
    date: 1760000000000,
    keyVersion: 4,
    groupPubKey: "8Pnx" as types.cloud.GroupPubKey,
    rosterVersion: 9,
    rosterHash: TreeHash.rosterHash(ROSTER_USERS, ROSTER_MANAGERS).toString("hex"),
    treeHash: TreeHash.treeHash(TREE_A).toString("hex"),
    committer: "alice" as types.cloud.UserId,
    committerPubKey: PK,
    committerSeat: 0,
    path: [{nodeIndex: 31, generation: 2, publicKey: PK}, {nodeIndex: 63, generation: 6, publicKey: PK2}],
    addedUsers: [],
    addedManagers: [],
    removed: ["bob", "carl"] as types.cloud.UserId[],
};

describe("CommitStatement signed bytes", () => {
    it("matches the vector byte for byte", () => {
        const bytes = CommitStatement.signedBytes(STATEMENT);
        assert.strictEqual(bytes.length, 356);
        assert.strictEqual(bytes.toString("hex"), [
            "706d782d747265652d636f6d6d697400000000056772702d310000000200000000000000070300000199c82cc000000000000000",
            "00040000000438506e78000000000000000926b780f567966ff49d9686e9dab347410f825ecf6ece2da2940e510da5ece2839ccf",
            "0a6b8e97cb66f4d6d5e9553f93f4c8361acff447b97e4701b98f1e141b3d00000005616c69636500000032356a4556766a455479",
            "3652316e706e72316d354c386f663868675a666866546a784d793271516667426d7336647a797657540000000000000002000000",
            "1f0000000200000032356a4556766a4554793652316e706e72316d354c386f663868675a666866546a784d793271516667426d73",
            "36647a797657540000003f000000060000003236654c4272506534457347656744557234724d5134524c71666a6a39416862716d",
            "706147453358456a65735632584857637500000000000000000000000200000003626f62000000046361726c",
        ].join(""));
        assert.strictEqual(Crypto.sha256(bytes).toString("hex"), "85c2f819829c794b65b144bf4a74250e5e9c9763cca8074091d441ea613d9b28");
    });
    
    it("op codes", () => {
        assert.deepStrictEqual(CommitStatement.OP_CODES, {create: 1, add: 2, remove: 3, selfUpdate: 4, rotate: 5});
    });
});
