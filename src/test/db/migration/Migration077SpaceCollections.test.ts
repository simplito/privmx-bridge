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
import { Migration077SpaceCollections } from "../../../db/migration/Migration077SpaceCollections";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

it("creates the space collections with their indexes", async () => {
    const indexes: [string, unknown][] = [];
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => ({createIndex: async (spec: unknown) => {
            indexes.push([name, spec]);
        }})})) as never,
    });
    await Migration077SpaceCollections.go(ioc);
    assert.deepStrictEqual(indexes, [
        ["space", {contextId: 1, "users.userId": 1}],
        ["space", {"groups.groupId": 1}],
        ["space", "clientResourceId"],
        ["spaceKey", {spaceId: 1, keyVersion: 1}],
    ]);
});
