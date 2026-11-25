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
import { Migration079ResourceIdPerContext } from "../../../db/migration/Migration079ResourceIdPerContext";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

it("replaces the global resourceId index of groups and spaces with one per context", async () => {
    const calls: unknown[] = [];
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => ({
            // Only the group collection still has the global index; a fresh install's spaces never had it.
            indexExists: async () => name === "group",
            dropIndex: async (index: string) => {
                calls.push(["drop", name, index]);
            },
            createIndex: async (spec: unknown) => {
                calls.push(["create", name, spec]);
            },
        })})) as never,
    });
    await Migration079ResourceIdPerContext.go(ioc);
    assert.deepStrictEqual(calls, [
        ["drop", "group", "clientResourceId_1"],
        ["create", "group", {contextId: 1, clientResourceId: 1}],
        ["create", "space", {contextId: 1, clientResourceId: 1}],
    ]);
});
