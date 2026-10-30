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
import { Migration073GroupEpochKeys } from "../../../db/migration/Migration073GroupEpochKeys";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";
import * as types from "../../../types";

const groupId = "G" as types.group.GroupId;
const pub = (n: number) => `pub-${n}` as unknown as types.cloud.GroupPubKey;
const key = (epoch: number) => ({keyId: `k${epoch}` as types.core.KeyId, data: `d${epoch}` as types.core.UserKeyData, groupEpoch: epoch});

it("moves keyHistory and groupKeys into one row per epoch and unsets both, in the migration's session", async () => {
    // And a group that never rotated, so has neither field, still gets its current epoch's row.
    const fresh = {_id: "F" as types.group.GroupId, groupPubKey: pub(1), keyVersion: 1};
    const legacy = {
        _id: groupId,
        groupPubKey: pub(4),
        keyVersion: 4,
        // Cut at 2: epoch 1 is gone from both.
        keyHistory: [2, 3].map(keyVersion => ({keyVersion, groupPubKey: pub(keyVersion)})),
        groupKeys: [{group: groupId, keys: [key(2)]}, {group: groupId, keys: [key(4)]}],
    };
    const written: unknown[] = [];
    const unset: unknown[] = [];
    const sessions: unknown[] = [];
    const session = {} as never;
    const collections: Record<string, unknown> = {
        groupEpochKey: {
            createIndex: async () => "",
            bulkWrite: async (operations: {updateOne: {filter: unknown, update: unknown, upsert: boolean}}[], options: {session: unknown}) => {
                written.push(...operations.map(op => op.updateOne));
                sessions.push(options.session);
            },
        },
        group: {
            find: (_filter: unknown, options: {session: unknown}) => {
                sessions.push(options.session);
                return [legacy, fresh];
            },
            updateOne: async (filter: unknown, update: unknown, options: {session: unknown}) => {
                unset.push([filter, update]);
                sessions.push(options.session);
            },
        },
    };
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => collections[name]})) as never,
    });
    await Migration073GroupEpochKeys.go(ioc, session);
    assert.deepStrictEqual(written, [
        {filter: {_id: "G|2"}, update: {$set: {groupId, keyVersion: 2, groupPubKey: pub(2), groupKey: key(2)}}, upsert: true},
        {filter: {_id: "G|3"}, update: {$set: {groupId, keyVersion: 3, groupPubKey: pub(3)}}, upsert: true},
        {filter: {_id: "G|4"}, update: {$set: {groupId, keyVersion: 4, groupPubKey: pub(4), groupKey: key(4)}}, upsert: true},
        {filter: {_id: "F|1"}, update: {$set: {groupId: "F", keyVersion: 1, groupPubKey: pub(1)}}, upsert: true},
    ]);
    assert.deepStrictEqual(unset, [[{_id: groupId}, {$unset: {keyHistory: "", groupKeys: ""}}], [{_id: "F"}, {$unset: {keyHistory: "", groupKeys: ""}}]]);
    assert(sessions.every(s => s === session), "every read and write in the migration's transaction");
});

it("runs outside one transaction, and a re-run over a migrated group touches only its current row, without a groupKey to clobber", () => {
    // Each group's writes are idempotent, so a crash part-way is repaired by running it again.
    assert.strictEqual(Migration073GroupEpochKeys.transaction, false);
    const migrated = {_id: groupId, groupPubKey: pub(4), keyVersion: 4};
    // `$set` of this row leaves the groupKey the first run filed at epoch 4 in place, and no other row is written.
    assert.deepStrictEqual(Migration073GroupEpochKeys.rowsOf(migrated), [{groupId, keyVersion: 4, groupPubKey: pub(4)}]);
});
