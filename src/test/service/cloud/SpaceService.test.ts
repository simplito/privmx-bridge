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
import * as db from "../../../db/Model";
import { SpaceService } from "../../../service/cloud/SpaceService";
import { SpaceRepository } from "../../../service/cloud/SpaceRepository";
import { AppException } from "../../../api/AppException";
import { LadderMath } from "../../../service/cloud/keytree/LadderMath";
import { DbDuplicateError } from "../../../error/DbDuplicateError";
import { GroupRotationRateLimiter } from "../../../cluster/master/ipcServices/GroupRotationRateLimiter";
import { CacheWithTTL } from "../../../utils/CacheWithTTL";
import type { Config } from "../../../cluster/common/ConfigUtils";
import type { GroupEpochs } from "../../../api/main/GroupKeys";

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

it("wants exactly one key entry per recipient, of the current version", () => {
    const recipients = [{groupId: g1}, {userId: alice}];
    const epochs = new Map([[g1, 3]]);
    SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 3}), entry(1, {userId: alice})], recipients, 1, epochs);
    // One missing, one for somebody else, one twice.
    refused(() => SpaceService.assertKeysCover([entry(1, {userId: alice})], recipients, 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 3}), entry(1, {userId: bob})], recipients, 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {userId: alice}), entry(1, {userId: alice})], recipients, 1, epochs));
    // A version nobody asked for.
    refused(() => SpaceService.assertKeysCover([entry(2, {groupId: g1, groupKeyVersion: 3}), entry(1, {userId: alice})], recipients, 1, epochs));
});

it("holds a group's entry at the current key version to the group's current epoch", () => {
    const epochs = new Map([[g1, 3]]);
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 2})], [{groupId: g1}], 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 4})], [{groupId: g1}], 1, epochs));
    refused(() => SpaceService.assertKeysCover([entry(1, {groupId: g1, groupKeyVersion: 3})], [{groupId: g1}], 1, new Map()));
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
            insertMany: async () => undefined,
            delete: async (id: string) => {
                log.push(`${name}.delete ${id}`);
            },
            deleteMany: async () => {
                log.push(`${name}.deleteMany`);
            },
            get: async (id: types.space.SpaceId) => (name === "tombstones" && tombstoned.includes(id) ? {id} : null),
            collection: {insertMany: async () => undefined},
            getOptions: () => ({}),
            convertToDbObj: (x: unknown) => x,
        });
        const repo = new SpaceRepository(collection("spaces") as never, collection("keys") as never, collection("statements") as never, collection("tombstones") as never, collection("rungs") as never);
        return {repo, log};
    }
    const space = {id: "s1" as types.space.SpaceId, contextId: "c" as types.context.ContextId, statement: {spaceId: "s1", seq: 1}} as unknown as Parameters<SpaceRepository["insert"]>[0];
    
    it("SECURITY: stays taken: deleting leaves a tombstone, and a space cannot be created under it again", async () => {
        const {repo, log} = repository();
        await repo.delete(space);
        assert.ok(log.includes("tombstones.insert s1"), JSON.stringify(log));
        assert.ok(log.includes("keys.deleteMany") && log.includes("rungs.deleteMany"), "the wraps and the rungs go with the space");
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
        const reserve = (created as unknown as {reserveRotation: (spaceId: string, userId: string, kind: "rotate"|"remove") => Promise<string[]>}).reserveRotation.bind(created);
        return (spaceId: string, userId: string, kind: "rotate"|"remove" = "rotate") => reserve(spaceId, userId, kind);
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

describe("which budget a change of a space's key spends", () => {
    const epochs = new Map([[g1, 3], [g2, 5]]) as GroupEpochs;
    
    it("SECURITY: a removal spends its own budget, which rotations cannot use up", async () => {
        assert.strictEqual(SpaceService.rotationBudget(true, [{groupId: g1, groupKeyVersion: 3}], epochs), "remove");
        const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
        const created = new SpaceService(null as never, null as never, "h" as types.core.Host, null as never, null as never, null as never, limiter,
            {maxSpaceRotationsPerMinute: 10, maxSpaceRotationsPerHour: 2} as Config);
        const reserve = (kind: "rotate"|"remove") => (created as unknown as {reserveRotation: (s: string, u: string, k: string) => Promise<string[]>}).reserveRotation("s1", "manager", kind);
        await reserve("rotate");
        await reserve("rotate");
        await assert.rejects(() => reserve("rotate"), (e: unknown) => AppException.is(e, "SPACE_ROTATION_RATE_LIMIT"));
        // The rotation budget is spent; removing still goes, on its own.
        await reserve("remove");
    });
    
    it("SECURITY: a rotation that only replaces a stale key spends the stale burst only; a gratuitous one the rotation budget", async () => {
        // g2 has moved to epoch 5 since the key was wrapped to it at 4: stale, so the rotation is forced, not chosen.
        assert.strictEqual(SpaceService.rotationBudget(false, [{groupId: g1, groupKeyVersion: 3}, {groupId: g2, groupKeyVersion: 4}], epochs), "stale");
        // Stale re-keys are capped per minute (a user naming many groups of its own could rotate them in turn), but
        // spend no hourly budget, which stays untouched for gratuitous rotations.
        const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
        const created = new SpaceService(null as never, null as never, "h" as types.core.Host, null as never, null as never, null as never, limiter,
            {maxSpaceRotationsPerMinute: 3, maxSpaceRotationsPerHour: 1} as Config);
        const reserve = (kind: string) => (created as unknown as {reserveRotation: (s: string, u: string, k: string) => Promise<string[]>}).reserveRotation("s1", "alice", kind);
        for (let i = 0; i < 3; i++) {
            assert.deepStrictEqual(await reserve("stale"), ["spaceRotateStaleBurst|s1|alice"]);
        }
        await assert.rejects(() => reserve("stale"), (e: unknown) => AppException.is(e, "SPACE_ROTATION_RATE_LIMIT"));
        await reserve("rotate");
        assert.strictEqual(SpaceService.rotationBudget(false, [{groupId: g1, groupKeyVersion: 3}, {groupId: g2, groupKeyVersion: 5}], epochs), "rotate");
        assert.strictEqual(SpaceService.rotationBudget(false, [], epochs), "rotate", "a space of users only is never stale");
    });
});

describe("a rotation publishes exactly the canonical rungs of its key version", () => {
    const rungs = (at: number, targets: number[], data = "AA==") => targets.map(t => ({atKeyVersion: at, targetKeyVersion: t, data: data as types.core.Base64}));
    
    it("takes the unit rung and the aligned skips, floor 1", () => {
        SpaceService.assertRungs(rungs(2, [1]), 2);
        SpaceService.assertRungs(rungs(3, [2]), 3);
        SpaceService.assertRungs(rungs(4, [2, 3]), 4);
        SpaceService.assertRungs(rungs(8, [7, 6, 4]), 8);
        SpaceService.assertRungs(rungs(12, [11, 10, 8]), 12);
    });
    
    it("SECURITY: refuses a set with a rung missing, extra, repeated, upward or at another version", () => {
        const no = (f: () => void) => assert.throws(f, (e: unknown) => AppException.is(e, "SPACE_KEYS_INVALID"));
        no(() => SpaceService.assertRungs([], 2));
        no(() => SpaceService.assertRungs(rungs(8, [7, 6]), 8));
        no(() => SpaceService.assertRungs(rungs(8, [6, 4]), 8));
        no(() => SpaceService.assertRungs(rungs(8, [7, 6, 4, 5]), 8));
        no(() => SpaceService.assertRungs(rungs(8, [7, 6, 4, 4]), 8));
        no(() => SpaceService.assertRungs(rungs(4, [3, 3]), 4));
        no(() => SpaceService.assertRungs(rungs(3, [4]), 3));
        no(() => SpaceService.assertRungs(rungs(3, [2]), 4));
        no(() => SpaceService.assertRungs(rungs(2, [1], ""), 2));
    });
});

describe("the rungs of a space are served a page of key versions at a time", () => {
    const space = {id: "s1", contextId: "c", keyVersion: 10, groups: [], users: []} as unknown as db.space.Space;
    function service(asBackend = false) {
        const calls: {getKeys: unknown[][], getRungs: unknown[][], getKeyRange: unknown[][]} = {getKeys: [], getRungs: [], getKeyRange: []};
        const acls: string[] = [];
        const repository = {
            get: async () => space,
            getKeys: async (...args: unknown[]) => {
                calls.getKeys.push(args);
                return [];
            },
            getRungs: async (...args: unknown[]) => {
                calls.getRungs.push(args);
                return [];
            },
            getKeyRange: async (...args: unknown[]) => {
                calls.getKeyRange.push(args);
                return [];
            },
        };
        const created = new SpaceService({createSpaceRepository: () => repository} as never, null as never, "h" as types.core.Host, null as never, null as never,
            null as never, null as never, {} as Config);
        Object.assign(created, {
            access: async (_executor: unknown, _space: unknown, acl: string) => {
                acls.push(acl);
                return asBackend ? undefined : {userId: alice, pubKey: pub, ownGroupIds: [g1], role: "user"};
            },
            getGroupEpochs: async () => new Map(),
        });
        return {created, calls, acls};
    }
    const id = "s1" as types.space.SpaceId;
    
    it("SECURITY: spaceGet serves the current version only, never every version", async () => {
        const {created, calls} = service();
        await created.getSpace({} as never, id);
        assert.deepStrictEqual([...(calls.getKeys[0][3] as Map<string, number>)], [["s1", 10]]);
    });
    
    it("pages by key version, says where to continue, and checks the archive's own ACL entry", async () => {
        const {created, calls, acls} = service();
        const first = await created.getKeyArchive({} as never, {id, limit: 4});
        assert.deepStrictEqual(calls.getRungs[0], ["s1", 1, 4, SpaceService.ARCHIVE_PAGE_ROWS + 1]);
        assert.strictEqual(first.nextKeyVersion, 5);
        const last = await created.getKeyArchive({} as never, {id, fromKeyVersion: 5});
        assert.deepStrictEqual(calls.getRungs[1].slice(0, 3), ["s1", 5, 10], "default 256 versions, capped at the current one");
        assert.strictEqual(last.nextKeyVersion, undefined);
        const bounded = await created.getKeyArchive({} as never, {id, fromKeyVersion: 2, toKeyVersion: 3, limit: 1});
        assert.deepStrictEqual(calls.getRungs[2].slice(0, 3), ["s1", 2, 2]);
        assert.strictEqual(bounded.nextKeyVersion, 3);
        const past = await created.getKeyArchive({} as never, {id, fromKeyVersion: 11});
        assert.deepStrictEqual([past.rungs, past.nextKeyVersion, calls.getRungs.length], [[], undefined, 3], "nothing past the current version");
        assert.ok(acls.every(acl => acl === "context/spaceGetKeyArchive"));
        const rows = SpaceService.ARCHIVE_PAGE_ROWS + 1;
        assert.deepStrictEqual(calls.getKeyRange, [["s1", alice, [g1], 1, 4, rows], ["s1", alice, [g1], 5, 10, rows], ["s1", alice, [g1], 2, 2, rows]], "the caller's own wraps of the same versions");
    });
    
    it("a backend is served the rungs and no wraps", async () => {
        const {created, calls} = service(true);
        const page = await created.getKeyArchive({} as never, {id});
        assert.deepStrictEqual([page.keys, calls.getRungs.length, calls.getKeyRange.length], [[], 1, 0]);
    });
});

describe("an archive page is capped by rows, and carries whole versions only", () => {
    const rung = (at: number, target = at - 1) => ({atKeyVersion: at, targetKeyVersion: target, data: "AA==" as types.core.Base64});
    const wrap = (keyVersion: number) => ({keyVersion});
    const N = SpaceService.ARCHIVE_PAGE_ROWS;
    
    it("leaves a page under the cap as it is", () => {
        const page = SpaceService.capArchivePage({upTo: 9, next: 10}, [rung(2), rung(3)], [wrap(2)]);
        assert.deepStrictEqual([page.rungs.length, page.keys.length, page.nextKeyVersion], [2, 1, 10]);
    });
    
    it("SECURITY: ends the page before the first version past the cap, of either kind, and resumes there", () => {
        // N + 1 rungs read: versions 2.. with 4 rungs each, so row N falls inside a version that is dropped whole.
        const rungs = Array.from({length: N + 1}, (_, i) => rung(2 + Math.floor(i / 4), 1));
        const cut = rungs[N].atKeyVersion;
        const page = SpaceService.capArchivePage({upTo: 1000, next: undefined}, rungs, [wrap(2), wrap(cut)]);
        assert.strictEqual(page.nextKeyVersion, cut);
        assert.ok(page.rungs.every(r => r.atKeyVersion < cut) && page.rungs.length <= N);
        assert.strictEqual(page.rungs.length, rungs.filter(r => r.atKeyVersion < cut).length, "every rung of the versions kept");
        assert.deepStrictEqual(page.keys, [wrap(2)], "the wraps end at the same version");
        // Wraps past the cap cut the page too, at the lower of the two cuts.
        const keys = Array.from({length: N + 1}, (_, i) => wrap(2 + Math.floor(i / 100)));
        const byKeys = SpaceService.capArchivePage({upTo: 1000}, [rung(2), rung(50)], keys);
        assert.strictEqual(byKeys.nextKeyVersion, keys[N].keyVersion);
        assert.deepStrictEqual(byKeys.rungs, [rung(2)]);
    });
    
    it("serves every rung of a span, a repaired one's several", async () => {
        const space = {id: "s1", contextId: "c", keyVersion: 4, groups: [], users: []} as unknown as db.space.Space;
        const stored = [rung(4, 3), {...rung(4, 3), data: "BB==" as types.core.Base64}, rung(4, 2)];
        const created = new SpaceService({createSpaceRepository: () => ({get: async () => space, getRungs: async () => stored, getKeyRange: async () => []})} as never,
            null as never, "h" as types.core.Host, null as never, null as never, null as never, null as never, {} as Config);
        Object.assign(created, {access: async () => undefined});
        const page = await created.getKeyArchive({} as never, {id: "s1" as types.space.SpaceId});
        assert.deepStrictEqual(page.rungs, stored);
    });
});

describe("pruning and repair rungs ride on a rotation, a manager's only", () => {
    const user = (userId: types.cloud.UserId, role: "user"|"manager") => ({userId, pubKey: pub, role});
    // Key version 4 now; the rotation makes 5, whose own rungs are the canonical ones.
    const space = {id: "s1", contextId: "c", keyVersion: 4, keysPrunedBelow: 0, version: 7, groups: [], users: [user(alice, "manager"), user(bob, "user")]} as unknown as db.space.Space;
    const rungsOf = (v: number) => LadderMath.rungSpansFor(v, 1).map(span => ({atKeyVersion: span.at, targetKeyVersion: span.target, data: "AA==" as types.core.Base64}));
    const repair = (at: number, target: number) => ({atKeyVersion: at, targetKeyVersion: target, data: "RR==" as types.core.Base64});
    
    /** A service whose rotation runs for real down to the write, which records what it would do. */
    function rotation(standing: "user"|"manager", stored: Map<string, number> = new Map()) {
        const done: string[] = [];
        let changes: Partial<db.space.Space> = {};
        const repository = {
            deleteKeysOf: async () => done.push("deleteKeysOf"),
            deleteKeysBelow: async (_id: string, v: number) => done.push(`deleteKeysBelow ${v}`),
            insertKeys: async () => done.push("insertKeys"),
            countRungs: async () => stored,
            insertRungs: async (_id: string, rungs: types.cloud.SpaceRung[], seq: number) => done.push(`insertRungs ${rungs.map(r => `${r.atKeyVersion}->${r.targetKeyVersion}`).join(",")} @${seq}`),
        };
        const created = new SpaceService({createGroupRepository: () => ({getKeyHeads: async () => new Map()})} as never, null as never, "h" as types.core.Host,
            null as never, null as never, {sendUpdatedSpace: () => undefined} as never, null as never, {} as Config);
        Object.assign(created, {
            getForChange: async () => ({space, user: {userId: standing === "manager" ? alice : bob, pubKey: pub, ownGroupIds: [], role: standing}}),
            reserveRotation: async () => {
                done.push("reserved");
                return [];
            },
            write: async (_space: unknown, _modifier: unknown, c: Partial<db.space.Space>, keys: (repo: typeof repository) => Promise<void>) => {
                changes = c;
                await keys(repository);
                return {...space, ...c};
            },
        });
        const run = async (extra: {prune?: boolean, repairRungs?: types.cloud.SpaceRung[]}) => {
            const original = SpaceService.assertStatement;
            SpaceService.assertStatement = () => standing;
            try {
                await created.rotateKey({} as never, {
                    id: space.id, keyId: "k5" as types.core.KeyId, keys: [entry(5, {userId: alice}), entry(5, {userId: bob})], rungs: rungsOf(5), expectedKeyVersion: 4,
                    statement: {seq: 9} as types.cloud.SpaceStatement, ...extra,
                }, "context/spaceRotateKey");
            }
            finally {
                SpaceService.assertStatement = original;
            }
        };
        return {run, done, changes: () => changes};
    }
    const invalidStatement = (e: unknown) => AppException.is(e, "SPACE_STATEMENT_INVALID");
    
    it("SECURITY: prune from a non-manager's standing is refused, before any budget is spent", async () => {
        const {run, done} = rotation("user");
        await assert.rejects(() => run({prune: true}), invalidStatement);
        assert.deepStrictEqual(done, []);
    });
    
    it("SECURITY: repair rungs from a non-manager's standing are refused", async () => {
        const {run, done} = rotation("user");
        await assert.rejects(() => run({repairRungs: [repair(4, 3)]}), invalidStatement);
        assert.deepStrictEqual(done, []);
    });
    
    it("a non-manager rotates without them, and prunes nothing", async () => {
        const {run, done, changes} = rotation("user");
        await run({prune: false, repairRungs: []});
        assert.ok(!done.some(x => x.startsWith("deleteKeysBelow")));
        assert.strictEqual(changes().keysPrunedBelow, undefined);
    });
    
    it("SECURITY: a manager's rotation without prune prunes nothing", async () => {
        const {run, done, changes} = rotation("manager");
        await run({});
        assert.deepStrictEqual(done, ["reserved", "insertKeys", "insertRungs 5->4 @9"]);
        assert.strictEqual(changes().keysPrunedBelow, undefined);
    });
    
    it("a manager's prune deletes the wraps below the new version and records it", async () => {
        const {run, done, changes} = rotation("manager");
        await run({prune: true});
        assert.ok(done.includes("deleteKeysBelow 5"), JSON.stringify(done));
        assert.strictEqual(changes().keysPrunedBelow, 5);
        assert.strictEqual(changes().keyVersion, 5);
    });
    
    it("a manager's repair rungs are stored beside the rotation's own, stamped with the request's seq", async () => {
        const {run, done} = rotation("manager", new Map([["4/3", 3]]));
        await run({repairRungs: [repair(4, 3), repair(3, 2)]});
        assert.ok(done.includes("insertRungs 5->4,4->3,3->2 @9"), JSON.stringify(done));
    });
    
    it("SECURITY: the 5th rung of a span is refused, and nothing is stored", async () => {
        const {run, done} = rotation("manager", new Map([["4/3", 4]]));
        await assert.rejects(() => run({repairRungs: [repair(4, 3)]}), (e: unknown) => AppException.is(e, "SPACE_KEYS_INVALID"));
        assert.ok(!done.some(x => x.startsWith("insertRungs")));
    });
    
    it("SECURITY: a repair has to be one canonical span below the new version, once, with data, within the rung cap", () => {
        SpaceService.assertRepairs([repair(4, 3), repair(4, 2), repair(2, 1), repair(3, 2)], 5, 1);
        refused(() => SpaceService.assertRepairs([repair(5, 4)], 5, 1));
        refused(() => SpaceService.assertRepairs([repair(6, 5)], 5, 1));
        refused(() => SpaceService.assertRepairs([repair(4, 1)], 5, 1));
        refused(() => SpaceService.assertRepairs([repair(3, 4)], 5, 1));
        refused(() => SpaceService.assertRepairs([repair(4, 3), repair(4, 3)], 5, 1));
        refused(() => SpaceService.assertRepairs([{...repair(4, 3), data: "" as types.core.Base64}], 5, 1));
        const many = Array.from({length: 60}, (_, i) => repair(i + 2, i + 1));
        SpaceService.assertRepairs(many.slice(0, 63), 100, 1);
        refused(() => SpaceService.assertRepairs(many.slice(0, 60), 100, 5));
    });
});

describe("a space's rungs are append-only, several per span", () => {
    it("identifies a rung by its span and the seq of its request, so a repair lands beside the original", async () => {
        const inserted: {_id?: string, id?: string}[] = [];
        const rungs = {collection: {insertMany: async (docs: {id: string}[]) => inserted.push(...docs)}, getOptions: () => ({}), convertToDbObj: (x: unknown) => x};
        const repo = new SpaceRepository(null as never, null as never, null as never, null as never, rungs as never);
        const span = {atKeyVersion: 4, targetKeyVersion: 3, data: "AA==" as types.core.Base64};
        await repo.insertRungs("s1" as types.space.SpaceId, [span], 4);
        await repo.insertRungs("s1" as types.space.SpaceId, [span], 9);
        assert.deepStrictEqual(inserted.map(d => d.id), ["s1/4/3/4", "s1/4/3/9"]);
    });
});

describe("a rotation's wraps replace the older versions'", () => {
    it("deletes every wrap below the new version, whoever it was for", async () => {
        const deleted: unknown[] = [];
        const keys = {collection: {deleteMany: async (filter: unknown) => deleted.push(filter)}, getOptions: () => ({})};
        await new SpaceRepository(null as never, keys as never, null as never, null as never, null as never).deleteKeysBelow("s1" as types.space.SpaceId, 7);
        assert.deepStrictEqual(deleted, [{spaceId: "s1", keyVersion: {$lt: 7}}]);
    });
});

describe("the spaces naming a group are read projected and a batch at a time", () => {
    it("reads only what a notice needs, through a cursor", async () => {
        const asked: {filter: unknown, options: {projection?: object, batchSize?: number}}[] = [];
        const docs = [{_id: "s1", contextId: "c", keyVersion: 2, groups: [{groupId: g1}], users: []}, {_id: "s2", contextId: "c", keyVersion: 1, groups: [{groupId: g1}], users: [{userId: alice}]}];
        const spaces = {
            collection: {find: (filter: unknown, options: {projection?: object, batchSize?: number}) => {
                asked.push({filter, options});
                return (async function* () {
                    yield* docs;
                })();
            }},
            getOptions: (options: object) => options,
            convertFromDbObjEx: (doc: {_id: string}) => ({...doc, id: doc._id}),
        };
        const repo = new SpaceRepository(spaces as never, null as never, null as never, null as never, null as never);
        const seen: string[] = [];
        await repo.forEachByGroup(g1, space => {
            seen.push(space.id);
        });
        assert.deepStrictEqual(seen, ["s1", "s2"]);
        assert.deepStrictEqual(asked[0].filter, {"groups.groupId": g1});
        assert.ok(asked[0].options.batchSize! > 0, "a cursor batch, not one array");
        const fields = Object.keys(asked[0].options.projection!);
        assert.ok(!fields.includes("publicMeta") && !fields.includes("privateMeta") && !fields.includes("statement"), "no metadata nor statement");
    });
});
