/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * `rotateKeys` on all five container repositories: what it writes, and what it must leave alone.
 *
 * A rotation carries no re-signed `data`, so the head of the history has to stay the one `lastModifier` and
 * `lastModificationDate` describe — the endpoint checks that pairing in `assertContainerDIOIntegrity`, with a
 * five-minute window on the timestamp. Touch either field and every client read of the container fails
 * verification: invisible here, invisible on the write path, reported by the client as corrupt data. An Inbox
 * rotation changes one thing more: the entries public key in the head's public data (F-05d), which no signature
 * covers.
 */

import "q2-test";
import * as assert from "assert";
import { MongoObjectRepository } from "../../../db/mongo/MongoObjectRepository";
import { ThreadRepository } from "../../../service/cloud/ThreadRepository";
import { StoreRepository } from "../../../service/cloud/StoreRepository";
import { KvdbRepository } from "../../../service/cloud/KvdbRepository";
import { InboxRepository } from "../../../service/cloud/InboxRepository";
import { StreamRoomRepository } from "../../../service/cloud/StreamRoomRepository";
import { createFake } from "../../testUtils/TestUtils";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { DateUtils } from "../../../utils/DateUtils";

const contextId = "MyContextId" as types.context.ContextId;
const oldKeyId = "OldKeyId" as types.core.KeyId;
/** Installed by a first rotation: it sits on the document, but no history entry's data was signed under it. */
const midKeyId = "MidKeyId" as types.core.KeyId;
const newKeyId = "NewKeyId" as types.core.KeyId;
const janek = "janek" as types.cloud.UserId;
const alice = "alice" as types.cloud.UserId;
const rotator = "carol" as types.cloud.UserId;
const engineering = "engineering" as types.group.GroupId;

/** Long before now, so a `lastModificationDate` moved to "now" could not pass the endpoint's 5-minute window. */
const SIGNED_AT = (DateUtils.now() - DateUtils.hours(3)) as types.core.Timestamp;

const OLD_GROUP_KEYS: types.cloud.GroupKeysEntry[] = [
    {group: engineering, keys: [{keyId: oldKeyId, data: "eng-at-old" as types.core.UserKeyData, groupEpoch: 2}]},
];
const NEW_GROUP_KEYS: types.cloud.GroupKeysEntry[] = [
    {group: engineering, keys: [
        {keyId: oldKeyId, data: "eng-at-old" as types.core.UserKeyData, groupEpoch: 2},
        {keyId: newKeyId, data: "eng-at-new" as types.core.UserKeyData, groupEpoch: 3},
    ]},
];
const GRANTS: types.cloud.GroupGrant[] = [{groupId: engineering, role: "user"}];
const NEW_KEYS: types.cloud.UserKeysEntry[] = [
    {user: alice, keys: [{keyId: newKeyId, data: "alice-at-new" as types.core.UserKeyData}]},
];

/** The fields every container document shares, plus the per-module ones; each repository ignores the rest. */
function containerFields(historyData: unknown, documentData: unknown) {
    return {
        id: "MyContainerId",
        contextId: contextId,
        createDate: SIGNED_AT,
        creator: janek,
        lastModifier: janek,
        lastModificationDate: SIGNED_AT,
        keyId: oldKeyId,
        data: documentData,
        allTimeUsers: [janek, alice],
        users: [alice],
        managers: [janek],
        keys: [{user: alice, keys: [{keyId: oldKeyId, data: "alice-at-old" as types.core.UserKeyData}]}],
        groups: GRANTS,
        groupKeys: OLD_GROUP_KEYS,
        history: [{
            keyId: oldKeyId,
            data: historyData,
            users: [alice],
            managers: [janek],
            groups: GRANTS,
            created: SIGNED_AT,
            author: janek,
        }],
        policy: {},
        // Per-module state, kept so the spread has something module-specific to preserve.
        lastMsgDate: SIGNED_AT,
        messages: 3,
        lastFileDate: SIGNED_AT,
        files: 2,
        lastEntryDate: SIGNED_AT,
        entries: 4,
        janusRoomId: 77,
        state: "active",
        emptyRoomTtl: 60000,
    };
}

/** The full `InboxData`; an inbox's document carries only its `meta`. */
const INBOX_DATA = {
    threadId: "MyThreadId",
    storeId: "MyStoreId",
    fileConfig: {minCount: 0, maxCount: 5, maxFileSize: 100, maxWholeUploadSize: 500},
    meta: "inbox-meta",
    publicData: {version: 5, publicMeta: "signed-public-meta", authorPubKey: "janek-pub", inboxPubKey: "old-entries-pub", inboxKeyId: oldKeyId},
};

interface Rotated {
    keyId: types.core.KeyId;
    keys: types.cloud.UserKeysEntry[];
    groups?: types.cloud.GroupGrant[];
    groupKeys?: types.cloud.GroupKeysEntry[];
    lastModifier: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    data: unknown;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    history: {keyId: types.core.KeyId, data: unknown, author: types.cloud.UserId}[];
}

interface Case {
    name: string;
    /** What the document's `data` holds, when it is not simply the history entry's. */
    documentData: unknown;
    historyData: unknown;
    /** `overrides` replaces document fields, so a case can start from a container that was already rotated. */
    rotate: (grantees?: types.cloud.ContainerGrantees, overrides?: Record<string, unknown>) => Promise<{written: unknown[], result: Rotated}>;
}

function fakeRepository<T>(): {written: unknown[], repository: MongoObjectRepository<string, T>} {
    const written: unknown[] = [];
    const repository = createFake<MongoObjectRepository<string, T>>({
        update: (async (value: T) => {
            written.push(value);
        }) as never,
    });
    return {written, repository};
}

const CASES: Case[] = [
    {
        name: "thread",
        documentData: "container-data",
        historyData: "container-data",
        rotate: async (grantees, overrides) => {
            const {written, repository} = fakeRepository<db.thread.Thread>();
            const old = {...containerFields("container-data", "container-data"), ...overrides} as unknown as db.thread.Thread;
            const result = await new ThreadRepository(repository as never).rotateKeys(old, rotator, newKeyId, NEW_KEYS, grantees);
            return {written, result: result as unknown as Rotated};
        },
    },
    {
        name: "store",
        documentData: "container-data",
        historyData: "container-data",
        rotate: async (grantees, overrides) => {
            const {written, repository} = fakeRepository<db.store.Store>();
            const old = {...containerFields("container-data", "container-data"), ...overrides} as unknown as db.store.Store;
            const result = await new StoreRepository(repository as never).rotateKeys(old, rotator, newKeyId, NEW_KEYS, grantees);
            return {written, result: result as unknown as Rotated};
        },
    },
    {
        name: "kvdb",
        documentData: "container-data",
        historyData: "container-data",
        rotate: async (grantees, overrides) => {
            const {written, repository} = fakeRepository<db.kvdb.Kvdb>();
            const old = {...containerFields("container-data", "container-data"), ...overrides} as unknown as db.kvdb.Kvdb;
            const result = await new KvdbRepository(repository as never).rotateKeys(old, rotator, newKeyId, NEW_KEYS, grantees);
            return {written, result: result as unknown as Rotated};
        },
    },
    {
        name: "stream room",
        documentData: "container-data",
        historyData: "container-data",
        rotate: async (grantees, overrides) => {
            const {written, repository} = fakeRepository<db.stream.StreamRoom>();
            const old = {...containerFields("container-data", "container-data"), ...overrides} as unknown as db.stream.StreamRoom;
            const result = await new StreamRoomRepository(repository as never).rotateKeys(old, rotator, newKeyId, NEW_KEYS, grantees);
            return {written, result: result as unknown as Rotated};
        },
    },
];

const grantees = (): types.cloud.ContainerGrantees => ({groups: GRANTS, groupKeys: NEW_GROUP_KEYS});

for (const testCase of CASES) {
    it(`${testCase.name}: installs the new key and writes the document once`, async () => {
        const {written, result} = await testCase.rotate(grantees());
        assert.strictEqual(written.length, 1, "one write");
        assert.strictEqual(result.keyId, newKeyId);
        assert.deepStrictEqual(result.keys, NEW_KEYS);
        assert.deepStrictEqual(result.groupKeys, NEW_GROUP_KEYS);
    });
    
    it(`${testCase.name}: leaves the signed head attributable`, async () => {
        const {result} = await testCase.rotate(grantees());
        assert.strictEqual(result.lastModifier, janek, "lastModifier must not become the rotator");
        assert.strictEqual(result.lastModificationDate, SIGNED_AT, "lastModificationDate must not move");
        const head = result.history[result.history.length - 1];
        assert.strictEqual(head.keyId, oldKeyId, "the new head still names the key its data was signed under");
        assert.deepStrictEqual(head.data, testCase.historyData, "the new head carries the data that was signed");
    });
    
    it(`${testCase.name}: a second rotation names the key its head data was signed under`, async () => {
        // The state a first rotation leaves behind: the document moved on to midKeyId while the head kept
        // oldKeyId, because that is the key its data is encrypted with. Rotating again must copy the head's
        // own keyId forward — reading `keyId` off the document instead names midKeyId, which never encrypted
        // this data, and the endpoint (which asks for exactly `data.back().keyId`) then gets the one key that
        // cannot open the container.
        const entry = (author: types.cloud.UserId) => ({
            keyId: oldKeyId, data: testCase.historyData,
            users: [alice], managers: [janek], groups: GRANTS, created: SIGNED_AT, author,
        });
        const {result} = await testCase.rotate(grantees(), {
            keyId: midKeyId,
            keys: [{user: alice, keys: [
                {keyId: oldKeyId, data: "alice-at-old" as types.core.UserKeyData},
                {keyId: midKeyId, data: "alice-at-mid" as types.core.UserKeyData},
            ]}],
            history: [entry(janek), entry(rotator)],
        });
        const head = result.history[result.history.length - 1];
        assert.strictEqual(head.keyId, oldKeyId, "the head must name the key its data was signed under, not the one the previous rotation installed");
        assert.deepStrictEqual(head.data, testCase.historyData);
    });
    
    it(`${testCase.name}: appends exactly one entry and credits the rotator`, async () => {
        const {result} = await testCase.rotate(grantees());
        assert.strictEqual(result.history.length, 2);
        // `lastModifier` stays the previous author, so this is the only record of who rotated.
        assert.strictEqual(result.history[1].author, rotator);
    });
    
    it(`${testCase.name}: changes no membership and no metadata`, async () => {
        const {result} = await testCase.rotate(grantees());
        assert.deepStrictEqual(result.users, [alice]);
        assert.deepStrictEqual(result.managers, [janek]);
        assert.deepStrictEqual(result.groups, GRANTS);
        assert.deepStrictEqual(result.data, testCase.documentData, "the document's own data field is untouched");
    });
    
    it(`${testCase.name}: keeps the group key blobs when no grantees are passed`, async () => {
        // Dropping them would take the entries at older keyIds too — the ones that open earlier content.
        const {result} = await testCase.rotate(undefined);
        assert.deepStrictEqual(result.groupKeys, OLD_GROUP_KEYS);
        assert.deepStrictEqual(result.groups, GRANTS);
    });
}

const NEW_ENTRIES_PUB = "new-entries-pub" as types.core.EccPubKey;

async function rotateInbox(rotationGrantees?: types.cloud.ContainerGrantees) {
    const {written, repository} = fakeRepository<db.inbox.Inbox>();
    const old = containerFields(INBOX_DATA, INBOX_DATA.meta) as unknown as db.inbox.Inbox;
    const result = await new InboxRepository(repository as never).rotateKeys(
        old, rotator, newKeyId, NEW_KEYS, NEW_ENTRIES_PUB, rotationGrantees);
    return {written, result: result as unknown as Rotated};
}

it("inbox: installs the new key and writes the document once", async () => {
    const {written, result} = await rotateInbox(grantees());
    assert.strictEqual(written.length, 1, "one write");
    assert.strictEqual(result.keyId, newKeyId);
    assert.deepStrictEqual(result.keys, NEW_KEYS);
    assert.deepStrictEqual(result.groupKeys, NEW_GROUP_KEYS);
});

it("SECURITY inbox: the new head seals entries to the new key (F-05d)", async () => {
    // Kept as it was, the head's public data would keep senders sealing entries to the replaced key, which a
    // member removed before the re-key still holds.
    const {result} = await rotateInbox(grantees());
    assert.strictEqual(result.history.length, 2);
    const head = result.history[result.history.length - 1] as {data: typeof INBOX_DATA};
    assert.deepStrictEqual(head.data.publicData, {...INBOX_DATA.publicData, inboxPubKey: NEW_ENTRIES_PUB, inboxKeyId: newKeyId});
});

it("SECURITY inbox: a rotation changes nothing but the entries key, so a plain user cannot rewrite the inbox", async () => {
    // rotateKeys defaults to "user", update to "manager": a rotation that took the rotator's data let a plain
    // user replace the metadata, the file limits `send` enforces and the entries key managers set.
    const {result} = await rotateInbox(grantees());
    const head = result.history[result.history.length - 1] as {keyId: types.core.KeyId, data: typeof INBOX_DATA};
    assert.strictEqual(head.keyId, oldKeyId, "the head still names the key its meta was signed under");
    assert.deepStrictEqual({...head.data, publicData: undefined}, {...INBOX_DATA, publicData: undefined});
    assert.strictEqual(head.data.publicData.publicMeta, INBOX_DATA.publicData.publicMeta);
    assert.strictEqual(head.data.publicData.authorPubKey, INBOX_DATA.publicData.authorPubKey);
    assert.strictEqual(result.data, INBOX_DATA.meta, "the document still holds the meta alone");
    assert.strictEqual(result.lastModifier, janek, "lastModifier must not become the rotator");
    assert.strictEqual(result.lastModificationDate, SIGNED_AT, "lastModificationDate must not move");
    assert.strictEqual(result.history[1].author, rotator, "the history is the only record of who rotated");
});

it("inbox: changes no membership and keeps the group key blobs when no grantees are passed", async () => {
    const {result} = await rotateInbox(undefined);
    assert.deepStrictEqual(result.users, [alice]);
    assert.deepStrictEqual(result.managers, [janek]);
    assert.deepStrictEqual(result.groups, GRANTS);
    assert.deepStrictEqual(result.groupKeys, OLD_GROUP_KEYS);
});

it("refuses to rotate a container with no history rather than reading past its end", async () => {
    const {repository} = fakeRepository<db.store.Store>();
    const old = {...containerFields("container-data", "container-data"), history: []} as unknown as db.store.Store;
    await assert.rejects(
        () => new StoreRepository(repository as never).rotateKeys(old, rotator, newKeyId, NEW_KEYS, grantees()),
        /history is empty/,
    );
});
