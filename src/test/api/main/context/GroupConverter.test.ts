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
import { buildTree } from "../../../testUtils/TreeFixtures";
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
    data: data,
    users: [alice],
    managers: [janek],
    version: 4 as types.group.GroupVersion,
    keyVersion: 3,
    keyHistory: [],
    policy: {},
    numLeaves: tree.numLeaves,
    leafAssignment: tree.leafAssignment,
    eraFloor: 2,
    groupKeys: [{group: groupId, keys: [{keyId: keyId, data: "self" as types.core.UserKeyData, groupEpoch: 3}]}],
};

function state(): db.group.GroupState {
    const history: db.group.GroupHistoryEntry[] = [1, 2, 3, 4].map(version => ({
        id: `${groupId}|${version}` as db.group.GroupHistoryEntryId,
        groupId: groupId,
        version: version as types.group.GroupVersion,
        keyId: keyId,
        data: data,
        users: [alice],
        managers: [janek],
        groupPubKey: groupPubKey,
        created: 100 as types.core.Timestamp,
        author: janek,
    }));
    return {tree, history};
}

it("convertGroup serves the state it was handed, and the version from the counter", async () => {
    const converted = new GroupConverter().convertGroup(alice, group, state(), "full");
    // Four entries in the collection, and a counter that says four.
    assert.strictEqual(converted.version, 4);
    assert.strictEqual(converted.history.length, 4);
    assert.strictEqual(converted.data.length, 4);
    assert.strictEqual(converted.treeNodes?.length, tree.nodes.length);
    assert.strictEqual(converted.treeEdges?.length, tree.edges.length);
    assert.strictEqual(converted.eraFloor, 2);
    assert.strictEqual(converted.ownLeafPosition, 1);
});

it("a listing carries the roster and the epoch, and nothing that grows with history", async () => {
    const summary = new GroupConverter().convertGroupSummary(group) as unknown as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(summary).sort(), [
        "contextId", "createDate", "creator", "groupPubKey", "id", "keyVersion",
        "lastModificationDate", "lastModifier", "managers", "policy", "type", "users", "version",
    ]);
    assert.strictEqual(summary.version, 4);
    assert.strictEqual(summary.keyVersion, 3);
});

it("the default view serves the caller's climb, not the whole tree", async () => {
    // Eight seats: one edge per level plus the grant edge, and public keys for the path and the copath. The
    // difference is the point — at 16 384 members the full tree is 32 767 edges.
    const seating = ["janek", "alice", "bob", "carol", "dave", "erin", "frank", "grace"];
    const big = buildTree(seating, 3);
    const group8: db.group.Group = {...group, numLeaves: big.numLeaves, leafAssignment: big.leafAssignment};
    const converted = new GroupConverter().convertGroup(alice, group8, {tree: big, history: state().history});
    
    assert.strictEqual(converted.treeScope, "path");
    assert.strictEqual(converted.ownLeafPosition, 1);
    // alice sits at seat 1: three nodes on her path, and two of her three copath entries are internal nodes.
    // The third is her leaf sibling, whose key comes from the roster — a leaf carries no node keypair at all.
    assert.strictEqual(converted.treeNodes?.length, 5);
    assert.ok((converted.treeEdges?.length ?? 0) < big.edges.length, "the view must be smaller than the tree");
    assert.strictEqual(converted.treeEdges?.filter(e => e.isGrantEdge).length, 1, "the grant edge is what the climb ends on");
    assert.strictEqual(
        converted.treeEdges?.filter(e => e.childKind === "user").length, 1,
        "exactly one leaf edge: the caller's own",
    );
    assert.strictEqual(converted.treeEdges?.find(e => e.childKind === "user")?.childUserId, alice);
});

it("scope full serves the whole tree, for a client that validates it itself", async () => {
    const seating = ["janek", "alice", "bob", "carol", "dave", "erin", "frank", "grace"];
    const big = buildTree(seating, 3);
    const group8: db.group.Group = {...group, numLeaves: big.numLeaves, leafAssignment: big.leafAssignment};
    const converted = new GroupConverter().convertGroup(alice, group8, {tree: big, history: state().history}, "full");
    
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
// history windowing (BR-09)
// ─────────────────────────────────────────────────────────────────────────────

it("serves the whole history, from genesis, when the caller does not say what it has", async () => {
    const converted = new GroupConverter().convertGroup(alice, group, state(), "full");
    assert.strictEqual(converted.history.length, 4);
    assert.strictEqual(converted.firstServedVersion, 1, "from genesis");
});

it("says where a windowed history starts", async () => {
    // The window is applied by the repository query; the converter reports what it was handed, so a client can
    // tell a window from a full history without repeating the server's arithmetic.
    const windowed = state();
    windowed.history = windowed.history.filter(entry => entry.version >= 3);
    const converted = new GroupConverter().convertGroup(alice, group, windowed, "full");
    assert.strictEqual(converted.history.length, 2);
    assert.strictEqual(converted.data.length, 2);
    assert.strictEqual(converted.firstServedVersion, 3);
});

it("reports the current version when the window turns out empty", async () => {
    // A client asking from above the head has nothing to verify, and has to be able to see that rather than
    // read an empty array as "this group has no history".
    const empty = state();
    empty.history = [];
    const converted = new GroupConverter().convertGroup(alice, group, empty, "full");
    assert.deepStrictEqual(converted.history, []);
    assert.strictEqual(converted.firstServedVersion, group.version);
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
        alice, group8, {tree: big, history: state().history}, "path", ["frank" as types.cloud.UserId],
    );
    assert.deepStrictEqual(converted.subjectLeafPositions, [6]);
    assert.strictEqual(converted.ownLeafPosition, 1);
});

it("forUserIds naming somebody with no seat omits them rather than reporting seat -1", async () => {
    const {big, group8} = bigGroup();
    const converted = new GroupConverter().convertGroup(
        alice, group8, {tree: big, history: state().history}, "path", ["outsider" as types.cloud.UserId],
    );
    assert.deepStrictEqual(converted.subjectLeafPositions, []);
});

it("forNewMembers allocates blanks lowest-first before appending", async () => {
    const {big, group8} = bigGroup(["janek", "alice", "", "carol", "", "erin", "frank", "grace"]);
    const converted = new GroupConverter().convertGroup(
        alice, group8, {tree: big, history: state().history}, "path", undefined, 3,
    );
    // Two blanks get reused before the tree is allowed to grow — otherwise remove/add cycles inflate `numLeaves`
    // without ever growing the roster.
    assert.deepStrictEqual(converted.nextFreeSeats, [2, 4, 8]);
});

it("forNewMembers serves the nodes an addition to those seats needs", async () => {
    const {big, group8} = bigGroup(["janek", "alice", "", "carol", "dave", "erin", "frank", ""]);
    const plain = new GroupConverter().convertGroup(alice, group8, {tree: big, history: state().history});
    const withSeats = new GroupConverter().convertGroup(
        alice, group8, {tree: big, history: state().history}, "path", undefined, 2,
    );
    assert.deepStrictEqual(withSeats.nextFreeSeats, [2, 7]);
    // Still a path view, just a wider one: the caller's climb plus what seating those two needs.
    assert.strictEqual(withSeats.treeScope, "path");
    assert.ok(
        (withSeats.treeNodes?.length ?? 0) > (plain.treeNodes?.length ?? 0),
        "asking for seats must serve the nodes those seats are planned against",
    );
    // No assertion that the window beats the whole tree here: at eight seats two paths plus their copaths cover
    // nearly all of it. The saving is asymptotic, and `treeScope` staying "path" is what this fixture can show.
});

it("no seats are reported when nobody asked for any", async () => {
    const {big, group8} = bigGroup();
    const converted = new GroupConverter().convertGroup(alice, group8, {tree: big, history: state().history});
    assert.strictEqual(converted.nextFreeSeats, undefined);
    assert.strictEqual(converted.subjectLeafPositions, undefined);
});
