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
