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
import { Migration074GroupIndexes } from "../../../db/migration/Migration074GroupIndexes";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

it("indexes statement keys", async () => {
    const indexes: [string, unknown][] = [];
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => ({createIndex: async (spec: unknown) => {
            indexes.push([name, spec]);
        }})})) as never,
    });
    await Migration074GroupIndexes.go(ioc);
    assert.deepStrictEqual(indexes.map(([, spec]) => spec), [{groupId: 1, "statement.groupPubKey": 1}]);
});
