/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * `staleGroups`: which of a container's grantee groups have rotated past the epoch its current key was wrapped
 * to. What must hold, none of it visible at runtime if it regresses:
 *
 * 1. the field says exactly what the write-side check says (`ContainerGroupEpochs.test.ts` owns the other half),
 *    or a client is told a container is fine and then refused when it writes;
 * 2. it is identical across the five container types;
 * 3. it is **not** narrowed to the caller's own groups — the manager who has to re-key is often in none of them.
 */

import "q2-test";
import * as assert from "assert";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { staleGroupsOf } from "../../../api/main/GroupKeys";
import { ThreadConverter } from "../../../api/main/thread/ThreadConverter";
import { StoreConverter } from "../../../api/main/store/StoreConverter";
import { InboxConverter } from "../../../api/main/inbox/InboxConverter";
import { KvdbConverter } from "../../../api/main/kvdb/KvdbConverter";
import { StreamConverter } from "../../../api/main/stream/StreamConverter";

const contextId = "MyContextId" as types.context.ContextId;
const keyId = "SomeKeyId" as types.core.KeyId;
const olderKeyId = "OlderKeyId" as types.core.KeyId;
const alice = "alice" as types.cloud.UserId;
const janek = "janek" as types.cloud.UserId;

const engineering = "engineering" as types.group.GroupId;
const legal = "legal" as types.group.GroupId;

const GRANTS: types.cloud.GroupGrant[] = [
    {groupId: engineering, role: "manager"},
    {groupId: legal, role: "user"},
];

/** engineering has churned twice since the container last wrapped to it; legal is up to date. */
const EPOCHS = new Map<types.group.GroupId, number>([[engineering, 3], [legal, 4]]);

/** The container's current key wrapped to both grants — engineering at an epoch it has since left behind. */
const GROUP_KEYS: types.cloud.GroupKeysEntry[] = [
    {group: engineering, keys: [{keyId: keyId, data: "eng" as types.core.UserKeyData, groupEpoch: 1}]},
    {group: legal, keys: [{keyId: keyId, data: "legal" as types.core.UserKeyData, groupEpoch: 4}]},
];

function wrap(group: types.group.GroupId, keys: {keyId: types.core.KeyId, groupEpoch?: number}[]): types.cloud.GroupKeysEntry {
    return {
        group: group,
        keys: keys.map(k => ({
            keyId: k.keyId,
            data: "blob" as types.core.UserKeyData,
            ...(k.groupEpoch === undefined ? {} : {groupEpoch: k.groupEpoch}),
        })),
    };
}

/** The fields every container converter reads, shaped so one literal serves all five. */
function containerFields(groups: types.cloud.GroupGrant[]|undefined, groupKeys: types.cloud.GroupKeysEntry[]) {
    return {
        id: "MyContainerId",
        contextId: contextId,
        createDate: 100 as types.core.Timestamp,
        creator: janek,
        lastModificationDate: 200 as types.core.Timestamp,
        lastModifier: janek,
        keyId: keyId,
        users: [alice],
        managers: [janek],
        keys: [{user: alice, keys: [{keyId: keyId, data: "alice-blob" as types.core.UserKeyData}]}],
        groups: groups,
        groupKeys: groupKeys,
        history: [{keyId: keyId, data: "d", users: [alice], managers: [janek], created: 100, author: janek}],
        policy: {},
        // Per-module state fields; a converter that does not read one simply ignores it.
        lastMsgDate: 200 as types.core.Timestamp,
        messages: 0,
        lastFileDate: 200 as types.core.Timestamp,
        files: 0,
        lastEntryDate: 200 as types.core.Timestamp,
        entries: 0,
        state: "active",
        clientResourceId: undefined,
    };
}

type Convert = (
    groups: types.cloud.GroupGrant[]|undefined,
    groupKeys: types.cloud.GroupKeysEntry[],
    ownGroupIds: types.group.GroupId[],
) => {staleGroups: types.group.GroupId[], groupKeys: types.cloud.GroupKeysEntry[]};

/** One entry per container type, so a module that forgets to wire the epochs through fails here. */
const CONVERTERS: {name: string, convert: Convert}[] = [
    {
        name: "thread",
        convert: (groups, groupKeys, ids) => new ThreadConverter().convertThread(alice, containerFields(groups, groupKeys) as unknown as db.thread.Thread, ids, EPOCHS),
    },
    {
        name: "store",
        convert: (groups, groupKeys, ids) => new StoreConverter().convertStore(alice, containerFields(groups, groupKeys) as unknown as db.store.Store, ids, EPOCHS),
    },
    {
        name: "inbox",
        convert: (groups, groupKeys, ids) => new InboxConverter().convertInbox(alice, containerFields(groups, groupKeys) as unknown as db.inbox.Inbox, ids, EPOCHS),
    },
    {
        name: "kvdb",
        convert: (groups, groupKeys, ids) => new KvdbConverter().convertKvdb(alice, containerFields(groups, groupKeys) as unknown as db.kvdb.Kvdb, ids, EPOCHS),
    },
    {
        name: "stream room",
        convert: (groups, groupKeys, ids) => new StreamConverter().convertStreamRoom(alice, containerFields(groups, groupKeys) as unknown as db.stream.StreamRoom, ids, EPOCHS),
    },
];

it("names the group whose epoch has moved past the wrap of the current key", async () => {
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: GROUP_KEYS}, EPOCHS), [engineering]);
});

it("says nothing about a container that has re-keyed, old entries and all", async () => {
    // The entry at `olderKeyId` stays by design — it opens what was written before the re-key — and it is behind
    // by definition. Reporting it would leave a correctly re-keyed container stale forever.
    const reKeyed = [wrap(engineering, [{keyId: olderKeyId, groupEpoch: 1}, {keyId: keyId, groupEpoch: 3}])];
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: reKeyed}, EPOCHS), []);
});

it("reports a re-key that only appears to catch up", async () => {
    // A new keyId wrapped to the old epoch: a removed member holds that epoch and would read on.
    const halfDone = [wrap(engineering, [{keyId: olderKeyId, groupEpoch: 1}, {keyId: keyId, groupEpoch: 1}])];
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: halfDone}, EPOCHS), [engineering]);
});

it("treats a Phase-1 entry with no epoch tag as behind any rotation", async () => {
    const untagged = [wrap(engineering, [{keyId: keyId}])];
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: untagged}, EPOCHS), [engineering]);
});

it("says nothing about a group that has not rotated", async () => {
    const fresh = [wrap(legal, [{keyId: keyId, groupEpoch: 4}])];
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: fresh}, EPOCHS), []);
});

it("says nothing about a grant the current key is not wrapped to", async () => {
    // Unwrapped, not stale: a revoked grant keeps its old blobs and nobody reads current content through it.
    const revoked = [wrap(engineering, [{keyId: olderKeyId, groupEpoch: 1}])];
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: revoked}, EPOCHS), []);
});

it("says nothing about a container with no group grants", async () => {
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId}, EPOCHS), []);
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: []}, EPOCHS), []);
});

it("says nothing about a group it cannot resolve, whatever the entry claims", async () => {
    // Absent from the epoch map. That happens for a revoked grant whose `groupKeys` entry is kept on purpose, so
    // it cannot be read as "behind" — there is no epoch to be behind of. A grant that is still *current* and
    // still unresolvable is a different case, and `checkGroupEpochs` refuses the write outright rather than
    // guessing an epoch here.
    const gone = "sales" as types.group.GroupId;
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: [wrap(gone, [{keyId: keyId, groupEpoch: 1}])]}, EPOCHS), []);
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: [wrap(gone, [{keyId: keyId}])]}, EPOCHS), []);
});

it("lists every stale grant, not just the first", async () => {
    const bothBehind = [wrap(engineering, [{keyId: keyId, groupEpoch: 1}]), wrap(legal, [{keyId: keyId, groupEpoch: 2}])];
    assert.deepStrictEqual(staleGroupsOf({keyId: keyId, groupKeys: bothBehind}, EPOCHS), [engineering, legal]);
});

for (const {name, convert} of CONVERTERS) {
    it(`${name}: serves the stale grant`, async () => {
        assert.deepStrictEqual(convert(GRANTS, GROUP_KEYS, [legal]).staleGroups, [engineering]);
    });
    
    it(`${name}: serves the whole list, not the caller's own groups`, async () => {
        // The caller here belongs to `legal` only, so its `groupKeys` is narrowed to that one entry — while
        // `staleGroups` still names `engineering`. A container manager re-keys grants it is not a member of, and
        // narrowing this field would hide exactly the work it has to do.
        const converted = convert(GRANTS, GROUP_KEYS, [legal]);
        assert.deepStrictEqual(converted.groupKeys.map(entry => entry.group), [legal], "keys are narrowed");
        assert.deepStrictEqual(converted.staleGroups, [engineering], "staleness is not");
    });
    
    it(`${name}: a caller in none of the granted groups still learns what is stale`, async () => {
        assert.deepStrictEqual(convert(GRANTS, GROUP_KEYS, []).staleGroups, [engineering]);
    });
    
    it(`${name}: an up-to-date container serves an empty list`, async () => {
        const upToDate = [wrap(engineering, [{keyId: keyId, groupEpoch: 3}]), wrap(legal, [{keyId: keyId, groupEpoch: 4}])];
        assert.deepStrictEqual(convert(GRANTS, upToDate, [legal]).staleGroups, []);
    });
    
    it(`${name}: a container with no group grants serves an empty list`, async () => {
        assert.deepStrictEqual(convert(undefined, [], [legal]).staleGroups, []);
    });
}
