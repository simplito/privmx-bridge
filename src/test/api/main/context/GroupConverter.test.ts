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
import { GroupConverter } from "../../../../api/main/context/GroupConverter";
import { buildTree, planCommit } from "../../../testUtils/TreeFixtures";
import { TreeHash } from "../../../../service/cloud/keytree/TreeHash";
import { TreeMath } from "../../../../service/cloud/keytree/TreeMath";
import * as types from "../../../../types";
import * as db from "../../../../db/Model";

/** What each read path is allowed to serve: `groupGet` the whole group, `groupList` no state at all. */

const groupId = "MyGroupId" as types.group.GroupId;
const contextId = "MyContextId" as types.context.ContextId;
const keyId = "SomeKeyId" as types.core.KeyId;
const data = "SomeGroupData" as types.group.GroupData;
const groupPubKey = "GroupPubKey" as unknown as types.cloud.GroupPubKey;
const janek = "janek" as types.cloud.UserId;
const alice = "alice" as types.cloud.UserId;
const SEATING = ["janek", "alice"];

const tree = buildTree(SEATING, 3);

const group: db.group.Group = {
    id: groupId,
    contextId: contextId,
    groupPubKey: groupPubKey,
    createDate: 100 as types.core.Timestamp,
    creator: janek,
    lastModificationDate: 200 as types.core.Timestamp,
    lastModifier: janek,
    keyId: keyId,
    users: [alice],
    managers: [janek],
    // Deliberately different numbers: the three planes count independently, and a swap between any two of them
    // has to show.
    publicMetaVersion: 7 as types.group.GroupVersion,
    privateMetaVersion: 11 as types.group.GroupVersion,
    rosterVersion: 4,
    keyVersion: 3,
    policy: {},
    numLeaves: tree.numLeaves,
    leafAssignment: tree.leafAssignment,
    eraFloor: 2,
};

const selfKey = {keyId: keyId, data: "self" as types.core.UserKeyData, groupEpoch: 3};
const epochKeys: db.group.GroupEpochKey[] = [
    {id: `${groupId}|2` as db.group.GroupEpochKeyId, groupId, keyVersion: 2, groupPubKey: "Pub2" as unknown as types.cloud.GroupPubKey},
    {id: `${groupId}|3` as db.group.GroupEpochKeyId, groupId, keyVersion: 3, groupPubKey: groupPubKey, groupKey: selfKey},
];

function state(): db.group.GroupState {
    const history: db.group.GroupHistoryEntry[] = [1, 2, 3, 4].map(version => ({
        id: `${groupId}|${version}` as db.group.GroupHistoryEntryId,
        groupId: groupId,
        version: version as types.group.GroupVersion,
        keyId: keyId,
        keyVersion: 3,
        data: data,
        users: [alice],
        managers: [janek],
        groupPubKey: groupPubKey,
        created: 100 as types.core.Timestamp,
        author: janek,
    }));
    // Public at epoch 2 while the group is at 3: an entry stays where it was written, and a rotation since then
    // does not move it. That lag is normal, and the reader descends the Ladder to its key. Private at 3, so the
    // two planes sit at *different* epochs — a state only the split can produce, and one the converter must
    // carry across without crossing them.
    const publicMeta: db.group.GroupPublicMetaEntry = {
        id: `${groupId}|7` as db.group.GroupPublicMetaEntryId,
        groupId: groupId,
        version: 7 as types.group.GroupVersion,
        keyId: keyId,
        keyVersion: 2,
        data: data,
        created: 150 as types.core.Timestamp,
        author: alice,
    };
    const privateMeta: db.group.GroupPrivateMetaEntry = {
        id: `${groupId}|11` as db.group.GroupPrivateMetaEntryId,
        groupId: groupId,
        version: 11 as types.group.GroupVersion,
        keyId: keyId,
        keyVersion: 3,
        data: data,
        created: 160 as types.core.Timestamp,
        author: janek,
    };
    return {tree, history, publicMeta, privateMeta, treeCommit: null, epochKeys};
}

it("convertGroup serves the state it was handed, and each plane's own counter", async () => {
    const converted = new GroupConverter().convertGroup(alice, group, state(), "full");
    // Four roster entries and a roster counter that says four; each metadata counter is its own number.
    assert.strictEqual(converted.rosterVersion, 4);
    assert.strictEqual(converted.publicMetaVersion, 7, "the public-metadata counter, not the roster one");
    assert.strictEqual(converted.privateMetaVersion, 11, "the private-metadata counter, and not the public one");
    assert.strictEqual(converted.publicMeta.version, 7);
    assert.strictEqual(converted.privateMeta.version, 11);
    // The planes legitimately sit at different epochs, and the converter must not cross them.
    assert.strictEqual(converted.publicMeta.keyVersion, 2, "an entry stays at the epoch it was written under");
    assert.strictEqual(converted.privateMeta.keyVersion, 3);
    assert.strictEqual(converted.history.length, 4);
    assert.strictEqual(converted.data.length, 4);
    assert.strictEqual(converted.treeNodes?.length, tree.nodes.length);
    assert.strictEqual(converted.treeEdges?.length, tree.edges.length);
    assert.strictEqual(converted.eraFloor, 2);
    assert.strictEqual(converted.ownLeafPosition, 1);
});

it("keyHistory and groupKeys come from the epoch rows: the past epochs' grant keys, every row's own key", async () => {
    const converted = new GroupConverter().convertGroup(alice, group, state(), "full");
    assert.deepStrictEqual(converted.keyHistory, [{keyVersion: 2, groupPubKey: "Pub2"}], "the current epoch's key is `groupPubKey`, not history");
    assert.deepStrictEqual(converted.groupKeys, [{group: groupId, keys: [selfKey]}]);
    assert.deepStrictEqual(new GroupConverter().convertKeyArchive(group, [], epochKeys).keyHistory, converted.keyHistory);
});

it("the epoch rows found by groupGetEpochKeys come in groupGet's shapes, the current epoch's grant key included", async () => {
    const converted = new GroupConverter().convertEpochKeys(group, epochKeys);
    assert.strictEqual(converted.keyVersion, group.keyVersion);
    assert.deepStrictEqual(converted.groupKeys, [{group: groupId, keys: [selfKey]}]);
    assert.deepStrictEqual(converted.keyHistory, epochKeys.filter(row => row.groupPubKey).map(row => ({keyVersion: row.keyVersion, groupPubKey: row.groupPubKey})));
    assert(converted.keyHistory.some(entry => entry.keyVersion === group.keyVersion), "the current epoch too");
});

it("a listing carries the epoch and the counters, and nothing that grows with membership or history", async () => {
    const summary = new GroupConverter().convertGroupSummary(group) as unknown as Record<string, unknown>;
    // No `publicMeta`/`privateMeta` (two envelopes per group), no roster and no statement (both grow with members).
    assert.deepStrictEqual(Object.keys(summary).sort(), [
        "contextId", "createDate", "creator", "groupPubKey", "id", "keyVersion",
        "lastModificationDate", "lastModifier", "policy", "privateMetaVersion", "publicMetaVersion",
        "rosterVersion", "type",
    ]);
    assert.strictEqual(summary.publicMetaVersion, 7);
    assert.strictEqual(summary.privateMetaVersion, 11);
    assert.strictEqual(summary.rosterVersion, 4);
    assert.strictEqual(summary.keyVersion, 3);
});

/** 64 seats with alice at seat 1, after u40 filled 95: records 31, 63 and 95. */
function wideGroup() {
    const seating = Array.from({length: 64}, (_, i) => ["janek", "alice"][i] ?? `u${i}`);
    const wide = planCommit(buildTree(seating, 3), 3, {kind: "selfUpdate", committer: "u40"}).after;
    const groupWide: db.group.Group = {...group, numLeaves: wide.numLeaves, leafAssignment: wide.leafAssignment};
    return {wide, groupWide};
}

it("the default view serves the caller's climb, not the whole tree", async () => {
    // The records of alice's keyed path, the one wrap addressed to her, the wrap from 31 to 63, and the grant
    // edge. The difference is the point — at 16 384 members the full tree is up to 32 767 edges.
    const {wide, groupWide} = wideGroup();
    const converted = new GroupConverter().convertGroup(alice, groupWide, {...state(), tree: wide});
    
    assert.strictEqual(converted.treeScope, "path");
    assert.strictEqual(converted.ownLeafPosition, 1);
    assert.deepStrictEqual(converted.treeNodes?.map(n => n.nodeIndex), [31, 63]);
    assert.strictEqual(converted.treeEdges?.length, 3);
    assert.strictEqual(converted.treeEdges?.filter(e => e.isGrantEdge).length, 1, "the grant edge is what the climb ends on");
    assert.deepStrictEqual(converted.treeEdges?.find(e => e.childKind === "user"), wide.edges.find(e => e.childUserId === alice));
    assert.ok(converted.treeEdges?.some(e => e.parentIndex === 63 && e.childIndex === 31), "the step from 31 to the root");
});

it("the planning view serves every node record but only the caller's climb", async () => {
    const {wide, groupWide} = wideGroup();
    const converted = new GroupConverter().convertGroup(alice, groupWide, {...state(), tree: wide}, "plan");
    assert.strictEqual(converted.treeScope, "plan");
    assert.deepStrictEqual(converted.treeNodes?.map(n => n.nodeIndex), [31, 63, 95]);
    assert.strictEqual(converted.treeEdges?.length, 3);
});

it("blank records are served without a key, so a client can tell which of its nodes to refill", async () => {
    const {wide, groupWide} = wideGroup();
    const removed = planCommit(wide, 3, {kind: "remove", committer: "janek", removed: ["u41"]}).after;
    const converted = new GroupConverter().convertGroup(alice, {...groupWide, leafAssignment: removed.leafAssignment}, {...state(), tree: removed}, "plan");
    assert.deepStrictEqual(converted.treeNodes?.find(n => n.nodeIndex === 95), {nodeIndex: 95, generation: 1});
});

it("serves the tree version, and labels a group from before it", async () => {
    assert.strictEqual(new GroupConverter().convertGroup(alice, {...group, treeVersion: 2}, state()).treeVersion, 2);
    assert.strictEqual(new GroupConverter().convertGroup(alice, group, state()).treeVersion, 1);
});

it("scope full serves the whole tree, for a client that validates it itself", async () => {
    const seating = ["janek", "alice", "bob", "carol", "dave", "erin", "frank", "grace"];
    const big = buildTree(seating, 3);
    const group8: db.group.Group = {...group, numLeaves: big.numLeaves, leafAssignment: big.leafAssignment};
    const converted = new GroupConverter().convertGroup(alice, group8, {...state(), tree: big}, "full");
    
    assert.strictEqual(converted.treeScope, "full");
    assert.strictEqual(converted.treeNodes?.length, big.nodes.length);
    assert.strictEqual(converted.treeEdges?.length, big.edges.length);
});

it("a caller with no leaf gets the full tree, having no path of their own", async () => {
    const converted = new GroupConverter().convertGroup("outsider" as types.cloud.UserId, group, state());
    assert.strictEqual(converted.treeScope, "full");
    assert.strictEqual(converted.ownLeafPosition, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// history windowing
// ─────────────────────────────────────────────────────────────────────────────

it("serves the whole history, from genesis, when the caller does not say what it has", async () => {
    const converted = new GroupConverter().convertGroup(alice, group, state(), "full");
    assert.strictEqual(converted.history.length, 4);
    assert.strictEqual(converted.history[0].version, 1, "from genesis");
});

it("says where a windowed history starts", async () => {
    // The window is applied by the repository query; the converter passes through what it was handed. Where the
    // window starts is read off the first entry — there is no echoed counter to trust instead.
    const windowed = state();
    windowed.history = windowed.history.filter(entry => entry.version >= 3);
    const converted = new GroupConverter().convertGroup(alice, group, windowed, "full");
    assert.strictEqual(converted.history.length, 2);
    assert.strictEqual(converted.data.length, 2);
    assert.strictEqual(converted.history[0].version, 3);
});

it("converts an empty window to empty arrays rather than failing", async () => {
    const empty = state();
    empty.history = [];
    const converted = new GroupConverter().convertGroup(alice, group, empty, "full");
    assert.deepStrictEqual(converted.history, []);
    assert.deepStrictEqual(converted.data, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// seats the bridge resolves so the caller does not need `leafAssignment`
// ─────────────────────────────────────────────────────────────────────────────

const EIGHT = ["janek", "alice", "bob", "carol", "dave", "erin", "frank", "grace"];

function bigGroup(seating: string[] = EIGHT) {
    const big = buildTree(seating, 3);
    const group8: db.group.Group = {...group, numLeaves: big.numLeaves, leafAssignment: big.leafAssignment};
    return {big, group8};
}

it("forUserIds hands back the seats it resolved, not just the nodes around them", async () => {
    // Planning a removal needs the subject's seat number. The bridge looks it up anyway to decide which nodes to
    // serve, so returning it is what lets a manager skip downloading the roster to find it.
    const {big, group8} = bigGroup();
    const converted = new GroupConverter().convertGroup(
        alice, group8, {...state(), tree: big}, "path", ["frank" as types.cloud.UserId],
    );
    assert.deepStrictEqual(converted.subjectLeafPositions, [6]);
    assert.strictEqual(converted.ownLeafPosition, 1);
});

it("forUserIds naming somebody with no seat omits them rather than reporting seat -1", async () => {
    const {big, group8} = bigGroup();
    const converted = new GroupConverter().convertGroup(
        alice, group8, {...state(), tree: big}, "path", ["outsider" as types.cloud.UserId],
    );
    assert.deepStrictEqual(converted.subjectLeafPositions, []);
});

it("forNewMembers allocates blanks lowest-first before appending", async () => {
    const {big, group8} = bigGroup(["janek", "alice", "", "carol", "", "erin", "frank", "grace"]);
    const converted = new GroupConverter().convertGroup(
        alice, group8, {...state(), tree: big}, "path", undefined, 3,
    );
    // Two blanks get reused before the tree is allowed to grow — otherwise remove/add cycles inflate `numLeaves`
    // without ever growing the roster.
    assert.deepStrictEqual(converted.nextFreeSeats, [2, 4, 8]);
});

it("forNewMembers and forUserIds resolve seats without widening the view", async () => {
    // Planning reads every record from `scope: "plan"`; the seat lists only save the caller reading the roster.
    const {big, group8} = bigGroup(["janek", "alice", "", "carol", "dave", "erin", "frank", ""]);
    const plain = new GroupConverter().convertGroup(alice, group8, {...state(), tree: big});
    const withSeats = new GroupConverter().convertGroup(
        alice, group8, {...state(), tree: big}, "path", ["frank" as types.cloud.UserId], 2,
    );
    assert.deepStrictEqual(withSeats.nextFreeSeats, [2, 7]);
    assert.deepStrictEqual(withSeats.subjectLeafPositions, [6]);
    assert.strictEqual(withSeats.treeScope, "path");
    assert.deepStrictEqual(withSeats.treeNodes, plain.treeNodes);
    assert.deepStrictEqual(withSeats.treeEdges, plain.treeEdges);
});

it("no seats are reported when nobody asked for any", async () => {
    const {big, group8} = bigGroup();
    const converted = new GroupConverter().convertGroup(alice, group8, {...state(), tree: big});
    assert.strictEqual(converted.nextFreeSeats, undefined);
    assert.strictEqual(converted.subjectLeafPositions, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// what lets a client verify what it is served
// ─────────────────────────────────────────────────────────────────────────────

it("a path view carries the copath hashes that, with the caller's own path, rebuild the tree hash", async () => {
    const {wide, groupWide} = wideGroup();
    const converted = new GroupConverter().convertGroup(alice, groupWide, {...state(), tree: wide});
    assert.deepStrictEqual(converted.copathHashes, TreeHash.copathHashes(TreeHash.of(wide), 1).map(hash => hash.toString("hex")));
    assert.strictEqual(converted.copathHashes?.length, TreeMath.copath(1, 64).length, "aligned with the copath");
    // Rebuild the root from alice's leaf upwards, using only what the view serves.
    const served = TreeHash.of({numLeaves: 64, leafAssignment: wide.leafAssignment, nodes: converted.treeNodes});
    let current = TreeMath.leafNode(1);
    let hash = TreeHash.childHash(served, current);
    for (const copathHash of converted.copathHashes!) {
        const parent = TreeMath.parent(current, 64);
        const sibling = Buffer.from(copathHash, "hex");
        const [left] = TreeMath.children(parent, 64);
        // The parent's own fields come from the served record (keyed) or its index alone (unkeyed).
        hash = left === current ? TreeHash.nodeHash(served, parent, hash, sibling) : TreeHash.nodeHash(served, parent, sibling, hash);
        current = parent;
    }
    assert.strictEqual(hash.toString("hex"), TreeHash.childHash(TreeHash.of(wide), TreeMath.root(64)).toString("hex"));
});

it("the hashes behind a path view are computed once per commit, and a commit moves the cache key", async () => {
    const {wide, groupWide} = wideGroup();
    const atSeq2: db.group.Group = {...groupWide, id: "CachedGroupId" as types.group.GroupId, treeCommitSeq: 2};
    const hex = (hashes: Buffer[]) => hashes.map(hash => hash.toString("hex"));
    const before = new GroupConverter().convertGroup(alice, atSeq2, {...state(), tree: wide});
    // u41 sits on alice's copath, so its self-update (seq 3) changes what she must be served.
    const next = planCommit(wide, 3, {kind: "selfUpdate", committer: "u41"}).after;
    // Same key, other tree: what comes back is the cached computation — which is why the key must move per commit.
    assert.deepStrictEqual(new GroupConverter().convertGroup(alice, atSeq2, {...state(), tree: next}).copathHashes, before.copathHashes);
    const after = new GroupConverter().convertGroup(alice, {...atSeq2, treeCommitSeq: 3}, {...state(), tree: next});
    assert.deepStrictEqual(after.copathHashes, hex(TreeHash.copathHashes(TreeHash.of(next), 1)));
    assert.notDeepStrictEqual(after.copathHashes, before.copathHashes);
});

it("the hash cache keeps one entry per group, its latest seq, and only the nodes at bucket level and above", async () => {
    const {wide, groupWide} = wideGroup();
    const cache = (GroupConverter as unknown as {hashCache: Map<types.group.GroupId, {seq: number, hashes: Map<number, Buffer>}>}).hashCache;
    const id = "OneEntryGroupId" as types.group.GroupId;
    const next = planCommit(wide, 3, {kind: "selfUpdate", committer: "u41"}).after;
    new GroupConverter().convertGroup(alice, {...groupWide, id, treeCommitSeq: 2}, {...state(), tree: wide});
    new GroupConverter().convertGroup(alice, {...groupWide, id, treeCommitSeq: 3}, {...state(), tree: next});
    assert.strictEqual(cache.get(id)?.seq, 3, "a newer seq replaces the entry instead of adding one");
    const late = new GroupConverter().convertGroup(alice, {...groupWide, id, treeCommitSeq: 2}, {...state(), tree: wide});
    assert.deepStrictEqual(late.copathHashes, TreeHash.copathHashes(TreeHash.of(wide), 1).map(hash => hash.toString("hex")), "an older read is still answered right");
    assert.strictEqual(cache.get(id)?.seq, 3, "but does not displace the newer entry");
    assert([...cache.get(id)!.hashes.keys()].every(nodeIndex => TreeMath.level(nodeIndex) >= TreeMath.BUCKET_LEVEL));
});

it("the hash cache stays within its entry bound, least recently used out first", async () => {
    const {wide, groupWide} = wideGroup();
    const limits = GroupConverter as unknown as {HASH_CACHE_MAX_GROUPS: number, hashCache: Map<string, unknown>};
    const saved = limits.HASH_CACHE_MAX_GROUPS;
    limits.HASH_CACHE_MAX_GROUPS = 1;
    try {
        new GroupConverter().convertGroup(alice, {...groupWide, id: "BoundA" as types.group.GroupId, treeCommitSeq: 1}, {...state(), tree: wide});
        new GroupConverter().convertGroup(alice, {...groupWide, id: "BoundB" as types.group.GroupId, treeCommitSeq: 1}, {...state(), tree: wide});
        assert.deepStrictEqual([...limits.hashCache.keys()], ["BoundB"]);
    }
    finally {
        limits.HASH_CACHE_MAX_GROUPS = saved;
    }
});

it("plan and full views carry every record instead, and no copath hashes", async () => {
    const {wide, groupWide} = wideGroup();
    for (const scope of ["plan", "full"] as const) {
        assert.strictEqual(new GroupConverter().convertGroup(alice, groupWide, {...state(), tree: wide}, scope).copathHashes, undefined);
    }
});

it("the latest statement is served as is; vouching statements are named by the served records' setBy", async () => {
    const {wide, groupWide} = wideGroup();
    const latest = {seq: 2} as types.cloud.GroupTreeCommitStatement;
    const converted = new GroupConverter().convertGroup(alice, groupWide, {...state(), tree: wide, treeCommit: latest});
    assert.strictEqual(converted.treeCommit, latest);
    assert.deepStrictEqual(converted.treeNodes.map(node => node.setBy), [1, 2], "31 set at creation, 63 by u40's self-update");
    assert.deepStrictEqual(GroupConverter.vouchingSeqs(converted.treeNodes), [1, 2]);
    assert.deepStrictEqual(GroupConverter.vouchingSeqs([...converted.treeNodes, {nodeIndex: 95, generation: 0}]), [1, 2], "a blank record vouches for nothing");
});

