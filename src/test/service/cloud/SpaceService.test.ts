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
import * as types from "../../../types";
import { SpaceService } from "../../../service/cloud/SpaceService";
import { SpaceRepository } from "../../../service/cloud/SpaceRepository";
import { AppException } from "../../../api/AppException";
import { DbDuplicateError } from "../../../error/DbDuplicateError";
import { GroupRotationRateLimiter } from "../../../cluster/master/ipcServices/GroupRotationRateLimiter";
import { CacheWithTTL } from "../../../utils/CacheWithTTL";
import type { Config } from "../../../cluster/common/ConfigUtils";

const g1 = "g1" as types.group.GroupId;
const g2 = "g2" as types.group.GroupId;
const alice = "alice" as types.cloud.UserId;
const bob = "bob" as types.cloud.UserId;
const pub = "pub" as types.cloud.UserPubKey;

function entry(keyVersion: number, recipient: types.cloud.SpaceKeyEntry["recipient"]): types.cloud.SpaceKeyEntry {
    return {keyVersion, recipient, data: "AA==" as types.core.Base64, signature: "AA==" as types.core.Base64};
}

function refused(f: () => void) {
    assert.throws(f, (e: unknown) => AppException.is(e, "SPACE_KEYS_INVALID"));
}

it("takes the highest of the caller's own role and the roles of its groups", () => {
    const space = {users: [{userId: alice, pubKey: pub, role: "user" as const}], groups: [{groupId: g1, role: "manager" as const, groupKeyVersion: 1}, {groupId: g2, role: "user" as const, groupKeyVersion: 1}]};
    assert.strictEqual(SpaceService.roleOf(space, alice, []), "user");
    assert.strictEqual(SpaceService.roleOf(space, alice, [g1]), "manager");
    assert.strictEqual(SpaceService.roleOf(space, bob, [g2]), "user");
    assert.strictEqual(SpaceService.roleOf(space, bob, []), undefined);
});

it("is stale once a recipient group is past the epoch the key was wrapped to, or is gone", () => {
    const space = {groups: [{groupId: g1, role: "user" as const, groupKeyVersion: 2}]};
    assert.strictEqual(SpaceService.isStale(space, new Map([[g1, 2]])), false);
    assert.strictEqual(SpaceService.isStale(space, new Map([[g1, 3]])), true);
    assert.strictEqual(SpaceService.isStale(space, new Map()), true);
    assert.strictEqual(SpaceService.isStale({groups: []}, new Map()), false);
});

it("wants exactly one key entry per recipient and version", () => {
    const recipients = [{groupId: g1}, {userId: alice}];
    const epochs = new Map([[g1, 3]]);
    SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 3}), entry(1, {userId: alice})], recipients, [1], 1, epochs);
    // One missing, one for somebody else, one twice.
    refused(() => SpaceService.assertKeysCover([entry(1, {userId: alice})], recipients, [1], 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 3}), entry(1, {userId: bob})], recipients, [1], 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {userId: alice}), entry(1, {userId: alice})], recipients, [1], 1, epochs));
    // A version nobody asked for.
    refused(() => SpaceService.assertKeysCover([entry(2, {groupId: g1, groupKeyVersion: 3}), entry(1, {userId: alice})], recipients, [1], 1, epochs));
});

it("holds a group's entry at the current key version to the group's current epoch", () => {
    const epochs = new Map([[g1, 3]]);
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 2})], [{groupId: g1}], [1], 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 4})], [{groupId: g1}], [1], 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 3})], [{groupId: g1}], [1], 1, new Map()));
    // An older version of the key may stay wrapped to an epoch the group has had.
    SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 2}), entry(2, {groupId: g1, groupKeyVersion: 3})], [{groupId: g1}], [1, 2], 2, epochs);
});

it("derives a space's id from the context and the resource id, apart from a group's", () => {
    const contextId = "ctx" as types.context.ContextId;
    const resourceId = "res" as types.core.ClientResourceId;
    const id = SpaceService.spaceId(contextId, resourceId);
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.strictEqual(id, SpaceService.spaceId(contextId, resourceId));
    assert.notStrictEqual(id, SpaceService.spaceId("ctx2" as types.context.ContextId, resourceId));
});

it("stores a key entry under an id that tells groups from users", () => {
    const spaceId = "s" as types.space.SpaceId;
    const forGroup = SpaceRepository.toKeyDoc(spaceId, entry(2, {groupId: "x" as types.group.GroupId, groupKeyVersion: 5}));
    const forUser = SpaceRepository.toKeyDoc(spaceId, entry(2, {userId: "x" as types.cloud.UserId}));
    assert.notStrictEqual(forGroup.id, forUser.id);
    assert.deepStrictEqual([forGroup.groupId, forGroup.groupKeyVersion, forGroup.userId], ["x", 5, undefined]);
    assert.deepStrictEqual([forUser.groupId, forUser.userId], [undefined, "x"]);
});

it("refuses to wrap a group below its floors, and writes the group so a concurrent floor change conflicts", async () => {
    const touched: string[] = [];
    const repo = {
        get: async (id: types.group.GroupId) => ({id, eraFloor: id === g2 ? 5 : 3}),
        touchLadder: async (group: {id: string}) => touched.push(group.id) > 0,
    } as never;
    const at = (groupId: types.group.GroupId, groupKeyVersion: number) => [{groupId, groupKeyVersion, role: "user" as const, groupPubKey: "k" as types.cloud.GroupPubKey}];
    await SpaceService.assertGroupFloors(repo, at(g1, 3));
    assert.deepStrictEqual(touched, ["g1"]);
    await assert.rejects(SpaceService.assertGroupFloors(repo, at(g1, 2)), (e: unknown) => AppException.is(e, "SPACE_KEYS_INVALID"));
    await assert.rejects(SpaceService.assertGroupFloors(repo, at(g2, 4)), (e: unknown) => AppException.is(e, "SPACE_KEYS_INVALID"));
    // The floors moved since the read: nothing written, refused.
    await assert.rejects(SpaceService.assertGroupFloors({...(repo as object), touchLadder: async () => false} as never, at(g1, 3)),
        (e: unknown) => AppException.is(e, "SPACE_KEYS_INVALID"));
});

it("refuses a statement dated off the bridge's clock, as a group statement is", () => {
    const st = {spaceId: "s", contextId: "c", seq: 1, prevDigest: "", op: "create", keyVersion: 9} as unknown as types.cloud.SpaceStatement;
    const check = (date: number) => {
        try {
            SpaceService.assertStatement({...st, date}, {spaceId: "s" as types.space.SpaceId, contextId: "c" as types.context.ContextId, op: "create", keyVersion: 1,
                after: {groups: [], users: []}, caller: {userId: alice, pubKey: pub, ownGroupIds: []}, managerOnly: true});
        }
        catch (e) {
            return AppException.is(e, "SPACE_STATEMENT_INVALID") ? String(e.data) : "other";
        }
        return "accepted";
    };
    assert.match(check(1), /date/);
    assert.match(check(Date.now() + 60 * 60 * 1000), /date/);
    // On time it gets past the date, to the next check.
    assert.match(check(Date.now()), /key version/);
});

describe("a deleted space's id", () => {
    /** A space repository over stand-ins: what was inserted, deleted and tombstoned, by collection. */
    function repository(tombstoned: types.space.SpaceId[] = []) {
        const log: string[] = [];
        const collection = (name: string) => ({
            insert: async (doc: {id: string}) => {
                log.push(`${name}.insert ${doc.id}`);
            },
            insertMany: async () => {},
            delete: async (id: string) => {
                log.push(`${name}.delete ${id}`);
            },
            deleteMany: async () => {
                log.push(`${name}.deleteMany`);
            },
            get: async (id: types.space.SpaceId) => (name === "tombstones" && tombstoned.includes(id) ? {id} : null),
            collection: {insertMany: async () => {}},
            getOptions: () => ({}),
            convertToDbObj: (x: unknown) => x,
        });
        const repo = new SpaceRepository(collection("spaces") as never, collection("keys") as never, collection("statements") as never, collection("tombstones") as never);
        return {repo, log};
    }
    const space = {id: "s1" as types.space.SpaceId, contextId: "c" as types.context.ContextId, statement: {spaceId: "s1", seq: 1}} as unknown as Parameters<SpaceRepository["insert"]>[0];
    
    it("SECURITY: stays taken: deleting leaves a tombstone, and a space cannot be created under it again", async () => {
        const {repo, log} = repository();
        await repo.delete(space);
        assert.ok(log.includes("tombstones.insert s1"), JSON.stringify(log));
        const taken = repository(["s1" as types.space.SpaceId]);
        await assert.rejects(() => taken.repo.insert(space, []), (e: unknown) => e instanceof DbDuplicateError);
        assert.ok(!taken.log.some(line => line.startsWith("spaces.insert")), "nothing written");
    });
    
    it("tombstones go with their context", async () => {
        const {repo, log} = repository();
        await repo.deleteTombstonesOfContext("c" as types.context.ContextId);
        assert.deepStrictEqual(log, ["tombstones.deleteMany"]);
    });
});

describe("space rotations are rate-limited per user and space", () => {
    const service = (perMinute: number, perHour: number) => {
        const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
        const created = new SpaceService(null as never, null as never, "h" as types.core.Host, null as never, null as never, null as never, limiter,
            {maxSpaceRotationsPerMinute: perMinute, maxSpaceRotationsPerHour: perHour} as Config);
        return (created as unknown as {reserveRotation: (spaceId: string, userId: string) => Promise<string[]>}).reserveRotation.bind(created);
    };
    
    it("SECURITY: a burst past the per-minute budget is refused with a retry time, per user and space", async () => {
        const reserve = service(3, 60);
        for (let i = 0; i < 3; i++) {
            await reserve("s1", "alice");
        }
        await assert.rejects(() => reserve("s1", "alice"), (e: unknown) => AppException.is(e, "SPACE_ROTATION_RATE_LIMIT") && typeof (e.data as {retryAt?: number}).retryAt === "number");
        await reserve("s1", "bob");
        await reserve("s2", "alice");
    });
    
    it("SECURITY: the hourly budget holds too, and a refusal hands back the unit it took", async () => {
        const reserve = service(10, 2);
        await reserve("s1", "alice");
        await reserve("s1", "alice");
        // Refused by the hourly budget: the burst unit taken first is given back, so it is not spent for nothing.
        for (let i = 0; i < 20; i++) {
            await assert.rejects(() => reserve("s1", "alice"), (e: unknown) => AppException.is(e, "SPACE_ROTATION_RATE_LIMIT"));
        }
    });
});
