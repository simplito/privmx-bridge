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
import * as mongodb from "mongodb";
import { ContextRepository } from "../../../service/cloud/ContextRepository";
import { MongoObjectRepository } from "../../../db/mongo/MongoObjectRepository";
import { createFake } from "../../testUtils/TestUtils";
import * as types from "../../../types";
import * as db from "../../../db/Model";

it("SECURITY: sharing or unsharing a context never creates it", async () => {
    // An upsert racing `deleteContext` would bring a deleted context id back, and the group tombstones pruned with
    // that context (T4-14) would no longer stop a group being created under a deleted group's id.
    const calls: {filter: unknown, options: mongodb.UpdateOptions}[] = [];
    const collection = createFake<mongodb.Collection>({
        updateOne: (async (filter: unknown, _update: unknown, options: mongodb.UpdateOptions) => {
            calls.push({filter, options});
            return {matchedCount: 0} as never;
        }) as never,
    });
    const repository = new ContextRepository(createFake<MongoObjectRepository<types.context.ContextId, db.context.Context>>({
        collection: collection,
        getSession: () => undefined,
    }));
    const contextId = "DeletedContextId" as types.context.ContextId;
    await repository.addSolutionToContext(contextId, "SolutionId" as types.cloud.SolutionId);
    await repository.removeSolutionFromContext(contextId, "SolutionId" as types.cloud.SolutionId);
    assert.strictEqual(calls.length, 2);
    for (const call of calls) {
        assert.deepStrictEqual(call.filter, {_id: contextId});
        assert.strictEqual(call.options.upsert, undefined);
    }
});
