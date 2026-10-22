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
import { Migration076StreamRoomGroupIndex } from "../../../db/migration/Migration076StreamRoomGroupIndex";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

it("indexes the stream rooms by granted group", async () => {
    const indexes: unknown[] = [];
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => {
            assert.strictEqual(name, "streamRoom");
            return {createIndex: async (spec: unknown) => {
                indexes.push(spec);
            }};
        }})) as never,
    });
    await Migration076StreamRoomGroupIndex.go(ioc);
    assert.deepStrictEqual(indexes, [{"groups.groupId": 1}]);
});
