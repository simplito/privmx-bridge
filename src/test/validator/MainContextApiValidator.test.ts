/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../types";
import * as contextApi from "../../api/main/context/ContextApiTypes";
import { ContextApiValidator } from "../../api/main/context/ContextApiValidator";
import { TypesValidator } from "../../api/TypesValidator";
import { Utils } from "../../utils/Utils";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { buildTree, rotationGrantEdge, rungsFor } from "../testUtils/TreeFixtures";

const groupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const keyId = "MyKeyId" as types.core.KeyId;

function validator() {
    return new ContextApiValidator(new TypesValidator());
}

function validGroupCreate(): contextApi.GroupCreateModel {
    return {
        contextId: contextId,
        groupPubKey: groupPubKey,
        users: ["janek"] as types.cloud.UserId[],
        managers: ["janek"] as types.cloud.UserId[],
        data: "someData" as types.group.GroupData,
        publicMeta: "somePublicMeta" as types.group.GroupData,
        privateMeta: "somePrivateMeta" as types.group.GroupData,
        keyId: keyId,
        tree: buildTree(["janek"], 1),
    };
}

it("ContextApiValidator.groupCreate valid", () => {
    const result = Utils.try(() => validator().validate("groupCreate", validGroupCreate()));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupCreate accepts the data a group of sixteen thousand needs", () => {
    // A group's data carries the endpoint's DIO, which names every member, so it grows with the roster where a
    // thread's or a store's does not. Measured against a live bridge: ~19 B per member — 154 KB at 8 190 members.
    // The old 16 KB ceiling stopped a tree-backed group at ~870, which is not the scale the tree is for.
    const model = {...validGroupCreate(), data: "x".repeat(400 * 1024) as unknown as types.group.GroupData};
    const result = Utils.try(() => validator().validate("groupCreate", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupCreate still refuses data past a megabyte", () => {
    const model = {...validGroupCreate(), data: "x".repeat(1024 * 1024 + 1) as unknown as types.group.GroupData};
    const result = Utils.try(() => validator().validate("groupCreate", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupCreate rejects invalid groupPubKey", () => {
    const model = {...validGroupCreate(), groupPubKey: "not-a-valid-ecc-key!!!" as types.cloud.GroupPubKey};
    const result = Utils.try(() => validator().validate("groupCreate", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupCreate rejects a leftover meta field", () => {
    // An old client on the single-envelope API must be told, not have a group created for it with half a
    // contract — the metadata it thinks it wrote would simply not be there.
    const model: Record<string, unknown> = {...validGroupCreate(), meta: "someMeta"};
    delete model.publicMeta;
    delete model.privateMeta;
    const result = Utils.try(() => validator().validate("groupCreate", model));
    expect(result.success).toBe(false);
});

function validPublicMetaUpdate() {
    return {
        id: groupId,
        data: "someData" as types.group.GroupData,
        keyId: keyId,
        version: 1 as types.group.GroupVersion,
    };
}

it("ContextApiValidator.groupUpdatePublicMeta valid", () => {
    const model: contextApi.GroupUpdatePublicMetaModel = validPublicMetaUpdate();
    const result = Utils.try(() => validator().validate("groupUpdatePublicMeta", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupUpdatePrivateMeta valid", () => {
    const model: contextApi.GroupUpdatePrivateMetaModel = validPublicMetaUpdate();
    const result = Utils.try(() => validator().validate("groupUpdatePrivateMeta", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupUpdatePolicy valid", () => {
    const model: contextApi.GroupUpdatePolicyModel = {id: groupId, policy: {}};
    const result = Utils.try(() => validator().validate("groupUpdatePolicy", model));
    expect(result.success).toBe(true);
});

// These are the load-bearing rejections: each one is why the per-plane ACL entry bounds what a call can *do*
// rather than only what it is meant for. `createObject` is strict, so a request structurally cannot carry a
// field from a plane its grant does not cover.
it("a metadata update structurally cannot carry the other plane, or the policy", () => {
    const cases: [string, string][] = [
        ["groupUpdatePublicMeta", "privateMeta"],
        ["groupUpdatePublicMeta", "policy"],
        ["groupUpdatePrivateMeta", "publicMeta"],
        ["groupUpdatePrivateMeta", "policy"],
    ];
    for (const [method, field] of cases) {
        const model = {...validPublicMetaUpdate(), [field]: "smuggled"};
        const result = Utils.try(() => validator().validate(method, model));
        expect(result.success).toBe(false);
    }
});

it("groupUpdatePolicy carries neither an envelope nor a version", () => {
    // No envelope and no CAS on this method: there is nothing to write under a key and no counter to compare.
    for (const field of ["data", "keyId", "version"]) {
        const model = {id: groupId, policy: {}, [field]: "x"};
        const result = Utils.try(() => validator().validate("groupUpdatePolicy", model));
        expect(result.success).toBe(false);
    }
});

it("groupUpdatePolicy requires a policy", () => {
    // It used to be optional, where absent meant "leave the policy alone". On a method that does nothing else,
    // an absent policy is a request that asks for nothing and has passed a policy gate for it.
    const result = Utils.try(() => validator().validate("groupUpdatePolicy", {id: groupId}));
    expect(result.success).toBe(false);
});

it("a metadata update cannot omit its version or its keyId", () => {
    for (const field of ["version", "keyId"]) {
        const model: Record<string, unknown> = validPublicMetaUpdate();
        delete model[field];
        const result = Utils.try(() => validator().validate("groupUpdatePublicMeta", model));
        expect(result.success).toBe(false);
    }
});

it("a metadata update rejects a force field", () => {
    // Groups have no version-check override: the entry commits a tag over the version it lands at, so a stale
    // update could only publish a tag no client would accept. A caller still sending `force` is using an API
    // that no longer exists and has to be told, not silently accepted.
    const model = {...validPublicMetaUpdate(), force: false};
    const result = Utils.try(() => validator().validate("groupUpdatePublicMeta", model));
    expect(result.success).toBe(false);
});

it("groupUpdate is gone", () => {
    // The one place the removal is catchable. A surviving registration would be an endpoint with no handler:
    // `BaseApi.execute` answers METHOD_NOT_FOUND while the validator quietly keeps accepting the request.
    const result = Utils.try(() => validator().validate("groupUpdate", validPublicMetaUpdate()));
    expect(result.success).toBe(false);
});

it("each metadata plane still refuses data past a megabyte", () => {
    // Each plane is capped independently, so a group's create body can now carry three of these.
    for (const method of ["groupUpdatePublicMeta", "groupUpdatePrivateMeta"]) {
        const model = {...validPublicMetaUpdate(), data: "x".repeat(1024 * 1024 + 1) as unknown as types.group.GroupData};
        const result = Utils.try(() => validator().validate(method, model));
        expect(result.success).toBe(false);
    }
});

it("ContextApiValidator.groupGet valid", () => {
    const result = Utils.try(() => validator().validate("groupGet", {groupId: groupId}));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupList valid with sortBy", () => {
    const model: contextApi.GroupListModel = {
        contextId: contextId,
        skip: 0,
        limit: 10,
        sortOrder: "asc",
        sortBy: "createDate",
    };
    const result = Utils.try(() => validator().validate("groupList", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupList rejects invalid sortBy", () => {
    const model = {
        contextId: contextId,
        skip: 0,
        limit: 10,
        sortOrder: "asc",
        sortBy: "nonsense",
    };
    const result = Utils.try(() => validator().validate("groupList", model));
    expect(result.success).toBe(false);
});

// ---------- Phase 2: generateNewGroupKey + the metadata planes' epoch CAS ----------

it("ContextApiValidator.groupGenerateNewKey valid", () => {
    const tree = buildTree(["janek"], 1);
    const model: contextApi.GroupGenerateNewKeyModel = {
        id: groupId,
        groupPubKey: groupPubKey,
        data: "someData" as types.group.GroupData,
        keyId: keyId,
        grantEdge: rotationGrantEdge(tree, 2),
        rungs: rungsFor(2, 1),
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupGenerateNewKey", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupGenerateNewKey rejects missing expectedKeyVersion", () => {
    const model = {
        id: groupId,
        groupPubKey: groupPubKey,
        data: "someData" as types.group.GroupData,
        keyId: keyId,
        keys: [],
    };
    const result = Utils.try(() => validator().validate("groupGenerateNewKey", model));
    expect(result.success).toBe(false);
});

// ---------- Hidden key tree + Epoch Ladder ----------

const nodePubKey = ECUtils.generateKeyPair().pub58 as unknown as types.core.EccPubKey;

/** Two members, one internal node, one grant edge — the smallest tree the wire format accepts. */
function validTree(): types.cloud.GroupTreeState {
    return {
        numLeaves: 2,
        leafAssignment: ["janek", "ola"] as types.cloud.UserId[],
        nodes: [{nodeIndex: 1, generation: 0, publicKey: nodePubKey}],
        edges: [
            {parentIndex: 1, parentGeneration: 0, childKind: "user", childUserId: "janek" as types.cloud.UserId, data: "w1" as types.core.UserKeyData},
            {parentIndex: 1, parentGeneration: 0, childKind: "user", childUserId: "ola" as types.cloud.UserId, data: "w2" as types.core.UserKeyData},
            {isGrantEdge: true, parentGeneration: 1, childKind: "node", childIndex: 1, childGeneration: 0, data: "w3" as types.core.UserKeyData},
        ],
    };
}

/** The delta shapes the membership calls take: one refreshed/seated node, the edges around it. */
function validRemovalTransition(): types.cloud.GroupTreeTransition {
    return {
        baseKeyVersion: 1,
        blankedPositions: [1],
        refreshedNodes: [{nodeIndex: 1, fromGeneration: 0, generation: 1, publicKey: nodePubKey}],
        edges: [
            {parentIndex: 1, parentGeneration: 1, childKind: "user", childUserId: "janek" as types.cloud.UserId, data: "w1" as types.core.UserKeyData},
            {isGrantEdge: true, parentGeneration: 2, childKind: "node", childIndex: 1, childGeneration: 1, data: "w3" as types.core.UserKeyData},
        ],
    };
}

function validAdditionTransition(): types.cloud.GroupTreeAdditionTransition {
    return {
        baseKeyVersion: 1,
        positions: [2],
        seatedNodes: [{nodeIndex: 3, generation: 0, publicKey: nodePubKey}],
        edges: [
            {parentIndex: 3, parentGeneration: 0, childKind: "node", childIndex: 1, childGeneration: 0, data: "w1" as types.core.UserKeyData},
            {parentIndex: 3, parentGeneration: 0, childKind: "user", childUserId: "nowy" as types.cloud.UserId, data: "w2" as types.core.UserKeyData},
            {isGrantEdge: true, parentGeneration: 1, childKind: "node", childIndex: 3, childGeneration: 0, data: "w3" as types.core.UserKeyData},
        ],
    };
}

it("ContextApiValidator.groupCreate accepts a tree", () => {
    const model: contextApi.GroupCreateModel = {...validGroupCreate(), tree: validTree()};
    const result = Utils.try(() => validator().validate("groupCreate", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupCreate accepts a blank leaf in leafAssignment", () => {
    const tree = validTree();
    tree.leafAssignment = ["janek", ""] as types.cloud.UserId[];
    const result = Utils.try(() => validator().validate("groupCreate", {...validGroupCreate(), tree}));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupCreate rejects a tree with numLeaves below one", () => {
    const tree = {...validTree(), numLeaves: 0};
    const result = Utils.try(() => validator().validate("groupCreate", {...validGroupCreate(), tree}));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupCreate rejects an unknown child kind", () => {
    const tree = validTree();
    (tree.edges[0] as {childKind: string}).childKind = "epoch";
    const result = Utils.try(() => validator().validate("groupCreate", {...validGroupCreate(), tree}));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupAddMembers valid", () => {
    const model: contextApi.GroupAddMembersModel = {
        id: groupId,
        members: [{userId: "nowy" as types.cloud.UserId, role: "user"}],
        keyId: keyId,
        data: "someData" as types.group.GroupData,
        transition: validAdditionTransition(),
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupAddMembers", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupAddMembers rejects an unknown role", () => {
    const model = {
        id: groupId,
        members: [{userId: "nowy" as types.cloud.UserId, role: "owner"}],
        keyId: keyId,
        data: "someData" as types.group.GroupData,
        transition: validAdditionTransition(),
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupAddMembers", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupRemoveMembers valid", () => {
    const model: contextApi.GroupRemoveMembersModel = {
        id: groupId,
        userIds: ["ola" as types.cloud.UserId],
        groupPubKey: groupPubKey,
        keyId: keyId,
        data: "someData" as types.group.GroupData,
        transition: validRemovalTransition(),
        rungs: [{atKeyVersion: 2, targetKeyVersion: 1, data: "rung" as types.core.UserKeyData}],
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupRemoveMembers", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupRemoveMembers rejects a rung with epoch zero", () => {
    const model = {
        id: groupId,
        userIds: ["ola" as types.cloud.UserId],
        groupPubKey: groupPubKey,
        keyId: keyId,
        data: "someData" as types.group.GroupData,
        transition: validRemovalTransition(),
        rungs: [{atKeyVersion: 0, targetKeyVersion: 0, data: "rung" as types.core.UserKeyData}],
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupRemoveMembers", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupRemoveMembers rejects a missing rung list", () => {
    // The rungs are not optional: a new epoch without them orphans the group's own history.
    const model = {
        id: groupId,
        userIds: ["ola" as types.cloud.UserId],
        groupPubKey: groupPubKey,
        keyId: keyId,
        data: "someData" as types.group.GroupData,
        transition: validRemovalTransition(),
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupRemoveMembers", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupCutEra valid", () => {
    const model: contextApi.GroupCutEraModel = {id: groupId, newFloor: 5, expectedKeyVersion: 9};
    const result = Utils.try(() => validator().validate("groupCutEra", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupCutEra rejects a floor below one", () => {
    const result = Utils.try(() => validator().validate("groupCutEra", {id: groupId, newFloor: 0, expectedKeyVersion: 9}));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupPruneArchive valid", () => {
    const model: contextApi.GroupPruneArchiveModel = {id: groupId, belowEpoch: 4, expectedKeyVersion: 9};
    const result = Utils.try(() => validator().validate("groupPruneArchive", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupGetKeyArchive valid without a window", () => {
    const result = Utils.try(() => validator().validate("groupGetKeyArchive", {id: groupId}));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupGetKeyArchive valid with a window", () => {
    const model: contextApi.GroupGetKeyArchiveModel = {id: groupId, fromKeyVersion: 2, toKeyVersion: 8};
    const result = Utils.try(() => validator().validate("groupGetKeyArchive", model));
    expect(result.success).toBe(true);
});
