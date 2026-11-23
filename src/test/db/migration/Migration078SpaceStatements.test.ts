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
import { Migration078SpaceStatements } from "../../../db/migration/Migration078SpaceStatements";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

it("creates the collection of space statements, one statement per space and seq", async () => {
    const indexes: unknown[] = [];
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => ({createIndex: async (spec: unknown, options: unknown) => {
            indexes.push([name, spec, options]);
        }})})) as never,
    });
    await Migration078SpaceStatements.go(ioc);
    assert.deepStrictEqual(indexes, [["spaceStatement", {spaceId: 1, seq: 1}, {unique: true}]]);
});
