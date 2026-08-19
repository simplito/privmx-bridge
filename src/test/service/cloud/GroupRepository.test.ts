/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-empty-function */

import "q2-test";
import * as assert from "assert";
import * as mongodb from "mongodb";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { GroupStateRepository } from "../../../service/cloud/GroupStateRepository";
import { MongoObjectRepository } from "../../../db/mongo/MongoObjectRepository";
import { createFake, createMock, hasNoCalls, hasOneCall, mock } from "../../testUtils/TestUtils";
import { buildTree, treeAfterRemoval } from "../../testUtils/TreeFixtures";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { DateUtils } from "../../../utils/DateUtils";
import { AppException } from "../../../api/AppException";

/**
 * These tests are about *what gets written*, not what is returned: a removal must be a small `$set` plus
 * `O(log n)` documents, appending a version must be an insert, and pruning must not touch the document at all.
 */

const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const keyId = "SomeKeyId" as types.core.KeyId;
const newKeyId = "AnotherKeyId" as types.core.KeyId;
const data = "SomeGroupData" as types.group.GroupData;
const groupPubKey = "GroupPubKey" as unknown as types.cloud.GroupPubKey;
const nextGroupPubKey = "NextGroupPubKey" as unknown as types.cloud.GroupPubKey;

const janek = "janek" as types.cloud.UserId;
const alice = "alice" as types.cloud.UserId;
const bob = "bob" as types.cloud.UserId;
const carol = "carol" as types.cloud.UserId;
const SEATING = ["janek", "alice", "bob", "carol"];
const EPOCH = 5;

interface CapturedUpdate {
    filter: Record<string, unknown>;
    set: Record<string, unknown>;
}

function group(overrides: Partial<db.group.Group> = {}): db.group.Group {
    const tree = buildTree(SEATING, EPOCH);
    return {
        id: groupId,
        contextId: contextId,
        groupPubKey: groupPubKey,
        createDate: DateUtils.now(),
        creator: janek,
        lastModificationDate: DateUtils.now(),
        lastModifier: janek,
        keyId: keyId,
        data: data,
        users: [alice, bob, carol],
        managers: [janek],
        keys: [],
        version: 7 as types.group.GroupVersion,
        policy: {},
        keyVersion: EPOCH,
        keyHistory: [],
        eraFloor: 1,
        numLeaves: tree.numLeaves,
        leafAssignment: tree.leafAssignment,
        ...overrides,
    };
}

function createRepository(options: {casMiss?: boolean} = {}) {
    const updates: CapturedUpdate[] = [];
    const replacements: unknown[] = [];
    const inserted: db.group.Group[] = [];
    const collection = createFake<mongodb.Collection>({
        updateOne: (async (filter: Record<string, unknown>, update: {$set: Record<string, unknown>}) => {
            updates.push({filter, set: update.$set});
            return {matchedCount: options.casMiss ? 0 : 1};
        }) as never,
        // Nothing here may call it — a whole-document replace is the thing this task removed.
        replaceOne: (async (...args: unknown[]) => {
            replacements.push(args);
            return {matchedCount: 1};
        }) as never,
    });
    const objectRepository = createFake<MongoObjectRepository<types.group.GroupId, db.group.Group>>({
        collection: collection,
        getOptions: (() => ({})) as never,
        generateId: (() => "GeneratedGroupId") as never,
        insert: (async (value: db.group.Group) => {
            inserted.push(value);
        }) as never,
        delete: (async () => {}) as never,
    });
    const state = createMock<GroupStateRepository>({});
    mock(state, "insertHistoryEntry", async () => {});
    mock(state, "writeTree", async () => {});
    mock(state, "insertRungs", async () => {});
    mock(state, "deleteRungsTargetingBelow", async () => {});
    mock(state, "deleteState", async () => {});
    const repository = new GroupRepository(objectRepository, state);
    return {repository, state, updates, replacements, inserted};
}

function removal(oldGroup: db.group.Group) {
    const {after} = treeAfterRemoval(SEATING, 2, EPOCH);
    return {
        oldGroup: oldGroup,
        oldTree: buildTree(SEATING, EPOCH),
        modifier: janek,
        removedUser: bob,
        newGroupPubKey: nextGroupPubKey,
        keyId: newKeyId,
        data: data,
        tree: after,
        rungs: [{atKeyVersion: EPOCH + 1, targetKeyVersion: EPOCH, data: "rung" as types.core.UserKeyData}],
    };
}

function historyEntry(state: ReturnType<typeof createRepository>["state"]): db.group.GroupHistoryEntry {
    return (state.insertHistoryEntry as unknown as {mock: {calls: db.group.GroupHistoryEntry[][]}}).mock.calls[0][0];
}

// ─────────────────────────────────────────────────────────────────────────────
// the shape of a write
// ─────────────────────────────────────────────────────────────────────────────

it("a removal updates the fields that changed instead of replacing the document", async () => {
    // A whole-document replace meant rewriting the entire tree to add one edge.
    const {repository, updates, replacements} = createRepository();
    const oldGroup = group();
    await repository.removeMemberWithTree(removal(oldGroup));
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(replacements.length, 0);
    const written = Object.keys(updates[0].set).sort();
    assert.deepStrictEqual(written, [
        "data", "groupPubKey", "keyHistory", "keyId", "keyVersion", "keys",
        "lastModificationDate", "lastModifier", "leafAssignment", "managers", "numLeaves", "users", "version",
    ]);
});

it("a removal keeps the compare-and-swap on the epoch it was computed against", async () => {
    const {repository, updates} = createRepository();
    await repository.removeMemberWithTree(removal(group()));
    assert.deepStrictEqual(updates[0].filter, {_id: groupId, keyVersion: EPOCH});
    assert.strictEqual(updates[0].set.keyVersion, EPOCH + 1);
});

it("a lost race writes nothing at all, in the document or beside it", async () => {
    // Half a transition is worse than none: edges of a tree the document never adopted would be read as real.
    const {repository, state} = createRepository({casMiss: true});
    const result = await repository.removeMemberWithTree(removal(group()));
    assert.strictEqual(result, null);
    hasNoCalls(state.insertHistoryEntry);
    hasNoCalls(state.writeTree);
    hasNoCalls(state.insertRungs);
});

it("the tree is written as a diff against the state it replaces", async () => {
    const {repository, state} = createRepository();
    const params = removal(group());
    await repository.removeMemberWithTree(params);
    hasOneCall(state.writeTree);
    const call = (state.writeTree as unknown as {mock: {calls: unknown[][]}}).mock.calls[0];
    assert.strictEqual(call[0], groupId);
    assert.strictEqual(call[1], params.oldTree);
    assert.strictEqual(call[2], params.tree);
});

// ─────────────────────────────────────────────────────────────────────────────
// version as a counter
// ─────────────────────────────────────────────────────────────────────────────

it("appending a version is one insert, and the number comes from the counter", async () => {
    // Not from an array length: counting the entries would mean reading the whole history to append to it.
    const {repository, state} = createRepository();
    const result = await repository.removeMemberWithTree(removal(group({version: 41 as types.group.GroupVersion})));
    hasOneCall(state.insertHistoryEntry);
    assert.strictEqual(result?.version, 42);
    const entry = historyEntry(state);
    assert.strictEqual(entry.version, 42);
    assert.strictEqual(entry.groupId, groupId);
    assert.strictEqual(entry.id, `${groupId}|42`);
    assert.strictEqual(entry.keyId, newKeyId);
    assert.strictEqual(entry.users.includes(bob), false);
});

it("an addition advances the version without advancing the epoch", async () => {
    // The epoch staying put is what keeps every container the group can read valid.
    const {repository, state, updates} = createRepository();
    const oldGroup = group();
    const result = await repository.addMemberWithTree({
        oldGroup: oldGroup,
        oldTree: buildTree(SEATING, EPOCH),
        modifier: janek,
        addedUser: "dave" as types.cloud.UserId,
        role: "user",
        keyId: keyId,
        data: data,
        tree: buildTree([...SEATING, "dave"], EPOCH),
    });
    assert.strictEqual(result?.version, 8);
    assert.strictEqual(result?.keyVersion, EPOCH);
    assert.strictEqual("keyVersion" in updates[0].set, false);
    assert.strictEqual(historyEntry(state).version, 8);
});

it("a flat update appends a version too, and touches nothing else", async () => {
    const {repository, state, updates, replacements} = createRepository();
    const oldGroup = group({numLeaves: undefined, leafAssignment: undefined});
    const result = await repository.updateGroup(oldGroup, janek, groupPubKey, [janek], [alice], data, keyId, [], undefined, null);
    assert.strictEqual(result.version, 8);
    assert.strictEqual(replacements.length, 0);
    assert.strictEqual("numLeaves" in updates[0].set, false);
    assert.strictEqual("policy" in updates[0].set, false);
    assert.strictEqual(historyEntry(state).version, 8);
});

// ─────────────────────────────────────────────────────────────────────────────
// pruning and cutting an era
// ─────────────────────────────────────────────────────────────────────────────

it("pruning the archive is a range delete and leaves the document's key material alone", async () => {
    const {repository, state, updates} = createRepository();
    const result = await repository.pruneArchive(group({archivePrunedBelow: 2}), 4);
    assert.deepStrictEqual(Object.keys(updates[0].set).sort(), ["archivePrunedBelow", "lastModificationDate"]);
    assert.strictEqual(result?.archivePrunedBelow, 4);
    hasOneCall(state.deleteRungsTargetingBelow);
    const call = (state.deleteRungsTargetingBelow as unknown as {mock: {calls: unknown[][]}}).mock.calls[0];
    assert.deepStrictEqual([...call], [groupId, 4]);
});

it("pruning never lowers the watermark it already recorded", async () => {
    const {repository, updates} = createRepository();
    await repository.pruneArchive(group({archivePrunedBelow: 9}), 4);
    assert.strictEqual(updates[0].set.archivePrunedBelow, 9);
});

it("pruning the archive keeps the epoch registry, because an old key held locally still has to verify", async () => {
    const keyHistory: types.cloud.GroupPubKeyAtEpoch[] = [1, 2, 3].map(keyVersion => ({
        keyVersion: keyVersion,
        groupPubKey: `pub-${keyVersion}` as unknown as types.cloud.GroupPubKey,
    }));
    const {repository, updates} = createRepository();
    await repository.pruneArchive(group({keyHistory}), 3);
    assert.strictEqual("keyHistory" in updates[0].set, false);
});

it("cutting an era records the floor and touches no key material", async () => {
    // Entries below the floor are unreachable, but dropping them is a decision about key material and belongs to
    // BR-14, not to a change of where state is stored.
    const groupKeys: types.cloud.GroupKeysEntry[] = [
        {group: groupId, keys: [{keyId: keyId, data: "old" as types.core.UserKeyData, groupEpoch: 2}]},
    ];
    const keyHistory: types.cloud.GroupPubKeyAtEpoch[] = [1, 2, 3].map(keyVersion => ({
        keyVersion: keyVersion,
        groupPubKey: `pub-${keyVersion}` as unknown as types.cloud.GroupPubKey,
    }));
    const {repository, state, updates} = createRepository();
    await repository.cutEra(group({groupKeys, keyHistory}), 4);
    assert.deepStrictEqual(Object.keys(updates[0].set).sort(), ["eraFloor", "lastModificationDate"]);
    hasOneCall(state.deleteRungsTargetingBelow);
});

// ─────────────────────────────────────────────────────────────────────────────
// creation and deletion
// ─────────────────────────────────────────────────────────────────────────────

it("a new tree-backed group keeps its seating and writes the rest beside the document", async () => {
    const {repository, state, inserted} = createRepository();
    const tree = buildTree(SEATING, 1);
    const created = await repository.createGroup(contextId, null, undefined, groupPubKey, janek, [janek], [alice, bob, carol], data, keyId, [], {}, tree);
    assert.strictEqual(created.version, 1);
    assert.strictEqual(created.keyVersion, 1);
    assert.strictEqual(created.eraFloor, 1);
    assert.strictEqual(inserted[0].numLeaves, tree.numLeaves);
    assert.deepStrictEqual(inserted[0].leafAssignment, tree.leafAssignment);
    // Neither the nodes nor the edges nor the genesis entry are part of the document.
    assert.strictEqual("tree" in inserted[0], false);
    assert.strictEqual("history" in inserted[0], false);
    hasOneCall(state.writeTree);
    assert.strictEqual(historyEntry(state).version, 1);
});

it("a flat group writes no tree at all", async () => {
    const {repository, state} = createRepository();
    await repository.createGroup(contextId, null, undefined, groupPubKey, janek, [janek], [alice], data, keyId, [], {});
    hasNoCalls(state.writeTree);
    hasOneCall(state.insertHistoryEntry);
});

it("deleting a group takes its state with it", async () => {
    // Keyed by groupId, so leaving them behind leaks the group's shape and never reclaims the space.
    const {repository, state} = createRepository();
    await repository.deleteGroup(groupId);
    hasOneCall(state.deleteState);
});

// ─────────────────────────────────────────────────────────────────────────────
// the one field that could still grow per member
// ─────────────────────────────────────────────────────────────────────────────

it("SECURITY: a tree-backed group refuses to accumulate one wrap per member per epoch", async () => {
    // Per-member entries at every keyId would put `members × epochs` back on the document.
    const {repository} = createRepository();
    const perMemberPerEpoch: types.cloud.UserKeysEntry[] = [alice, bob, carol, janek].map(user => ({
        user: user,
        keys: [
            {keyId: keyId, data: "epoch-5" as types.core.UserKeyData},
            {keyId: newKeyId, data: "epoch-6" as types.core.UserKeyData},
        ],
    }));
    try {
        await repository.removeMemberWithTree({...removal(group()), keys: perMemberPerEpoch});
    }
    catch (e) {
        expect(AppException.is(e, "INVALID_PARAMS")).toBe(true);
        return;
    }
    throw new Error("expected INVALID_PARAMS");
});

it("a tree-backed group still accepts one entry per member, which is what a migrating group carries", async () => {
    const {repository} = createRepository();
    const oneEach: types.cloud.UserKeysEntry[] = [alice, carol, janek].map(user => ({
        user: user,
        keys: [{keyId: newKeyId, data: "blob" as types.core.UserKeyData}],
    }));
    const result = await repository.removeMemberWithTree({...removal(group()), keys: oneEach});
    assert.strictEqual(result?.keys.length, 3);
});

/**
 * `getMemberGroupsMap` replaced `getMembersOfGroups`, which read the same documents and then threw the
 * grouping away. Both halves of its result now have a consumer: the keys are the notification recipient list, and
 * the values narrow each recipient's `groupKeys` — so the fan-out matches what `threadGet` serves without a
 * second lookup.
 */
function createMembershipRepository(groups: db.group.Group[]) {
    const queried: types.group.GroupId[][] = [];
    const objectRepository = createFake<MongoObjectRepository<types.group.GroupId, db.group.Group>>({
        getMulti: (async (ids: types.group.GroupId[]) => {
            queried.push(ids);
            return groups.filter(g => ids.includes(g.id));
        }) as never,
    });
    const repository = new GroupRepository(objectRepository, createMock<GroupStateRepository>({}));
    return {repository, queried};
}

const engineeringId = "engineering" as types.group.GroupId;
const legalId = "legal" as types.group.GroupId;

/** alice sits in both groups, bob only in engineering, carol only in legal, janek manages engineering. */
const TWO_GROUPS = [
    group({id: engineeringId, users: [alice, bob], managers: [janek]}),
    group({id: legalId, users: [alice, carol], managers: []}),
];

it("getMemberGroupsMap reports each member's own groups out of one query", async () => {
    const {repository, queried} = createMembershipRepository(TWO_GROUPS);
    const membership = await repository.getMemberGroupsMap([engineeringId, legalId]);
    assert.deepStrictEqual(queried, [[engineeringId, legalId]], "one lookup, not one per member");
    assert.deepStrictEqual(membership.get(alice), [engineeringId, legalId]);
    assert.deepStrictEqual(membership.get(bob), [engineeringId]);
    assert.deepStrictEqual(membership.get(carol), [legalId]);
    assert.deepStrictEqual(membership.get(janek), [engineeringId], "a manager belongs to the group too");
});

it("getMemberGroupsMap keys are the recipient list the fan-out sends to", async () => {
    const {repository} = createMembershipRepository(TWO_GROUPS);
    const membership = await repository.getMemberGroupsMap([engineeringId, legalId]);
    assert.deepStrictEqual([...membership.keys()].sort(), [alice, bob, carol, janek].sort());
});

it("getMemberGroupsMap does not list a group twice for someone who is both member and manager of it", async () => {
    const {repository} = createMembershipRepository([group({id: engineeringId, users: [alice], managers: [alice]})]);
    const membership = await repository.getMemberGroupsMap([engineeringId]);
    assert.deepStrictEqual(membership.get(alice), [engineeringId]);
});

it("getMemberGroupsMap agrees with the per-caller lookup the request path uses", async () => {
    // `getGroupsOfUser` matches on `users` OR `managers` within a context; the map has to draw the same line, or
    // a notification would narrow a payload differently from the `threadGet` for the same container.
    const {repository} = createMembershipRepository(TWO_GROUPS);
    const granted = [engineeringId, legalId];
    const membership = await repository.getMemberGroupsMap(granted);
    for (const user of [alice, bob, carol, janek]) {
        const viaQuery = TWO_GROUPS
            .filter(g => granted.includes(g.id) && (g.users.includes(user) || g.managers.includes(user)))
            .map(g => g.id);
        assert.deepStrictEqual(membership.get(user) ?? [], viaQuery, `membership of ${user} must match`);
    }
});

it("getMemberGroupsMap on a container with no group grants asks nothing", async () => {
    const {repository, queried} = createMembershipRepository(TWO_GROUPS);
    const membership = await repository.getMemberGroupsMap([]);
    assert.strictEqual(membership.size, 0);
    assert.deepStrictEqual(queried, [], "no grants, no lookup");
});
