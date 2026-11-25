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
import { SpaceNotificationService } from "../../../service/cloud/SpaceNotificationService";
import * as types from "../../../types";
import * as db from "../../../db/Model";

it("tells the members of a removed group that they were removed", async () => {
    const asked: types.group.GroupId[][] = [];
    const sentTo: unknown[] = [];
    const jobs: Promise<void>[] = [];
    const service = new SpaceNotificationService(
        {addJob: (f: () => Promise<void>) => jobs.push(f())} as never,
        {sendCloudEventAtChannel: (keys: unknown[]) => sentTo.push(...keys)} as never,
        {
            createContextRepository: () => ({get: async () => null}),
            createGroupRepository: () => ({getGranteeView: async (ids: types.group.GroupId[]) => {
                asked.push(ids);
                return {groupsByUser: new Map(ids.includes("gone" as types.group.GroupId) ? [["bob", ["gone"]]] : [])};
            }}),
            createContextUserRepository: () => ({getUsers: async (_c: unknown, ids: string[]) => ids.map(id => ({userPubKey: "pub:" + id}))}),
        } as never,
        {} as never,
    );
    const space = {id: "s", contextId: "c", groups: [{groupId: "stays"}], users: [{userId: "alice"}]} as unknown as db.space.Space;
    service.sendUpdatedSpace(space, "recipientsRemoved", [], ["gone" as types.group.GroupId]);
    await Promise.all(jobs);
    assert.deepStrictEqual(asked, [["stays", "gone"]]);
    assert.deepStrictEqual(sentTo, ["pub:alice", "pub:bob"]);
});

it("tells the backend a space was deleted with its context, under the solution the context had", async () => {
    const toBackend: unknown[] = [];
    const jobs: Promise<void>[] = [];
    const service = new SpaceNotificationService(
        {addJob: (f: () => Promise<void>) => jobs.push(f())} as never,
        {sendCloudEventAtChannel: () => undefined} as never,
        {
            createContextRepository: () => ({get: async () => null}),
            createGroupRepository: () => ({getGranteeView: async () => ({groupsByUser: new Map()})}),
            createContextUserRepository: () => ({getUsers: async () => []}),
        } as never,
        {sendToPlainUsers: (solution: string, event: {type: string}) => toBackend.push([solution, event.type])} as never,
    );
    service.sendDeletedSpace({id: "s", contextId: "c", groups: [], users: []} as unknown as db.space.Space, "sol" as types.cloud.SolutionId);
    await Promise.all(jobs);
    assert.deepStrictEqual(toBackend, [["sol", "spaceDeleted"]]);
});
