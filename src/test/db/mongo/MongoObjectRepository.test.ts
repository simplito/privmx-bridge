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
import { MongoObjectRepository } from "../../../db/mongo/MongoObjectRepository";

it("a page is read as documents, not as one `$facet` document that a page of large ones overflows", async () => {
    const pipelines: any[][] = [];
    const collection = {
        aggregate: (pipeline: any[]) => {
            pipelines.push(pipeline);
            const counting = "$count" in pipeline[pipeline.length - 1];
            return {toArray: async () => counting ? [{count: 3}] : [{_id: "a"}, {_id: "b"}]};
        },
    } as unknown as mongodb.Collection<any>;
    const repository = new MongoObjectRepository<string, {id: string}>(collection, "id", undefined, undefined as never, undefined as never, "test", new Map());
    const match = {$match: {contextId: "c"}};
    const page = await repository.aggregationX([match], {skip: 2, limit: 2, sortOrder: "desc"}, "id");
    assert.deepStrictEqual(page, {list: [{id: "a"}, {id: "b"}], count: 3});
    assert.ok(!JSON.stringify(pipelines).includes("$facet"));
    assert.deepStrictEqual(pipelines, [
        [match, {$sort: {_id: -1}}, {$skip: 2}, {$limit: 2}],
        [match, {$count: "count"}],
    ]);
});
