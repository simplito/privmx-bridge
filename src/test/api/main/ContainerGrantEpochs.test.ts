/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * `groups[].groupEpoch`: the epoch each grant's wrap of the container's **current** key was made at, served with
 * the container.
 *
 * It is what lets a client decide whether a container needs re-keying without asking the bridge — it already
 * knows the groups' current epochs from `groupList` or a `groupUpdated` event — so a container read costs the
 * server no group lookup. The field replaced a server-computed `staleGroups`, which cost one projected query per
 * read, on traffic dominated by reads.
 *
 * Three things must hold and none of them is visible at runtime if it regresses:
 *
 * 1. the epoch reported is the one of the wrap at the container's **current** `keyId`, and no other — an older
 *    wrap is behind by definition, so reporting it would mark every re-keyed container as needing a re-key;
 * 2. absent and `0` mean different things: `0` is a wrap that declared no epoch (Phase-1, behind any rotation),
 *    absent is no wrap at the current key at all (nothing is read through that group, nothing to re-key);
 * 3. the field is **not** narrowed to the caller's own groups, unlike `groupKeys` — the manager who has to
 *    re-key is often a member of none of the granted groups.
 *
 * The write-side counterpart, and the proof that a client applying the documented rule to these values predicts
 * the bridge's refusal exactly, lives in `ContainerGroupEpochs.test.ts`.
 *
 * The fixtures are the fields each converter reads, cast to the document type, for the reason given in
 * `ContainerGroupKeys.test.ts`.
 */

import "q2-test";
import * as assert from "assert";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { grantsWithEpochOf } from "../../../api/main/GroupEpochStaleness";
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

/** Two grants, one of them a manager grant, so the role still travels with the id. */
const GRANTS: types.cloud.GroupGrant[] = [
    {groupId: engineering, role: "manager"},
    {groupId: legal, role: "user"},
];

/** Both grants wrapped at the container's current key, at different epochs. */
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
) => {groups: types.cloud.GroupGrantInfo[], groupKeys: types.cloud.GroupKeysEntry[]};

/** One entry per container type, so a module that forgets to derive the epochs fails here. */
const CONVERTERS: {name: string, convert: Convert}[] = [
    {
        name: "thread",
        convert: (groups, groupKeys, ids) => new ThreadConverter().convertThread(alice, containerFields(groups, groupKeys) as unknown as db.thread.Thread, ids),
    },
    {
        name: "store",
        convert: (groups, groupKeys, ids) => new StoreConverter().convertStore(alice, containerFields(groups, groupKeys) as unknown as db.store.Store, ids),
    },
    {
        name: "inbox",
        convert: (groups, groupKeys, ids) => new InboxConverter().convertInbox(alice, containerFields(groups, groupKeys) as unknown as db.inbox.Inbox, ids),
    },
    {
        name: "kvdb",
        convert: (groups, groupKeys, ids) => new KvdbConverter().convertKvdb(alice, containerFields(groups, groupKeys) as unknown as db.kvdb.Kvdb, ids),
    },
    {
        name: "stream room",
        convert: (groups, groupKeys, ids) => new StreamConverter().convertStreamRoom(alice, containerFields(groups, groupKeys) as unknown as db.stream.StreamRoom, ids),
    },
];

it("reports the epoch of each grant's wrap of the current key", async () => {
    assert.deepStrictEqual(grantsWithEpochOf({keyId: keyId, groups: GRANTS, groupKeys: GROUP_KEYS}), [
        {groupId: engineering, role: "manager", groupEpoch: 1},
        {groupId: legal, role: "user", groupEpoch: 4},
    ]);
});

it("reports the epoch of the current wrap, not of an older one", async () => {
    // The entry at `olderKeyId` stays by design — it opens what was written before the re-key — and it is behind
    // by definition. Reporting it would make every re-keyed container look like it needs another re-key.
    const reKeyed = [wrap(engineering, [{keyId: olderKeyId, groupEpoch: 1}, {keyId: keyId, groupEpoch: 3}])];
    assert.deepStrictEqual(grantsWithEpochOf({keyId: keyId, groups: [GRANTS[0]], groupKeys: reKeyed}), [
        {groupId: engineering, role: "manager", groupEpoch: 3},
    ]);
});

it("reports 0 for a wrap that declares no epoch", async () => {
    // A Phase-1 wrap carries no tag. `0` is behind any rotation, which is what the write-side check assumes too;
    // omitting the field would instead say "not wrapped", and the client would skip a re-key it owes.
    const untagged = [wrap(engineering, [{keyId: keyId}])];
    assert.deepStrictEqual(grantsWithEpochOf({keyId: keyId, groups: [GRANTS[0]], groupKeys: untagged}), [
        {groupId: engineering, role: "manager", groupEpoch: 0},
    ]);
});

it("omits the epoch when the current key is not wrapped to the grant at all", async () => {
    // Nothing is read through that group at the current key, so there is nothing to re-key for it. Absent has to
    // be distinguishable from `0`, or the two cases would call for the same client action.
    const notAtCurrentKey = [wrap(engineering, [{keyId: olderKeyId, groupEpoch: 1}])];
    const served = grantsWithEpochOf({keyId: keyId, groups: [GRANTS[0]], groupKeys: notAtCurrentKey});
    assert.deepStrictEqual(served, [{groupId: engineering, role: "manager"}]);
    assert.ok(!("groupEpoch" in served[0]), "the field is absent, not undefined-valued");
});

it("serves a grant with no key material at all as the bare grant", async () => {
    assert.deepStrictEqual(grantsWithEpochOf({keyId: keyId, groups: GRANTS, groupKeys: []}), GRANTS);
    assert.deepStrictEqual(grantsWithEpochOf({keyId: keyId}), []);
});

for (const {name, convert} of CONVERTERS) {
    it(`${name}: serves the wrap epoch on every grant`, async () => {
        assert.deepStrictEqual(convert(GRANTS, GROUP_KEYS, [legal]).groups, [
            {groupId: engineering, role: "manager", groupEpoch: 1},
            {groupId: legal, role: "user", groupEpoch: 4},
        ]);
    });
    
    it(`${name}: does not narrow the epochs to the caller's own groups`, async () => {
        // The caller belongs to `legal` only, so its `groupKeys` is narrowed to that one entry — while both grants
        // still carry an epoch. A container manager re-keys grants it is not a member of, and narrowing this would
        // hide exactly the work it has to do.
        const converted = convert(GRANTS, GROUP_KEYS, [legal]);
        assert.deepStrictEqual(converted.groupKeys.map(entry => entry.group), [legal], "keys are narrowed");
        assert.deepStrictEqual(converted.groups.map(g => g.groupEpoch), [1, 4], "epochs are not");
    });
    
    it(`${name}: a caller in none of the granted groups still learns the epochs`, async () => {
        assert.deepStrictEqual(convert(GRANTS, GROUP_KEYS, []).groups.map(g => g.groupEpoch), [1, 4]);
    });
    
    it(`${name}: a container with no group grants serves an empty list`, async () => {
        assert.deepStrictEqual(convert(undefined, [], [legal]).groups, []);
    });
    
    it(`${name}: the role still travels with every grant`, async () => {
        // The epoch is added to the grant, not substituted for it.
        const converted = convert(GRANTS, GROUP_KEYS, [legal]);
        assert.deepStrictEqual(converted.groups.map(g => [g.groupId, g.role]), [[engineering, "manager"], [legal, "user"]]);
    });
}
