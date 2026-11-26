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
import { Migration081SpaceRungs } from "../../../db/migration/Migration081SpaceRungs";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

it("creates the collection of space rungs, read by space and key version", async () => {
    const indexes: unknown[] = [];
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => ({createIndex: async (spec: unknown, options: unknown) => {
            indexes.push([name, spec, options]);
        }})})) as never,
    });
    await Migration081SpaceRungs.go(ioc);
    assert.deepStrictEqual(indexes, [["spaceRung", {spaceId: 1, atKeyVersion: 1}, undefined]]);
});
