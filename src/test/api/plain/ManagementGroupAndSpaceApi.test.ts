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
import { ApiMethod } from "../../../api/Decorators";
import { ManagementGroupApi } from "../../../api/plain/group/ManagementGroupApi";
import { ManagementSpaceApi } from "../../../api/plain/space/ManagementSpaceApi";
import { CommitStatement } from "../../../service/cloud/keytree/CommitStatement";

const alice = "alice" as types.cloud.UserId;
const bob = "bob" as types.cloud.UserId;
const gone = "gone" as types.cloud.UserId;

it("the backend's group and space APIs read and delete, and change nothing a member signs", () => {
    const methodsOf = (clazz: unknown) => ApiMethod.getExportedMethods(clazz as never).map(m => m.method).sort();
    assert.deepStrictEqual(methodsOf(ManagementGroupApi), ["deleteGroup", "deleteManyGroups", "getGroup", "listGroupCommits", "listGroups", "listGroupsOfUser"]);
    assert.deepStrictEqual(methodsOf(ManagementSpaceApi), ["deleteSpace", "getSpace", "listSpaces"]);
});

/** Rules other than the defaults, served as stored. */
const RULES: types.cloud.GroupRules = {...CommitStatement.DEFAULT_RULES, addMembers: "members", changeVisibility: "nobody"};

it("serves a group's members with roles and keys, its signed rules, and no private field", () => {
    const group = {
        id: "g" as types.group.GroupId, contextId: "c" as types.context.ContextId, creator: alice,
        createDate: 1 as types.core.Timestamp, lastModificationDate: 2 as types.core.Timestamp,
        // `gone` left the context and has no key there.
        users: [bob, gone], managers: [alice],
        keyVersion: 4, rosterVersion: 6, treeCommitSeq: 9,
        policy: RULES,
        leafAssignment: [alice, bob, gone], numLeaves: 4, keyId: "k" as types.core.KeyId,
    } as unknown as db.group.Group;
    const converted = ManagementGroupApi.convertGroup({group, pubKeys: new Map([[alice, "A" as types.cloud.UserPubKey], [bob, "B" as types.cloud.UserPubKey]]), publicMeta: "meta"});
    assert.deepStrictEqual(converted, {
        id: "g", contextId: "c", creator: alice, createDate: 1, lastModificationDate: 2,
        keyVersion: 4, rosterVersion: 6, lastCommitSeq: 9,
        members: [{userId: alice, pubKey: "A", role: "manager"}, {userId: bob, pubKey: "B", role: "user"}, {userId: gone, pubKey: null, role: "user"}],
        rules: RULES,
        visibleTo: "members",
        publicMeta: "meta",
    });
    // A group stored before the rules format: served, without rules.
    const legacy = ManagementGroupApi.convertGroup({group: {...group, policy: {update: "user"}} as unknown as db.group.Group, pubKeys: new Map(), publicMeta: "meta"});
    assert.strictEqual(legacy.rules, undefined);
});

it("serves a space without its keys and private metadata", () => {
    const space = {
        id: "s", contextId: "c", creator: alice, createDate: 1, lastModifier: alice, lastModificationDate: 2,
        groups: [], users: [{userId: alice, pubKey: "A", role: "manager"}], keyId: "k", keyVersion: 3,
        publicMeta: "pub", privateMeta: "priv", publicMetaVersion: 1, privateMetaVersion: 1, version: 5, clientResourceId: "r",
    } as unknown as db.space.Space;
    const converted = ManagementSpaceApi.convertSpace({space, keys: [{} as db.space.SpaceKey], keyIsStale: true});
    assert.deepStrictEqual(Object.keys(converted).sort(), ["contextId", "createDate", "creator", "groups", "id", "keyIsStale", "keyVersion", "lastModificationDate", "publicMeta", "users"]);
    assert.strictEqual(converted.keyIsStale, true);
});
