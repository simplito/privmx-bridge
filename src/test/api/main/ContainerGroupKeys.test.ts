/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * `groupKeys`: the container keys wrapped to group grantees, narrowed to the groups the caller belongs to (BR-32).
 *
 * A client uses it twice over: to open the container through one of its own groups, and to learn which grants are
 * worth trying at all — a group it does not belong to costs a `groupGet` plus a full key-tree climb and then
 * fails. Three things must hold and none of them is visible at runtime if it regresses:
 *
 * 1. the narrowing has to be identical across the five container types, or one client gets two cost models;
 * 2. a surviving entry has to keep its whole `keys` array, or the caller loses its own group's history;
 * 3. `undefined` caller groups must throw rather than narrow to `[]` — `[]` reads as "you hold no grant" and
 *    would silently strip key material the caller needs.
 *
 * The fixtures are the fields each converter reads, cast to the document type. A full document fixture per module
 * would need updating on every unrelated schema change while testing nothing more: what is under test is the
 * narrowing of `groups`/`groupKeys`, and every converter reads those and nothing else for it.
 */

import "q2-test";
import * as assert from "assert";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { ownGroupKeysOf } from "../../../api/main/GroupKeysNarrowing";
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
const finance = "finance" as types.group.GroupId;
/** Granted once, revoked since: it keeps its blob at the old key but holds none at the current one. */
const marketing = "marketing" as types.group.GroupId;

/** Three grants, one of them a manager grant, so the role travels with the id and is not reconstructed. */
const GRANTS: types.cloud.GroupGrant[] = [
    {groupId: engineering, role: "manager"},
    {groupId: legal, role: "user"},
    {groupId: finance, role: "user"},
];

/**
 * One entry per granted group at the current key, plus two cases the narrowing must not flatten: `engineering`
 * carries an older epoch alongside the current one, and `marketing` is a revoked grant whose only blob sits at
 * the old key.
 */
const GROUP_KEYS: types.cloud.GroupKeysEntry[] = [
    {group: engineering, keys: [
        {keyId: keyId, data: "eng-at-current" as types.core.UserKeyData, groupEpoch: 3},
        {keyId: olderKeyId, data: "eng-at-older" as types.core.UserKeyData, groupEpoch: 1},
    ]},
    {group: legal, keys: [{keyId: keyId, data: "legal-at-current" as types.core.UserKeyData, groupEpoch: 2}]},
    {group: finance, keys: [{keyId: keyId, data: "fin-at-current" as types.core.UserKeyData, groupEpoch: 1}]},
    {group: marketing, keys: [{keyId: olderKeyId, data: "mkt-at-older" as types.core.UserKeyData, groupEpoch: 1}]},
];

function entryOf(group: types.group.GroupId) {
    return GROUP_KEYS.find(entry => entry.group === group)!;
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

interface NarrowedContainer {
    keyId: types.core.KeyId;
    groups: types.cloud.GroupGrant[];
    groupKeys: types.cloud.GroupKeysEntry[];
}

type Convert = (
    groups: types.cloud.GroupGrant[]|undefined,
    groupKeys: types.cloud.GroupKeysEntry[],
    ownGroupIds: types.group.GroupId[]|undefined,
) => NarrowedContainer;

/** One entry per container type, so a module that forgets to wire `ownGroupIds` through fails here. */
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

/**
 * The rule this field replaces the old `ownGroups` with, spelled out as a client would apply it: a grant is
 * openable now exactly when the caller holds a blob for it at the container's current `keyId`, and its role comes
 * from `groups`. `CloudKeyService.verifyThatOnlyGivenGroupsHaveAccess` enforces both directions of
 * "entry at the current keyId" ⇔ "currently granted", so this is exact rather than a guess.
 */
function grantsOpenableNow(container: NarrowedContainer): types.cloud.GroupGrant[] {
    return container.groupKeys
        .filter(entry => entry.keys.some(k => k.keyId === container.keyId))
        .map(entry => container.groups.find(grant => grant.groupId === entry.group))
        .filter((grant): grant is types.cloud.GroupGrant => grant !== undefined);
}

it("ownGroupKeysOf keeps the entries of the groups the caller holds", async () => {
    assert.deepStrictEqual(ownGroupKeysOf(GROUP_KEYS, [legal]), [entryOf(legal)]);
    assert.deepStrictEqual(ownGroupKeysOf(GROUP_KEYS, [finance, legal]), [entryOf(legal), entryOf(finance)]);
});

it("ownGroupKeysOf keeps every epoch of a surviving entry", async () => {
    // Narrowing the outer list must not touch the inner one: the older blob is what opens content written under
    // the previous container key, and it is the caller's own group.
    const narrowed = ownGroupKeysOf(GROUP_KEYS, [engineering]);
    assert.deepStrictEqual(narrowed, [entryOf(engineering)]);
    assert.strictEqual(narrowed[0].keys.length, 2, "both epochs survive");
    assert.deepStrictEqual(narrowed[0].keys.map(k => k.groupEpoch), [3, 1], "and keep their epoch tags");
});

it("ownGroupKeysOf ignores caller groups this container never wrapped a key to", async () => {
    const stranger = "sales" as types.group.GroupId;
    assert.deepStrictEqual(ownGroupKeysOf(GROUP_KEYS, [stranger, finance]), [entryOf(finance)]);
});

it("ownGroupKeysOf serves 'you hold none' but refuses 'not determined here'", async () => {
    // `[]` is an answer a client can act on: skip every grant. `undefined` is not — narrowing it to `[]` would
    // hand a caller an empty list that is indistinguishable from that answer, so it has to fail loudly.
    assert.deepStrictEqual(ownGroupKeysOf(GROUP_KEYS, []), []);
    assert.throws(() => ownGroupKeysOf(GROUP_KEYS, undefined), /ownGroupIds is undefined/);
});

it("a revoked grant stays readable but is not openable under the current key", async () => {
    // `buildGroupKeys` never removes entries, so a member of a since-revoked group keeps the blob that opens what
    // was written while the grant stood — while `groups` and the current-keyId test both say the grant is gone.
    // This is the distinction the old `ownGroups` could not express.
    const narrowed = ownGroupKeysOf(GROUP_KEYS, [marketing]);
    assert.deepStrictEqual(narrowed, [entryOf(marketing)], "the historical blob is served");
    assert.deepStrictEqual(
        grantsOpenableNow({keyId: keyId, groups: GRANTS, groupKeys: narrowed}),
        [],
        "but nothing it holds opens the container's current key",
    );
});

for (const {name, convert} of CONVERTERS) {
    it(`${name}: the caller's key blobs only, out of four entries`, async () => {
        const converted = convert(GRANTS, GROUP_KEYS, [legal]);
        assert.deepStrictEqual(converted.groups, GRANTS, "the full grant list stays — a manager needs it");
        assert.deepStrictEqual(converted.groupKeys, [entryOf(legal)]);
    });
    
    it(`${name}: a surviving entry arrives with all of its epochs`, async () => {
        const converted = convert(GRANTS, GROUP_KEYS, [engineering]);
        assert.deepStrictEqual(converted.groupKeys, [entryOf(engineering)], "including the older-key blob");
    });
    
    it(`${name}: a caller in none of the granted groups gets an empty list`, async () => {
        const converted = convert(GRANTS, GROUP_KEYS, []);
        assert.deepStrictEqual(converted.groupKeys, []);
        assert.deepStrictEqual(converted.groups, GRANTS, "which grants exist is still public to the container");
    });
    
    it(`${name}: a path that did not compute caller membership fails instead of stripping keys`, async () => {
        assert.throws(() => convert(GRANTS, GROUP_KEYS, undefined), /ownGroupIds is undefined/);
    });
    
    it(`${name}: a container with no group grants at all`, async () => {
        const converted = convert(undefined, [], [legal]);
        assert.deepStrictEqual(converted.groups, []);
        assert.deepStrictEqual(converted.groupKeys, []);
    });
    
    it(`${name}: the caller recovers its grants, with roles, from what it was served`, async () => {
        // What the removed `ownGroups` field used to say, derived client-side from `groupKeys` × `groups`.
        const converted = convert(GRANTS, GROUP_KEYS, [engineering, marketing]);
        assert.deepStrictEqual(grantsOpenableNow(converted), [{groupId: engineering, role: "manager"}]);
    });
}
