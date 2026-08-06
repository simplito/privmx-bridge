/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-empty-function */

import "q2-test";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { CloudKeyService } from "../../../service/cloud/CloudKeyService";
import { GroupNotificationService } from "../../../service/cloud/GroupNotificationService";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { GroupService } from "../../../service/cloud/GroupService";
import { createMock, hasNoCalls, hasOneCall, mock } from "../../testUtils/TestUtils";
import { buildTree, cloneTree, refreshNodes, treeAfterRemoval } from "../../testUtils/TreeFixtures";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import * as mongodb from "mongodb";
import { ContextUserRepository } from "../../../service/cloud/ContextUserRepository";
import { DateUtils } from "../../../utils/DateUtils";
import { AppException } from "../../../api/AppException";
import { CloudAclChecker } from "../../../service/cloud/CloudAclChecker";
import { PolicyService } from "../../../service/cloud/PolicyService";
import { CloudUser } from "../../../CommonTypes";
import { CloudAccessValidator } from "../../../service/cloud/CloudAccessValidator";
import { ActiveUsersMap } from "../../../cluster/master/ipcServices/ActiveUsers";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { GroupRotationRateLimiter } from "../../../cluster/master/ipcServices/GroupRotationRateLimiter";
import { TreeMath } from "../../../service/cloud/keytree/TreeMath";
import { LadderMath } from "../../../service/cloud/keytree/LadderMath";

/**
 * Service-level tests for tree-backed group membership.
 *
 * What is under test is the bridge's half of the contract, and the bridge's half is entirely structural: it
 * cannot read a wrap, so it enforces that the client refreshed exactly the nodes a removal obliges it to
 * refresh, that an addition did not quietly rotate the epoch, and that no rung points upwards. The
 * cryptographic half — that each wrap really contains the key it claims — is the endpoint's, and is tested there.
 *
 * Tests marked SECURITY guard confidentiality and fail silently at runtime if the guard regresses.
 */

const solutionId = "MySolutionId" as types.cloud.SolutionId;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const keyId = "SomeKeyId" as types.core.KeyId;
const newKeyId = "AnotherKeyId" as types.core.KeyId;
const data = "SomeGroupData" as types.group.GroupData;

const janekKeys = ECUtils.generateKeyPair();
const janekPub = janekKeys.pub58 as types.cloud.UserPubKey;
const aliceKeys = ECUtils.generateKeyPair();
const alicePub = aliceKeys.pub58 as types.cloud.UserPubKey;
const groupPubKey = janekPub as unknown as types.cloud.GroupPubKey;
const nextGroupPubKey = alicePub as unknown as types.cloud.GroupPubKey;

const janek = "janek" as types.cloud.UserId;   // manager
const alice = "alice" as types.cloud.UserId;   // member
const bob = "bob" as types.cloud.UserId;       // member
const carol = "carol" as types.cloud.UserId;   // member
const dave = "dave" as types.cloud.UserId;     // outsider, seated by addMember

const SEATING = ["janek", "alice", "bob", "carol"];
const EPOCH = 5;

const janekCloudUser = new CloudUser(janekPub);
const aliceCloudUser = new CloudUser(alicePub);

const myContext: db.context.Context = {
    id: contextId,
    created: DateUtils.now(),
    modified: DateUtils.now(),
    description: "" as types.context.ContextDescription,
    name: "" as types.context.ContextName,
    scope: "private",
    shares: [],
    solution: solutionId,
    policy: {},
};

function contextUser(userId: types.cloud.UserId, pub: types.cloud.UserPubKey): db.context.ContextUser {
    return {
        id: (userId + "-ctx") as db.context.ContextUserId,
        created: DateUtils.now(),
        contextId: contextId,
        userId: userId,
        userPubKey: pub,
        acl: "ALLOW ALL" as types.cloud.ContextAcl,
    };
}

const janekUser = contextUser(janek, janekPub);
const aliceUser = contextUser(alice, alicePub);

/** A tree-backed group at epoch 5 with four members, janek being the only manager. */
function treeBackedGroup(overrides: Partial<db.group.Group> = {}): db.group.Group {
    return {
        id: groupId,
        contextId: contextId,
        groupPubKey: groupPubKey,
        createDate: DateUtils.now(),
        creator: janek,
        lastModificationDate: DateUtils.now(),
        lastModifier: janek,
        keyId: keyId,
        data: data,
        allTimeUsers: [janek, alice, bob, carol],
        users: [alice, bob, carol],
        managers: [janek],
        keys: [],
        history: [{
            keyId: keyId,
            data: data,
            users: [alice, bob, carol],
            managers: [janek],
            groupPubKey: groupPubKey,
            created: DateUtils.now(),
            author: janek,
        }],
        policy: {},
        keyVersion: EPOCH,
        keyHistory: [],
        tree: buildTree(SEATING, EPOCH),
        archiveRungs: [],
        eraFloor: 1,
        ...overrides,
    };
}

function createGroupService(group: db.group.Group = treeBackedGroup(), options: {rateLimited?: boolean, casMiss?: boolean} = {}) {
    const repositoryFactory = createMock<RepositoryFactory>({});
    const cloudKeyService = createMock<CloudKeyService>({});
    const groupNotificationService = createMock<GroupNotificationService>({});
    const groupRepository = createMock<GroupRepository>({});
    const contextUserRepository = createMock<ContextUserRepository>({});
    const cloudAclChecker = new CloudAclChecker();
    const policyService = new PolicyService();
    const cloudAccessValidator = createMock<CloudAccessValidator>({});
    const activeUsersMap = createMock<ActiveUsersMap>({});
    const groupRotationRateLimiter = createMock<GroupRotationRateLimiter>({});
    mock(groupRotationRateLimiter, "check", async () => ({allowed: !options.rateLimited}));
    mock(groupRotationRateLimiter, "record", async () => {});
    const groupService = new GroupService(
        repositoryFactory, activeUsersMap, "localhost" as types.core.Host, cloudKeyService, groupNotificationService,
        cloudAclChecker, policyService, cloudAccessValidator, groupRotationRateLimiter,
    );
    
    mock(repositoryFactory, "createGroupRepository", () => groupRepository);
    mock(repositoryFactory, "createContextUserRepository", () => contextUserRepository);
    mock(repositoryFactory, "withTransaction", f => f({} as mongodb.ClientSession));
    
    mock(cloudKeyService, "checkUsersExistance", async () => {});
    mock(cloudKeyService, "buildKeys", (() => []) as never);
    mock(cloudKeyService, "checkKeysAndUsersDuringCreation", async () => []);
    
    mock(groupRepository, "get", async (id) => id === groupId ? group : null);
    mock(groupRepository, "getKeyVersion", ((g: db.group.Group) => g.keyVersion ?? 0) as never);
    mock(groupRepository, "createGroup", async () => group);
    const applied = options.casMiss
        ? (async () => null)
        : (async (params: {tree?: types.cloud.GroupTreeState}) => ({...group, ...(params.tree ? {tree: params.tree} : {})}) as db.group.Group);
    mock(groupRepository, "addMemberWithTree", applied as never);
    mock(groupRepository, "removeMemberWithTree", applied as never);
    mock(groupRepository, "cutEra", (options.casMiss ? async () => null : async (g: db.group.Group, floor: number) => ({...g, eraFloor: floor})) as never);
    mock(groupRepository, "pruneArchive", (options.casMiss ? async () => null : async (g: db.group.Group, below: number) => ({...g, archivePrunedBelow: below})) as never);
    
    mock(contextUserRepository, "getUsers", async () => []);
    mock(activeUsersMap, "getUsersState", async () => []);
    mock(groupNotificationService, "sendCreatedGroup", () => {});
    mock(groupNotificationService, "sendUpdatedGroup", () => {});
    
    mock(cloudAccessValidator, "getUserFromContext", async (cloudUser, ctx) => {
        const usersByPub: Record<string, db.context.ContextUser> = {[janekPub]: janekUser, [alicePub]: aliceUser};
        const user = ctx === contextId ? usersByPub[cloudUser.pub] ?? null : null;
        if (!user) {
            throw new AppException("ACCESS_DENIED");
        }
        return {user, context: myContext};
    });
    mock(cloudAccessValidator, "checkIfCanExecuteInContext", async (executor, ctx, onCloudUser) => {
        const ctxId = typeof ctx === "string" ? ctx : ctx.id;
        const {user, context} = await cloudAccessValidator.getUserFromContext(executor as CloudUser, ctxId);
        await onCloudUser(user, context);
        return context;
    });
    
    return {groupService, groupRepository, groupNotificationService, groupRotationRateLimiter, cloudKeyService, group};
}

/** The payload an honest client submits to seat `dave` in a blank at position 1. */
function additionModel(group: db.group.Group, position = 1) {
    const tree = cloneTree(group.tree!);
    tree.leafAssignment[position] = dave;
    const parentIndex = TreeMath.parent(TreeMath.leafNode(position), tree.numLeaves);
    const parentGeneration = tree.nodes.find(n => n.nodeIndex === parentIndex)?.generation ?? 0;
    tree.edges.push({
        parentIndex,
        parentGeneration,
        childKind: "user",
        childUserId: dave,
        data: "wrap:new-member" as types.core.UserKeyData,
    });
    return {
        id: groupId,
        userId: dave,
        role: "user" as types.cloud.ContainerRole,
        position,
        // An addition does not rotate anything, so it reuses the group's current metadata keyId.
        keyId: keyId,
        data: data,
        tree,
        expectedKeyVersion: group.keyVersion!,
    };
}

/** The payload an honest client submits to remove the member at `position`, rungs included. */
function removalModel(group: db.group.Group, position: number) {
    const {after} = treeAfterRemoval(SEATING, position, group.keyVersion!);
    const newEpoch = group.keyVersion! + 1;
    const rungs: types.cloud.GroupArchiveRung[] = LadderMath.rungSpansFor(newEpoch, group.eraFloor ?? 1).map(span => ({
        atKeyVersion: span.at,
        targetKeyVersion: span.target,
        recipientKind: "epoch" as const,
        data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
        author: janek,
    }));
    return {
        id: groupId,
        userId: SEATING[position] as types.cloud.UserId,
        groupPubKey: nextGroupPubKey,
        keyId: newKeyId,
        data: data,
        tree: after,
        rungs,
        expectedKeyVersion: group.keyVersion!,
    };
}

async function expectFailure(kind: Parameters<typeof AppException.is>[1], run: () => Promise<unknown>) {
    try {
        await run();
    }
    catch (e) {
        expect(AppException.is(e, kind)).toBe(true);
        return e as AppException;
    }
    throw new Error(`expected ${String(kind)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// creation
// ─────────────────────────────────────────────────────────────────────────────

it("createGroup accepts a tree-backed group with no per-member key entries", async () => {
    // The point of the tree: members reach the grant key by climbing, so the creator does not have to produce
    // one ciphertext per member just to hand out the current key.
    const {groupService, groupRepository} = createGroupService();
    await groupService.createGroup(
        janekCloudUser, null, contextId, undefined, groupPubKey, [alice, bob, carol], [janek], data, keyId, [], {},
        buildTree(SEATING, 1),
    );
    hasOneCall(groupRepository.createGroup);
});

it("createGroup rejects a tree that does not seat every member", async () => {
    const {groupService, groupRepository} = createGroupService();
    await expectFailure("GROUP_TREE_INVALID", () => groupService.createGroup(
        janekCloudUser, null, contextId, undefined, groupPubKey, [alice, bob, carol], [janek], data, keyId, [], {},
        buildTree(["janek", "alice", "bob", ""], 1),
    ));
    hasNoCalls(groupRepository.createGroup);
});

it("createGroup rejects a tree addressed to an epoch other than the first", async () => {
    const {groupService} = createGroupService();
    await expectFailure("GROUP_TREE_INVALID", () => groupService.createGroup(
        janekCloudUser, null, contextId, undefined, groupPubKey, [alice, bob, carol], [janek], data, keyId, [], {},
        buildTree(SEATING, 4),
    ));
});

it("createGroup without a tree still requires a key entry per member", async () => {
    // The flat path is untouched: no tree means the old contract applies in full.
    const {groupService, cloudKeyService} = createGroupService();
    await groupService.createGroup(janekCloudUser, null, contextId, undefined, groupPubKey, [alice], [janek], data, keyId, [], {});
    hasOneCall(cloudKeyService.checkKeysAndUsersDuringCreation);
});

// ─────────────────────────────────────────────────────────────────────────────
// addMember
// ─────────────────────────────────────────────────────────────────────────────

it("addMember seats a newcomer in a blank without advancing the epoch", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository, groupNotificationService} = createGroupService(group);
    await groupService.addMember(janekCloudUser, additionModel(group));
    hasOneCall(groupRepository.addMemberWithTree);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("addMember appends a seat when every position is taken", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    // Growth to five leaves: node 7 becomes the root, and the grant edge re-links to it at the same epoch.
    const tree = buildTree([...SEATING, "dave"], EPOCH);
    for (const node of tree.nodes) {
        const carried = group.tree!.nodes.find(n => n.nodeIndex === node.nodeIndex);
        if (carried) {
            node.publicKey = carried.publicKey;
            node.generation = carried.generation;
        }
    }
    await groupService.addMember(janekCloudUser, {...additionModel(group), position: 4, tree});
    hasOneCall(groupRepository.addMemberWithTree);
});

it("SECURITY: addMember refuses a payload that advances the epoch", async () => {
    // An addition that rotated the grant key would stale every container the group can read, turning the cheap
    // operation into the expensive one — and letting one add force the whole group to re-key.
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const model = additionModel(group);
    model.tree.edges.find(e => e.isGrantEdge)!.parentGeneration = EPOCH + 1;
    await expectFailure("GROUP_TREE_INVALID", () => groupService.addMember(janekCloudUser, model));
    hasNoCalls(groupRepository.addMemberWithTree);
});

it("SECURITY: addMember refuses a payload that also refreshes a node", async () => {
    // Refreshing during an addition would let a caller replace keys other members depend on, outside the one
    // operation (removal) whose refresh coverage the bridge checks.
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const model = additionModel(group);
    model.tree = refreshNodes(model.tree, [3]);
    await expectFailure("GROUP_TREE_INVALID", () => groupService.addMember(janekCloudUser, model));
    hasNoCalls(groupRepository.addMemberWithTree);
});

it("addMember refuses to seat somebody who is already a member", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.addMember(janekCloudUser, {...additionModel(group), userId: bob}));
    hasNoCalls(groupRepository.addMemberWithTree);
});

it("addMember refuses a caller working from a superseded epoch", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("ROTATED_ALREADY", () => groupService.addMember(janekCloudUser, {...additionModel(group), expectedKeyVersion: EPOCH - 1}));
    hasNoCalls(groupRepository.addMemberWithTree);
});

it("addMember requires a manager, not merely a member", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("ACCESS_DENIED", () => groupService.addMember(aliceCloudUser, additionModel(group)));
    hasNoCalls(groupRepository.addMemberWithTree);
});

it("addMember reports a lost race rather than overwriting the winner", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService} = createGroupService(group, {casMiss: true});
    await expectFailure("ROTATED_ALREADY", () => groupService.addMember(janekCloudUser, additionModel(group)));
});

it("addMember refuses a flat group", async () => {
    const flat = treeBackedGroup({tree: undefined});
    const {groupService} = createGroupService(flat);
    await expectFailure("GROUP_HAS_NO_TREE", () => groupService.addMember(janekCloudUser, additionModel(treeBackedGroup())));
});

// ─────────────────────────────────────────────────────────────────────────────
// removeMember
// ─────────────────────────────────────────────────────────────────────────────

it("removeMember accepts an honest removal and charges the rotation budget", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupNotificationService, groupRotationRateLimiter} = createGroupService(group);
    await groupService.removeMember(janekCloudUser, removalModel(group, 2));
    hasOneCall(groupRepository.removeMemberWithTree);
    hasOneCall(groupRotationRateLimiter.record);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("removeMember works at every seat", async () => {
    for (let position = 1; position < SEATING.length; position++) {
        const group = treeBackedGroup();
        const {groupService, groupRepository} = createGroupService(group);
        await groupService.removeMember(janekCloudUser, removalModel(group, position));
        hasOneCall(groupRepository.removeMemberWithTree);
    }
});

it("SECURITY: removeMember refuses a refresh that skips a node on the path", async () => {
    // Skipping even one node leaves the removed member holding a key that still decrypts current content.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 2);
    const rootIndex = TreeMath.root(group.tree!.numLeaves);
    const root = model.tree.nodes.find(n => n.nodeIndex === rootIndex)!;
    const original = group.tree!.nodes.find(n => n.nodeIndex === rootIndex)!;
    root.generation = original.generation;
    root.publicKey = original.publicKey;
    await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMember(janekCloudUser, model));
    hasNoCalls(groupRepository.removeMemberWithTree);
});

it("SECURITY: removeMember refuses a bumped generation carrying the old public key", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 2);
    const rootIndex = TreeMath.root(group.tree!.numLeaves);
    model.tree.nodes.find(n => n.nodeIndex === rootIndex)!.publicKey =
        group.tree!.nodes.find(n => n.nodeIndex === rootIndex)!.publicKey;
    await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMember(janekCloudUser, model));
    hasNoCalls(groupRepository.removeMemberWithTree);
});

it("SECURITY: removeMember refuses a rung pointing upwards", async () => {
    // The single most important check in the archive: an upward rung encrypts a *later* epoch's key under an
    // earlier one, handing the member who just left everything that comes after their removal.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs.push({
        atKeyVersion: EPOCH,
        targetKeyVersion: EPOCH + 1,
        data: "rung:upwards" as types.core.UserKeyData,
    });
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMember(janekCloudUser, model));
    hasNoCalls(groupRepository.removeMemberWithTree);
});

it("SECURITY: removeMember refuses a rung addressed to an epoch other than the one being created", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs[0] = {...model.rungs[0], atKeyVersion: EPOCH};
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMember(janekCloudUser, model));
});

it("removeMember refuses a new epoch with no unit rung, which would orphan the group's history", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs = model.rungs.filter(r => r.targetKeyVersion !== EPOCH);
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMember(janekCloudUser, model));
});

it("removeMember refuses a rung reaching below a cut era", async () => {
    const group = treeBackedGroup({eraFloor: 4});
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs.push({
        atKeyVersion: EPOCH + 1,
        targetKeyVersion: 2,
        data: "rung:below-floor" as types.core.UserKeyData,
    });
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMember(janekCloudUser, model));
});

it("removeMember refuses a rung reaching below the prune watermark", async () => {
    const group = treeBackedGroup({archivePrunedBelow: 4});
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs.push({
        atKeyVersion: EPOCH + 1,
        targetKeyVersion: 3,
        data: "rung:below-watermark" as types.core.UserKeyData,
    });
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMember(janekCloudUser, model));
});

it("removeMember refuses a rung carrying no ciphertext", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs[0] = {...model.rungs[0], data: "" as types.core.UserKeyData};
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMember(janekCloudUser, model));
});

it("removeMember refuses to remove somebody who is not a member", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.removeMember(janekCloudUser, {...removalModel(group, 2), userId: dave}));
});

it("removeMember refuses to empty the group", async () => {
    // The manager policy catches this first — a group cannot be left without one — and the service's own
    // last-member guard sits behind it as defence in depth. Either way the group cannot be emptied, which is
    // what matters: an empty tree has no occupied leaf and no client could ever climb it again.
    const soloSeating = ["janek"];
    const group = treeBackedGroup({users: [], managers: [janek], tree: buildTree(soloSeating, EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const {after} = treeAfterRemoval(soloSeating, 0, EPOCH);
    await expectFailure("ACCESS_DENIED", () => groupService.removeMember(janekCloudUser, {
        ...removalModel(group, 0), userId: janek, tree: after,
    }));
    hasNoCalls(groupRepository.removeMemberWithTree);
});

it("removeMember respects the per-group rotation rate limit", async () => {
    // The limit is per group, not per caller: the cost of an epoch change falls on every container the group
    // can read, regardless of which manager triggered it.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group, {rateLimited: true});
    await expectFailure("GROUP_ROTATION_RATE_LIMIT", () => groupService.removeMember(janekCloudUser, removalModel(group, 2)));
    hasNoCalls(groupRepository.removeMemberWithTree);
});

it("removeMember requires a manager", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("ACCESS_DENIED", () => groupService.removeMember(aliceCloudUser, removalModel(group, 2)));
    hasNoCalls(groupRepository.removeMemberWithTree);
});

it("removeMember does not charge the rotation budget for a rejected removal", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRotationRateLimiter} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs = [];
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMember(janekCloudUser, model));
    hasNoCalls(groupRotationRateLimiter.record);
});

it("addMember accepts one metadata-key entry for the newcomer", async () => {
    // The tree hands over the grant key; this entry is only the group's metadata key, and it is a single wrap.
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository, cloudKeyService} = createGroupService(group);
    mock(cloudKeyService, "buildKeys", ((_ids: unknown, _old: unknown, inserts: types.cloud.KeyEntrySet[]) =>
        inserts.map(i => ({user: i.user, keys: [{keyId: i.keyId, data: i.data}]}))) as never);
    await groupService.addMember(janekCloudUser, {
        ...additionModel(group),
        keys: [{user: dave, keyId: keyId, data: "blob" as types.core.UserKeyData}],
    });
    hasOneCall(groupRepository.addMemberWithTree);
});

it("SECURITY: addMember refuses a key entry for somebody outside the group", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository, cloudKeyService} = createGroupService(group);
    mock(cloudKeyService, "buildKeys", ((_ids: unknown, _old: unknown, inserts: types.cloud.KeyEntrySet[]) =>
        inserts.map(i => ({user: i.user, keys: [{keyId: i.keyId, data: i.data}]}))) as never);
    await expectFailure("INVALID_PARAMS", () => groupService.addMember(janekCloudUser, {
        ...additionModel(group),
        keys: [{user: "outsider" as types.cloud.UserId, keyId: keyId, data: "blob" as types.core.UserKeyData}],
    }));
    hasNoCalls(groupRepository.addMemberWithTree);
});

it("SECURITY: removeMember refuses a key entry addressed to the member being removed", async () => {
    // Re-keying the metadata *to* the departing member would undo the removal for everything except the grant
    // key, which is precisely the gap the metadata entries exist to close.
    const group = treeBackedGroup();
    const {groupService, groupRepository, cloudKeyService} = createGroupService(group);
    mock(cloudKeyService, "buildKeys", ((_ids: unknown, _old: unknown, inserts: types.cloud.KeyEntrySet[]) =>
        inserts.map(i => ({user: i.user, keys: [{keyId: i.keyId, data: i.data}]}))) as never);
    await expectFailure("INVALID_PARAMS", () => groupService.removeMember(janekCloudUser, {
        ...removalModel(group, 2),
        keys: [{user: bob, keyId: newKeyId, data: "blob" as types.core.UserKeyData}],
    }));
    hasNoCalls(groupRepository.removeMemberWithTree);
});

// ─────────────────────────────────────────────────────────────────────────────
// era floor and pruning
// ─────────────────────────────────────────────────────────────────────────────

it("cutEra raises the floor", async () => {
    const {groupService, groupRepository} = createGroupService();
    await groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH});
    hasOneCall(groupRepository.cutEra);
});

it("cutEra refuses to lower a floor, which would resurrect abandoned epochs", async () => {
    const {groupService, groupRepository} = createGroupService(treeBackedGroup({eraFloor: 4}));
    await expectFailure("INVALID_PARAMS", () => groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 2, expectedKeyVersion: EPOCH}));
    hasNoCalls(groupRepository.cutEra);
});

it("cutEra refuses a floor above the current epoch", async () => {
    const {groupService} = createGroupService();
    await expectFailure("INVALID_PARAMS", () => groupService.cutEra(janekCloudUser, {id: groupId, newFloor: EPOCH + 1, expectedKeyVersion: EPOCH}));
});

it("cutEra requires a manager", async () => {
    const {groupService} = createGroupService();
    await expectFailure("ACCESS_DENIED", () => groupService.cutEra(aliceCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH}));
});

it("pruneArchive records a watermark", async () => {
    const {groupService, groupRepository} = createGroupService();
    await groupService.pruneArchive(janekCloudUser, {id: groupId, belowEpoch: 3, expectedKeyVersion: EPOCH});
    hasOneCall(groupRepository.pruneArchive);
});

it("pruneArchive refuses to prune past the current epoch", async () => {
    const {groupService, groupRepository} = createGroupService();
    await expectFailure("INVALID_PARAMS", () => groupService.pruneArchive(janekCloudUser, {id: groupId, belowEpoch: EPOCH + 2, expectedKeyVersion: EPOCH}));
    hasNoCalls(groupRepository.pruneArchive);
});

// ─────────────────────────────────────────────────────────────────────────────
// serving the archive
// ─────────────────────────────────────────────────────────────────────────────

it("getKeyArchive serves the whole ladder by default", async () => {
    const rungs: types.cloud.GroupArchiveRung[] = [2, 3, 4, 5].map(at => ({
        atKeyVersion: at,
        targetKeyVersion: at - 1,
        data: `rung:${at}` as types.core.UserKeyData,
    }));
    const {groupService} = createGroupService(treeBackedGroup({archiveRungs: rungs}));
    const result = await groupService.getKeyArchive(janekCloudUser, groupId);
    expect(result.rungs.length).toBe(4);
});

it("getKeyArchive windows by epoch, so a client fetches only what it is descending through", async () => {
    const rungs: types.cloud.GroupArchiveRung[] = [2, 3, 4, 5].map(at => ({
        atKeyVersion: at,
        targetKeyVersion: at - 1,
        data: `rung:${at}` as types.core.UserKeyData,
    }));
    const {groupService} = createGroupService(treeBackedGroup({archiveRungs: rungs}));
    const result = await groupService.getKeyArchive(janekCloudUser, groupId, 3, 4);
    expect(result.rungs.map(r => r.atKeyVersion).join(",")).toBe("3,4");
});

it("getKeyArchive is readable by an ordinary member", async () => {
    // Every rung is a ciphertext only a holder of the epoch key above it can open, so serving the archive to a
    // member reveals nothing they could not already reach by descending.
    const {groupService} = createGroupService();
    const result = await groupService.getKeyArchive(aliceCloudUser, groupId);
    expect(result.group.id).toBe(groupId);
});
