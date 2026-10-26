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
import { Migration076GroupEpochKeyLookups } from "../../../db/migration/Migration076GroupEpochKeyLookups";
import { IOC } from "../../../service/ioc/IOC";
import { createFake } from "../../testUtils/TestUtils";

it("indexes epoch rows by their key's keyId and by their grant key", async () => {
    const indexes: [string, unknown][] = [];
    const ioc = createFake<IOC>({
        getMongoDbManager: (() => ({createOrGetCollection: async (name: string) => ({createIndex: async (spec: unknown) => {
            indexes.push([name, spec]);
        }})})) as never,
    });
    await Migration076GroupEpochKeyLookups.go(ioc);
    assert.deepStrictEqual(indexes, [["groupEpochKey", {groupId: 1, "groupKey.keyId": 1}], ["groupEpochKey", {groupId: 1, groupPubKey: 1}]]);
});
