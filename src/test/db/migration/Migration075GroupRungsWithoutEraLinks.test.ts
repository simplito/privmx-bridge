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
import { Migration075GroupRungsWithoutEraLinks } from "../../../db/migration/Migration075GroupRungsWithoutEraLinks";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

type Row = Record<string, unknown>;

it("deletes era-link rungs, unsets the kind fields of the rest and leaves everything else alone", async () => {
    const rows: Row[] = [
        {_id: "G|2|1|epoch|", atKeyVersion: 2, targetKeyVersion: 1, recipientKind: "epoch", data: "a", author: "alice"},
        {_id: "G|2|1|user|bob", atKeyVersion: 2, targetKeyVersion: 1, recipientKind: "user", recipient: "bob", data: "b"},
        {_id: "G|3|2|group|H", atKeyVersion: 3, targetKeyVersion: 2, recipientKind: "group", recipient: "H", data: "c"},
        {_id: "G|3|2|carol", atKeyVersion: 3, targetKeyVersion: 2, data: "d", author: "carol"},
    ];
    const session = {} as never;
    const sessions: unknown[] = [];
    const collection = {
        deleteMany: async (filter: {recipientKind: {$in: string[]}}, options: {session: unknown}) => {
            sessions.push(options.session);
            for (let i = rows.length - 1; i >= 0; i--) {
                if (filter.recipientKind.$in.includes(rows[i].recipientKind as string)) {
                    rows.splice(i, 1);
                }
            }
        },
        updateMany: async (_filter: unknown, update: {$unset: Row}, options: {session: unknown}) => {
            sessions.push(options.session);
            for (const row of rows) {
                for (const field of Object.keys(update.$unset)) {
                    delete row[field];
                }
            }
        },
    };
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => {
            assert.strictEqual(name, "groupArchiveRung");
            return collection;
        }})) as never,
    });
    await Migration075GroupRungsWithoutEraLinks.go(ioc, session);
    assert.deepStrictEqual(rows, [
        {_id: "G|2|1|epoch|", atKeyVersion: 2, targetKeyVersion: 1, data: "a", author: "alice"},
        {_id: "G|3|2|carol", atKeyVersion: 3, targetKeyVersion: 2, data: "d", author: "carol"},
    ]);
    assert(sessions.length === 2 && sessions.every(s => s === session), "both writes in the migration's session");
});
