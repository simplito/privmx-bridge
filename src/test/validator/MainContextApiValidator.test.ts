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
import { Base58 } from "../../utils/crypto/Base58";
import { buildTree, rotationGrantEdge, rungsFor, signStatement, userKeys } from "../testUtils/TreeFixtures";

const groupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const keyId = "MyKeyId" as types.core.KeyId;
const resourceId = "8b3f4c2e-1d5a-4e6b-9c7d-0a1b2c3d4e5f" as types.core.ClientResourceId;

/** A well-shaped statement — the validator checks shape only; what it says is the service's to check. */
function validStatement(op: types.cloud.GroupTreeCommitOp = "add"): types.cloud.GroupTreeCommitStatement {
    return signStatement({
        seq: 2, prevDigest: "12".repeat(32), op, groupId: groupId, treeVersion: 2, date: 1760000000000, keyVersion: 1, groupPubKey: groupPubKey, rosterVersion: 2,
        rosterHash: "ab".repeat(32), treeHash: "cd".repeat(32), policyHash: "99".repeat(32), committer: "janek" as types.cloud.UserId,
        committerPubKey: userKeys("janek").pub58, committerSeat: 0,
        path: [{nodeIndex: 3, generation: 1, publicKey: groupPubKey as unknown as types.core.EccPubKey, subtreeHash: "ef".repeat(32)}],
        addedUsers: ["nowy" as types.cloud.UserId], addedManagers: [], removed: [],
        ...(op === "create" || op === "policy" ? {policy: {update: "user"}} : {}),
    });
}

function validator() {
    return new ContextApiValidator(new TypesValidator());
}

function validGroupCreate(): contextApi.GroupCreateModel {
    return {
        contextId: contextId,
        resourceId: resourceId,
        groupPubKey: groupPubKey,
        users: ["janek"] as types.cloud.UserId[],
        managers: ["janek"] as types.cloud.UserId[],
        data: "someData" as types.group.GroupData,
        publicMeta: "somePublicMeta" as types.group.GroupData,
        privateMeta: "somePrivateMeta" as types.group.GroupData,
        keyId: keyId,
        tree: buildTree(["janek"], 1),
        commit: validStatement("create"),
    };
}

it("ContextApiValidator.groupCreate valid", () => {
    const result = Utils.try(() => validator().validate("groupCreate", validGroupCreate()));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupCreate requires a resourceId, which the first statement names the group by", () => {
    const model: Partial<contextApi.GroupCreateModel> = validGroupCreate();
    delete model.resourceId;
    const result = Utils.try(() => validator().validate("groupCreate", model));
    expect(result.success).toBe(false);
});

it("groupCreate and groupUpdatePolicy refuse a statement without its policy", () => {
    const create = validGroupCreate();
    delete create.commit.policy;
    expect(Utils.try(() => validator().validate("groupCreate", create)).success).toBe(false);
    const commit = validStatement("policy");
    delete commit.policy;
    expect(Utils.try(() => validator().validate("groupUpdatePolicy", {id: groupId, commit, expectedKeyVersion: 1, expectedRosterVersion: 2})).success).toBe(false);
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

/** The same point spelled every way but compressed, plus a point off the curve; elliptic decodes them all. */
function nonCanonicalSpellings(key: types.cloud.GroupPubKey): Record<string, types.cloud.GroupPubKey> {
    const point = ECUtils.publicFromBase58DER(key as unknown as types.core.EccPubKey)!;
    const uncompressed = Buffer.from(point.getPublic(false, "hex"), "hex");
    const hybrid = Buffer.from(uncompressed);
    hybrid[0] = 0x06 + uncompressed[64] % 2;
    const offCurve = Buffer.from(uncompressed);
    offCurve[64] = offCurve[64] % 2 === 0 ? offCurve[64] + 1 : offCurve[64] - 1;
    const encode = (bytes: Buffer) => Base58.encodeWithChecksum(bytes) as unknown as types.cloud.GroupPubKey;
    return {uncompressed: encode(uncompressed), hybrid: encode(hybrid), offCurve: encode(offCurve)};
}

it("SECURITY: a group public key in any encoding but the compressed one is refused", () => {
    // Keys are compared as strings (the statement's key against the model's): the same key re-encoded
    // would pass for a new one everywhere.
    const tree = buildTree(["janek"], 1);
    const calls: [string, (key: types.cloud.GroupPubKey) => unknown][] = [
        ["groupCreate", key => ({...validGroupCreate(), groupPubKey: key, commit: {...validStatement("create"), groupPubKey: key}})],
        ["groupGenerateNewKey", key => ({
            id: groupId, groupPubKey: key, data: "someData", keyId: keyId, grantEdge: rotationGrantEdge(tree, 2),
            commit: {...validStatement("rotate"), groupPubKey: key}, rungs: rungsFor(2, 1), expectedKeyVersion: 1, expectedRosterVersion: 1,
        })],
        ["groupRemoveMembers", key => ({
            id: groupId, userIds: ["ola"], groupPubKey: key, keyId: keyId, data: "someData", transition: validRemovalTransition(),
            commit: {...validStatement("remove"), groupPubKey: key}, rungs: [{atKeyVersion: 2, targetKeyVersion: 1, data: "rung"}],
            expectedKeyVersion: 1, expectedRosterVersion: 1,
        })],
    ];
    for (const [method, model] of calls) {
        expect(Utils.try(() => validator().validate(method, model(groupPubKey))).success).toBe(true);
        // The models differ from the accepted one in the key alone, so the key is what is refused.
        for (const key of Object.values(nonCanonicalSpellings(groupPubKey))) {
            expect(Utils.try(() => validator().validate(method, model(key))).success).toBe(false);
        }
        // The statement's own key is checked too, not only the model's.
        const statementOnly = model(groupPubKey) as {commit: types.cloud.GroupTreeCommitStatement};
        statementOnly.commit = {...statementOnly.commit, groupPubKey: nonCanonicalSpellings(groupPubKey).uncompressed};
        expect(Utils.try(() => validator().validate(method, statementOnly)).success).toBe(false);
    }
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
    const model: contextApi.GroupUpdatePolicyModel = {id: groupId, commit: validStatement("policy"), expectedKeyVersion: 1, expectedRosterVersion: 2};
    const result = Utils.try(() => validator().validate("groupUpdatePolicy", model));
    expect(result.success).toBe(true);
});

it("SECURITY: groupUpdatePolicy without a statement, the old {id, policy} shape, is refused", () => {
    expect(Utils.try(() => validator().validate("groupUpdatePolicy", {id: groupId, policy: {}})).success).toBe(false);
    const model = {id: groupId, commit: validStatement("policy"), expectedKeyVersion: 1, expectedRosterVersion: 2, policy: {}};
    expect(Utils.try(() => validator().validate("groupUpdatePolicy", model)).success).toBe(false);
});

it("a statement's policy is shaped like a container policy, and its policyHash is a hash", () => {
    const badPolicy = {...validStatement("policy"), policy: {update: 5}};
    expect(Utils.try(() => validator().validate("groupUpdatePolicy", {id: groupId, commit: badPolicy, expectedKeyVersion: 1, expectedRosterVersion: 2})).success).toBe(false);
    const badHash = {...validStatement("policy"), policyHash: "XY"};
    expect(Utils.try(() => validator().validate("groupUpdatePolicy", {id: groupId, commit: badHash, expectedKeyVersion: 1, expectedRosterVersion: 2})).success).toBe(false);
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

it("groupUpdatePolicy carries no envelope and no metadata version", () => {
    // A policy commit writes neither plane: nothing to write under a key and no metadata counter to compare.
    for (const field of ["data", "keyId", "version"]) {
        const model = {id: groupId, commit: validStatement("policy"), expectedKeyVersion: 1, expectedRosterVersion: 2, [field]: "x"};
        const result = Utils.try(() => validator().validate("groupUpdatePolicy", model));
        expect(result.success).toBe(false);
    }
});

it("groupUpdatePolicy requires its statement and both CAS counters", () => {
    for (const field of ["commit", "expectedKeyVersion", "expectedRosterVersion"]) {
        const model: Record<string, unknown> = {id: groupId, commit: validStatement("policy"), expectedKeyVersion: 1, expectedRosterVersion: 2};
        delete model[field];
        expect(Utils.try(() => validator().validate("groupUpdatePolicy", model)).success).toBe(false);
    }
});

it("groupCreate takes no policy beside its statement", () => {
    expect(Utils.try(() => validator().validate("groupCreate", {...validGroupCreate(), policy: {}})).success).toBe(false);
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
        commit: validStatement("rotate"),
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
        commit: validStatement("add"),
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
        commit: validStatement("add"),
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
        commit: validStatement("remove"),
        rungs: [{atKeyVersion: 2, targetKeyVersion: 1, data: "rung" as types.core.UserKeyData}],
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupRemoveMembers", model));
    expect(result.success).toBe(true);
});

it("SECURITY: a tree node public key in any encoding but the compressed one is refused", () => {
    // NODE_NOT_NEW compares node keys as strings: a replaced node key re-encoded would pass for a fresh one.
    const removal = (publicKey: types.core.EccPubKey) => {
        const transition = validRemovalTransition();
        transition.refreshedNodes[0].publicKey = publicKey;
        return {
            id: groupId, userIds: ["ola"], groupPubKey: groupPubKey, keyId: keyId, data: "someData", transition: transition,
            commit: validStatement("remove"), rungs: [{atKeyVersion: 2, targetKeyVersion: 1, data: "rung"}],
            expectedKeyVersion: 1, expectedRosterVersion: 1,
        };
    };
    expect(Utils.try(() => validator().validate("groupRemoveMembers", removal(nodePubKey))).success).toBe(true);
    const uncompressed = ECUtils.publicToBase58DER(ECUtils.publicFromBase58DER(nodePubKey)!, false);
    expect(Utils.try(() => validator().validate("groupRemoveMembers", removal(uncompressed))).success).toBe(false);
});

it("ContextApiValidator.groupRemoveMembers rejects a rung with epoch zero", () => {
    const model = {
        id: groupId,
        userIds: ["ola" as types.cloud.UserId],
        groupPubKey: groupPubKey,
        keyId: keyId,
        data: "someData" as types.group.GroupData,
        transition: validRemovalTransition(),
        commit: validStatement("remove"),
        rungs: [{atKeyVersion: 0, targetKeyVersion: 0, data: "rung" as types.core.UserKeyData}],
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupRemoveMembers", model));
    expect(result.success).toBe(false);
});

it("SECURITY: groupRemoveMembers refuses a rung naming a recipientKind", () => {
    // An era link `{recipientKind: "user", recipient}` sealed to anybody's key would pass as the unit rung, which
    // clients never open, so the epoch would be born unreachable from below. Every rung is an epoch rung.
    const model = {
        id: groupId,
        userIds: ["ola" as types.cloud.UserId],
        groupPubKey: groupPubKey,
        keyId: keyId,
        data: "someData" as types.group.GroupData,
        transition: validRemovalTransition(),
        commit: validStatement("remove"),
        rungs: [{atKeyVersion: 2, targetKeyVersion: 1, recipientKind: "user", recipient: "ola", data: "rung" as types.core.UserKeyData}],
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupRemoveMembers", model));
    expect(result.success).toBe(false);
});

it("SECURITY: groupGenerateNewKey refuses a rung naming an author", () => {
    // The author of a stored rung is whoever stored it, set by the bridge; a client cannot name somebody else.
    const tree = buildTree(["janek"], 1);
    const model = {
        id: groupId,
        groupPubKey: groupPubKey,
        data: "someData" as types.group.GroupData,
        keyId: keyId,
        grantEdge: rotationGrantEdge(tree, 2),
        commit: validStatement("rotate"),
        rungs: rungsFor(2, 1).map(rung => ({...rung, author: "ola"})),
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupGenerateNewKey", model));
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
        commit: validStatement("remove"),
        expectedKeyVersion: 1,
        expectedRosterVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupRemoveMembers", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupSelfUpdate valid, with a node minted from no record", () => {
    const model: contextApi.GroupSelfUpdateModel = {
        id: groupId,
        commit: validStatement("selfUpdate"),
        transition: {
            baseKeyVersion: 1,
            refreshedNodes: [
                {nodeIndex: 31, generation: 0, publicKey: nodePubKey},
                {nodeIndex: 63, fromGeneration: 4, generation: 5, publicKey: nodePubKey},
            ],
            edges: [
                {parentIndex: 63, parentGeneration: 5, childKind: "node", childIndex: 31, childGeneration: 0, data: "w1" as types.core.UserKeyData},
                {isGrantEdge: true, parentGeneration: 1, childKind: "node", childIndex: 63, childGeneration: 5, data: "w2" as types.core.UserKeyData},
            ],
        },
        expectedKeyVersion: 1,
    };
    const result = Utils.try(() => validator().validate("groupSelfUpdate", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupSelfUpdate refuses anything but its own fields", () => {
    // No seats, no rungs, no keys: a self-update moves nothing but the caller's own path.
    const model = {id: groupId, transition: {...validRemovalTransition()}, expectedKeyVersion: 1};
    const result = Utils.try(() => validator().validate("groupSelfUpdate", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupGet accepts the planning scope", () => {
    const result = Utils.try(() => validator().validate("groupGet", {groupId: groupId, scope: "plan"}));
    expect(result.success).toBe(true);
    const unknown = Utils.try(() => validator().validate("groupGet", {groupId: groupId, scope: "everything"}));
    expect(unknown.success).toBe(false);
});

it("ContextApiValidator.groupGetTreeCommits valid, with and without an upper bound", () => {
    expect(Utils.try(() => validator().validate("groupGetTreeCommits", {groupId, fromSeq: 0})).success).toBe(true);
    expect(Utils.try(() => validator().validate("groupGetTreeCommits", {groupId, fromSeq: 4, toSeq: 9})).success).toBe(true);
    expect(Utils.try(() => validator().validate("groupGetTreeCommits", {groupId, fromSeq: -1})).success).toBe(false);
    expect(Utils.try(() => validator().validate("groupGetTreeCommits", {groupId, fromSeq: 0, toSeq: 0})).success).toBe(false);
});

it("ContextApiValidator refuses a tree commit without its statement, or with a malformed one", () => {
    const withoutCommit: Partial<contextApi.GroupCreateModel> = validGroupCreate();
    delete withoutCommit.commit;
    expect(Utils.try(() => validator().validate("groupCreate", withoutCommit)).success).toBe(false);
    const malformed: Partial<types.cloud.GroupTreeCommitStatement>[] = [
        {treeHash: "AB".repeat(32)},
        {rosterHash: "ab".repeat(31)},
        {signature: "AAAA" as types.core.EccSignature},
        {op: "merge" as types.cloud.GroupTreeCommitOp},
        {seq: 0},
        {prevDigest: "AB".repeat(32)},
        {prevDigest: "ab"},
        {committerSeat: -1},
        {path: [{...validStatement().path[0], subtreeHash: "ab"}]},
    ];
    for (const patch of malformed) {
        const model = {...validGroupCreate(), commit: {...validStatement("create"), ...patch}};
        expect(Utils.try(() => validator().validate("groupCreate", model)).success).toBe(false);
    }
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

it("ContextApiValidator's lookup limits are the ones the Endpoint is built with", () => {
    // Endpoint GroupApiImpl::MAX_ARCHIVE_SPANS asks for at most 128 spans; a lower limit here refuses its asks.
    expect(ContextApiValidator.MAX_ARCHIVE_SPANS).toBe(128);
    expect(ContextApiValidator.MAX_EPOCH_KEY_LOOKUPS).toBe(32);
});

it("ContextApiValidator.groupGetKeyArchive takes a bounded list of spans", () => {
    const span = {at: 8, target: 4};
    expect(Utils.try(() => validator().validate("groupGetKeyArchive", {id: groupId, spans: [span]})).success).toBe(true);
    const full = Array.from({length: 128}, () => span);
    expect(Utils.try(() => validator().validate("groupGetKeyArchive", {id: groupId, spans: full})).success).toBe(true);
    expect(Utils.try(() => validator().validate("groupGetKeyArchive", {id: groupId, spans: [...full, span]})).success).toBe(false);
    expect(Utils.try(() => validator().validate("groupGetKeyArchive", {id: groupId, spans: [{at: 0, target: 1}]})).success).toBe(false);
});

it("ContextApiValidator.groupGetEpochKeys takes bounded lists of keyIds and grant keys", () => {
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, keyIds: ["k1"], groupPubKeys: [groupPubKey]})).success).toBe(true);
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId})).success).toBe(true);
    const full = Array.from({length: 32}, (_, i) => `k${i}`);
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, keyIds: full})).success).toBe(true);
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, keyIds: [...full, "k32"]})).success).toBe(false);
    const keys = Array.from({length: 32}, () => groupPubKey);
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, groupPubKeys: keys})).success).toBe(true);
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, groupPubKeys: [...keys, groupPubKey]})).success).toBe(false);
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, groupPubKeys: ["not a key"]})).success).toBe(false);
    // Each keyId is a keyId: not empty, not longer than one may be.
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, keyIds: [""]})).success).toBe(false);
    expect(Utils.try(() => validator().validate("groupGetEpochKeys", {id: groupId, keyIds: ["k".repeat(129)]})).success).toBe(false);
});

it("ContextApiValidator.groupSendCustomEvent valid without a recipient list", () => {
    const model: contextApi.GroupSendCustomEventModel = {
        groupId: groupId,
        channel: "typing" as types.core.WsChannelName,
        data: "base64EnvelopeGoesHere",
    };
    const result = Utils.try(() => validator().validate("groupSendCustomEvent", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupSendCustomEvent valid with a recipient list", () => {
    const model: contextApi.GroupSendCustomEventModel = {
        groupId: groupId,
        channel: "typing" as types.core.WsChannelName,
        data: "base64EnvelopeGoesHere",
        users: ["janek"] as types.cloud.UserId[],
    };
    const result = Utils.try(() => validator().validate("groupSendCustomEvent", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupSendCustomEvent rejects a payload over the 16 KB ceiling", () => {
    // A notification is not a container. Anything this size belongs in a Store, with the event pointing at it.
    const model: contextApi.GroupSendCustomEventModel = {
        groupId: groupId,
        channel: "typing" as types.core.WsChannelName,
        data: "x".repeat(17 * 1024),
    };
    const result = Utils.try(() => validator().validate("groupSendCustomEvent", model));
    expect(result.success).toBe(false);
});
