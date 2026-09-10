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
import { ThreadRepository } from "../../../service/cloud/ThreadRepository";
import { GroupService } from "../../../service/cloud/GroupService";
import { createMock, hasNoCalls, hasOneCall, mock } from "../../testUtils/TestUtils";
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
import { Config } from "../../../cluster/common/ConfigUtils";
import { TypesValidator } from "../../../api/TypesValidator";
import { buildTree, rotationGrantEdge, rungsFor } from "../../testUtils/TreeFixtures";

// Signing and verification are the endpoint's, committed inside the opaque `data`. These tests exercise the
// bridge's storage, ACL, coverage, version-CAS and referential-integrity logic only.

const solutionId = "MySolutionId" as types.cloud.SolutionId;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const notExistingGroupId = "NotExistingGroupId" as types.group.GroupId;
const resourceId = "MyGroupResourceId" as types.core.ClientResourceId;
const keyId = "SomeKeyId" as types.core.KeyId;
const data = "SomeGroupData" as types.group.GroupData;

const janekKeys = ECUtils.generateKeyPair();
const janekPub = janekKeys.pub58 as types.cloud.UserPubKey;
const groupPubKey = janekPub as unknown as types.cloud.GroupPubKey;
const janek = "janek" as types.cloud.UserId;
const alice = "alice" as types.cloud.UserId;
const aliceKeys = ECUtils.generateKeyPair();
const alicePub = aliceKeys.pub58 as types.cloud.UserPubKey;
const janekCloudUser = new CloudUser(janekPub);
const aliceCloudUser = new CloudUser(alicePub);
const bobCloudUser = new CloudUser("SomeUnknownPubKey" as types.core.EccPubKey);
// carol belongs to the context with a full ACL but to no group — the group ACL is context-scoped, so she is
// what proves membership is gated separately from it.
const carol = "carol" as types.cloud.UserId;
const carolKeys = ECUtils.generateKeyPair();
const carolPub = carolKeys.pub58 as types.cloud.UserPubKey;
const carolCloudUser = new CloudUser(carolPub);

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
const janekUser: db.context.ContextUser = {
    id: "xxx" as db.context.ContextUserId,
    created: DateUtils.now(),
    contextId: contextId,
    userId: janek,
    userPubKey: janekPub,
    acl: "ALLOW ALL" as types.cloud.ContextAcl,
};
// alice is a context user with full ACL but only a group MEMBER (not a manager) — used to prove that
// mutating operations (e.g. generateNewGroupKey) require the manager/policy gate, not just the ACL.
const aliceUser: db.context.ContextUser = {
    id: "yyy" as db.context.ContextUserId,
    created: DateUtils.now(),
    contextId: contextId,
    userId: alice,
    userPubKey: alicePub,
    acl: "ALLOW ALL" as types.cloud.ContextAcl,
};
const carolUser: db.context.ContextUser = {
    id: "zzz" as db.context.ContextUserId,
    created: DateUtils.now(),
    contextId: contextId,
    userId: carol,
    userPubKey: carolPub,
    acl: "ALLOW ALL" as types.cloud.ContextAcl,
};
// Every group is tree-backed, so even the plumbing fixture carries one.
const tree = buildTree([janek, alice], 1);
/** What an honest client submits to rotate the grant key at `newKeyVersion`. */
function rotation(newKeyVersion: number) {
    return {grantEdge: rotationGrantEdge(tree, newKeyVersion), rungs: rungsFor(newKeyVersion, 1)};
}

const group: db.group.Group = {
    id: groupId,
    clientResourceId: resourceId,
    contextId: contextId,
    groupPubKey: groupPubKey,
    createDate: DateUtils.now(),
    creator: janek,
    lastModificationDate: DateUtils.now(),
    lastModifier: janek,
    keyId: keyId,
    users: [janek, alice],
    managers: [janek],
    // The genesis entries live beside the document; the document keeps the counts. Deliberately different
    // numbers per metadata plane, so a method reading the wrong plane's counter has to fail rather than pass by
    // coincidence.
    publicMetaVersion: 1 as types.group.GroupVersion,
    privateMetaVersion: 5 as types.group.GroupVersion,
    rosterVersion: 1,
    policy: {},
    keyVersion: 1,
    eraFloor: 1,
    numLeaves: tree.numLeaves,
    leafAssignment: tree.leafAssignment,
};

const listParams: types.core.ListModel = {skip: 0, limit: 10, sortOrder: "asc"};

function createGroupService(groupReferenced = false, contextPolicy: types.context.ContextPolicy = {}) {
    const usedContext = {...myContext, policy: contextPolicy};
    const repositoryFactory = createMock<RepositoryFactory>({});
    const cloudKeyService = createMock<CloudKeyService>({});
    const groupNotificationService = createMock<GroupNotificationService>({});
    const groupRepository = createMock<GroupRepository>({});
    const threadRepository = createMock<ThreadRepository>({});
    const contextUserRepository = createMock<ContextUserRepository>({});
    const cloudAclChecker = new CloudAclChecker();
    const policyService = new PolicyService();
    const cloudAccessValidator = createMock<CloudAccessValidator>({});
    const activeUsersMap = createMock<ActiveUsersMap>({});
    const host = "localhost" as types.core.Host;
    const groupRotationRateLimiter = createMock<GroupRotationRateLimiter>({});
    mock(groupRotationRateLimiter, "check", async () => ({allowed: true}));
    mock(groupRotationRateLimiter, "record", async () => {});
    const groupService = new GroupService(repositoryFactory, activeUsersMap, host, cloudKeyService, groupNotificationService, cloudAclChecker, policyService, cloudAccessValidator, groupRotationRateLimiter, {maxGroupMembers: TypesValidator.MAX_GROUP_MEMBERS} as Config);
    
    const containerRepo = {isGroupReferenced: async () => groupReferenced};
    mock(repositoryFactory, "createGroupRepository", () => groupRepository);
    mock(repositoryFactory, "createThreadRepository", () => threadRepository);
    mock(repositoryFactory, "createStoreRepository", (() => containerRepo) as never);
    mock(repositoryFactory, "createInboxRepository", (() => containerRepo) as never);
    mock(repositoryFactory, "createKvdbRepository", (() => containerRepo) as never);
    mock(repositoryFactory, "createStreamRoomRepository", (() => containerRepo) as never);
    mock(repositoryFactory, "createContextUserRepository", () => contextUserRepository);
    mock(repositoryFactory, "withTransaction", f => f({} as mongodb.ClientSession));
    mock(threadRepository, "isGroupReferenced", async () => groupReferenced);
    
    mock(cloudKeyService, "checkUsersExistance", async () => {});
    mock(cloudKeyService, "checkKeysAndUsersDuringCreation", async () => []);
    mock(cloudKeyService, "checkKeysAndClients", async () => []);
    
    mock(groupRepository, "get", async (id) => id === groupId ? group : null);
    mock(groupRepository, "createGroup", async () => group);
    mock(groupRepository, "updatePublicMeta", async () => group);
    mock(groupRepository, "updatePrivateMeta", async () => group);
    mock(groupRepository, "updatePolicy", async () => group);
    mock(groupRepository, "deleteGroup", async () => {});
    mock(groupRepository, "getPage", async () => ({list: [group], count: 1}));
    // Phase 2 (epochs/CAS): default mocks — success path.
    mock(groupRepository, "getHistoryKeyIds", async () => [keyId]);
    // A lost CAS race reads the winning version's history entry for its confirmation tag.
    mock(groupRepository, "getHistory", (async () => []) as never);
    mock(groupRepository, "getTree", async () => tree);
    mock(groupRepository, "getRootNode", (async () => tree.nodes[tree.nodes.length - 1]) as never);
    mock(groupRepository, "casRotate", (async () => true) as never);
    mock(groupRepository, "generateNewGroupKey", (async () => ({...group, keyVersion: 2}) as db.group.Group) as never);
    
    mock(contextUserRepository, "getUsers", async () => []);
    mock(activeUsersMap, "getUsersState", async () => []);
    
    mock(groupNotificationService, "sendCreatedGroup", () => {});
    mock(groupNotificationService, "sendUpdatedGroup", () => {});
    mock(groupNotificationService, "sendDeletedGroup", () => {});
    mock(groupNotificationService, "sendGroupCustomEvent", () => {});
    
    mock(cloudAccessValidator, "getUserFromContext", async (cloudUser, ctx) => {
        const usersByPub: Record<string, db.context.ContextUser> = {[janekPub]: janekUser, [alicePub]: aliceUser, [carolPub]: carolUser};
        const user = ctx === contextId ? usersByPub[cloudUser.pub] ?? null : null;
        const context = ctx === contextId ? usedContext : null;
        if (!user || !context) {
            throw new AppException("ACCESS_DENIED");
        }
        return {user, context};
    });
    mock(cloudAccessValidator, "checkIfCanExecuteInContext", async (executor, ctx, onCloudUser) => {
        if (executor.type !== "cloud") {
            throw new Error(`Unsupported executor type=${executor.type}`);
        }
        const ctxId = typeof ctx === "string" ? ctx : ctx.id;
        const {user, context} = await cloudAccessValidator.getUserFromContext(executor, ctxId);
        await onCloudUser(user, context);
        return context;
    });
    
    return {groupService, repositoryFactory, cloudKeyService, groupNotificationService, groupRepository, cloudAccessValidator, groupRotationRateLimiter};
}

it("Should create group", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    const res = await groupService.createGroup(janekCloudUser, resourceId, contextId, undefined, groupPubKey, [janek, alice], [janek], data, data, data, keyId, {}, tree);
    expect(res).not.toBeNull();
    hasOneCall(groupRepository.createGroup);
    hasOneCall(groupNotificationService.sendCreatedGroup);
});

it("Should fail to create group as an unknown user", async () => {
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.createGroup(bobCloudUser, resourceId, contextId, undefined, groupPubKey, [janek, alice], [janek], data, data, data, keyId, {}, tree);
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupRepository.createGroup);
        return;
    }
    expect(true).toBeFalsy();
});

it("groupList narrows to the caller's own groups unless the policy says otherwise", async () => {
    // A summary carries the roster, so listing every group in a context hands out its membership graph. The
    // default policy allows the narrowed view (`listMy`) and not the unnarrowed one (`listAll`), and the
    // narrowing has to reach the query — filtering after the page is drawn would silently shorten it.
    const {groupService, groupRepository} = createGroupService();
    await groupService.getGroupsByContext(janekCloudUser, contextId, listParams, "createDate");
    hasOneCall(groupRepository.getPage);
    expect(groupRepository.getPage.mock.calls[0][3]).toBe(janek);
});

it("groupList serves every group when the policy allows the unnarrowed view", async () => {
    const {groupService, groupRepository} = createGroupService(false, {group: {listAll: "all"}});
    await groupService.getGroupsByContext(janekCloudUser, contextId, listParams, "createDate");
    expect(groupRepository.getPage.mock.calls[0][3]).toBe(undefined);
});

it("groupList is refused outright when neither list policy is met", async () => {
    const {groupService, groupRepository} = createGroupService(false, {group: {listAll: "none", listMy: "none"}});
    try {
        await groupService.getGroupsByContext(janekCloudUser, contextId, listParams, "createDate");
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupRepository.getPage);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should get group", async () => {
    const {groupService} = createGroupService();
    const res = await groupService.getGroup(janekCloudUser, groupId, undefined);
    expect(res.id).toBe(groupId);
});

it("Should fail to get a not existing group", async () => {
    const {groupService} = createGroupService();
    try {
        await groupService.getGroup(janekCloudUser, notExistingGroupId, undefined);
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_DOES_NOT_EXIST")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

const publicMetaModel = (version: number) => ({id: groupId, data, keyId, version: version as types.group.GroupVersion});
const privateMetaModel = (version: number) => ({id: groupId, data, keyId, version: version as types.group.GroupVersion});

it("Should update the public metadata plane with a valid version", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    await groupService.updatePublicMeta(janekCloudUser, publicMetaModel(1));
    hasOneCall(groupRepository.updatePublicMeta);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("Should update the private metadata plane with a valid version", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    await groupService.updatePrivateMeta(janekCloudUser, privateMetaModel(5));
    hasOneCall(groupRepository.updatePrivateMeta);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

// There is no force to leave out: a group's entry commits a tag over the version it lands at, so a stale update
// has nothing it could publish that a client would accept. The check is unconditional.
it("Should reject a metadata update with a stale version", async () => {
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.updatePublicMeta(janekCloudUser, publicMetaModel(99));
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_VERSION_MISMATCH")).toBe(true);
        hasNoCalls(groupRepository.updatePublicMeta);
        return;
    }
    expect(true).toBeFalsy();
});

async function expectRefusal(kind: Parameters<typeof AppException.is>[1], run: () => Promise<unknown>) {
    try {
        await run();
    }
    catch (e) {
        expect(AppException.is(e, kind)).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
}

// The fixture puts the public plane at 1 and the private at 5, so each of these passes only if the method reads
// its OWN counter. With a single shared counter, or with the two fields transposed, this is the test that fails.
it("each metadata plane checks its own counter and not the other's", async () => {
    const publicSide = createGroupService();
    await expectRefusal("GROUP_VERSION_MISMATCH",
        () => publicSide.groupService.updatePublicMeta(janekCloudUser, publicMetaModel(5)));
    hasNoCalls(publicSide.groupRepository.updatePublicMeta);
    
    const privateSide = createGroupService();
    await expectRefusal("GROUP_VERSION_MISMATCH",
        () => privateSide.groupService.updatePrivateMeta(janekCloudUser, privateMetaModel(1)));
    hasNoCalls(privateSide.groupRepository.updatePrivateMeta);
});

it("a metadata update must use the current epoch's key", async () => {
    // A write under a superseded key would stay readable to whoever was removed at that rotation.
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.updatePublicMeta(janekCloudUser, {...publicMetaModel(1), keyId: "otherKey" as types.core.KeyId});
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_META_KEY_MISMATCH")).toBe(true);
        hasNoCalls(groupRepository.updatePublicMeta);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should update the policy without touching either metadata plane", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    await groupService.updatePolicy(janekCloudUser, {id: groupId, policy: {get: "all"} as types.cloud.ContainerPolicy});
    hasOneCall(groupRepository.updatePolicy);
    hasNoCalls(groupRepository.updatePublicMeta);
    hasNoCalls(groupRepository.updatePrivateMeta);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("a policy that is not valid at container level is refused before any write", async () => {
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.updatePolicy(janekCloudUser, {id: groupId, policy: {listMy: "all"} as types.cloud.ContainerPolicy});
    }
    catch (e) {
        expect(AppException.is(e, "INVALID_PARAMS")).toBe(true);
        hasNoCalls(groupRepository.updatePolicy);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should delete group", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    const res = await groupService.deleteGroup(janekCloudUser, groupId);
    expect(res.id).toBe(groupId);
    hasOneCall(groupRepository.deleteGroup);
    hasOneCall(groupNotificationService.sendDeletedGroup);
});

it("Should refuse to delete a group still referenced by a container", async () => {
    const {groupService, groupRepository} = createGroupService(true);
    try {
        await groupService.deleteGroup(janekCloudUser, groupId);
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_IN_USE")).toBe(true);
        hasNoCalls(groupRepository.deleteGroup);
        return;
    }
    expect(true).toBeFalsy();
});

// ---------- rotation is decoupled from the metadata writes ----------

it("a metadata write touches its own plane only, never the roster and never the epoch", async () => {
    // Neither is reachable from here any more: membership moves the tree, so it goes through
    // addMember/removeMember, and rotating the grant key goes through generateNewGroupKey.
    const {groupService, groupRepository} = createGroupService();
    await groupService.updatePublicMeta(janekCloudUser, publicMetaModel(1));
    hasOneCall(groupRepository.updatePublicMeta);
    hasNoCalls(groupRepository.updatePrivateMeta);
    hasNoCalls(groupRepository.casRotate);
});

it("a policy write rotates nothing either", async () => {
    const {groupService, groupRepository} = createGroupService();
    await groupService.updatePolicy(janekCloudUser, {id: groupId, policy: {} as types.cloud.ContainerPolicy});
    hasNoCalls(groupRepository.casRotate);
});

it("Should generate a new group key (rotation without membership change)", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    const res = await groupService.generateNewGroupKey(janekCloudUser, {
        id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1,
    });
    expect(res.keyVersion).toBe(2);
    hasOneCall(groupRepository.generateNewGroupKey);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("Should reject generateNewGroupKey with a stale expectedKeyVersion (ROTATED_ALREADY)", async () => {
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.generateNewGroupKey(janekCloudUser, {
            id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 99, expectedRosterVersion: 1,
        });
    }
    catch (e) {
        expect(AppException.is(e, "ROTATED_ALREADY")).toBe(true);
        hasNoCalls(groupRepository.generateNewGroupKey);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should return ROTATED_ALREADY when the rotation CAS loses mid-write", async () => {
    const {groupService, groupRepository} = createGroupService();
    mock(groupRepository, "generateNewGroupKey", (async () => null) as never); // CAS lost after the version check
    try {
        await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1});
    }
    catch (e) {
        expect(AppException.is(e, "ROTATED_ALREADY")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should reject a rotation when the (IPC) rate limiter denies it", async () => {
    const {groupService, groupRotationRateLimiter} = createGroupService();
    mock(groupRotationRateLimiter, "check", async () => ({allowed: false}));
    try {
        await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1});
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_ROTATION_RATE_LIMIT")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should reject generateNewGroupKey from a non-manager (context ACL alone is insufficient)", async () => {
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService();
    // alice has ALLOW ALL context ACL and is a group member, but is NOT a group manager.
    try {
        await groupService.generateNewGroupKey(aliceCloudUser, {id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1});
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupRepository.generateNewGroupKey);
        hasNoCalls(groupRotationRateLimiter.record); // budget not charged when the gate rejects
        return;
    }
    expect(true).toBeFalsy();
});

it("gates generateNewGroupKey on the rotateKeys policy, not on update", async () => {
    // The field used to be accepted, validated and then never read for groups — rotation rode on `update`, so an
    // operator who widened `update` handed out key rotation with it. alice is a member and not a manager.
    const {groupService, groupRepository} = createGroupService(false, {group: {update: "all"}});
    try {
        await groupService.generateNewGroupKey(aliceCloudUser, {id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1});
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupRepository.generateNewGroupKey);
        return;
    }
    expect(true).toBeFalsy();
});

it("lets a context widen rotateKeys for groups", async () => {
    // The other direction: the knob has to actually reach the gate, or the test above would also pass with
    // rotation still hardwired to manager-only.
    const {groupService, groupRepository} = createGroupService(false, {group: {rotateKeys: "user"}});
    await groupService.generateNewGroupKey(aliceCloudUser, {id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1});
    hasOneCall(groupRepository.generateNewGroupKey);
});

// ---------- the granularity the split exists for ----------

it("rejects a metadata write from a non-manager (context ACL alone is insufficient)", async () => {
    // alice has ALLOW ALL context ACL and is a group member, but is not a group manager, and `update` defaults
    // to manager. Both planes, because each has its own ACL entry but the same policy gate.
    const publicSide = createGroupService();
    await expectRefusal("ACCESS_DENIED",
        () => publicSide.groupService.updatePublicMeta(aliceCloudUser, publicMetaModel(1)));
    hasNoCalls(publicSide.groupRepository.updatePublicMeta);
    
    const privateSide = createGroupService();
    await expectRefusal("ACCESS_DENIED",
        () => privateSide.groupService.updatePrivateMeta(aliceCloudUser, privateMetaModel(5)));
    hasNoCalls(privateSide.groupRepository.updatePrivateMeta);
});

it("lets a context widen update for both metadata planes", async () => {
    // The other direction: the knob has to reach the gate, or the test above would pass with the gate hardwired.
    const publicSide = createGroupService(false, {group: {update: "all"}});
    await publicSide.groupService.updatePublicMeta(aliceCloudUser, publicMetaModel(1));
    hasOneCall(publicSide.groupRepository.updatePublicMeta);
    
    const privateSide = createGroupService(false, {group: {update: "all"}});
    await privateSide.groupService.updatePrivateMeta(aliceCloudUser, privateMetaModel(5));
    hasOneCall(privateSide.groupRepository.updatePrivateMeta);
});

it("gates updatePolicy on the updatePolicy policy, not on update", async () => {
    // The same invariant the rotation split established, transplanted: an operator who widens `update` must not
    // hand out policy rewriting along with it. This is the whole point of giving the policy its own method.
    const {groupService, groupRepository} = createGroupService(false, {group: {update: "all"}});
    try {
        await groupService.updatePolicy(aliceCloudUser, {id: groupId, policy: {} as types.cloud.ContainerPolicy});
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupRepository.updatePolicy);
        return;
    }
    expect(true).toBeFalsy();
});

it("lets a context widen updatePolicy for groups", async () => {
    const {groupService, groupRepository} = createGroupService(false, {group: {updatePolicy: "user"}});
    await groupService.updatePolicy(aliceCloudUser, {id: groupId, policy: {} as types.cloud.ContainerPolicy});
    hasOneCall(groupRepository.updatePolicy);
});

it("widening rotateKeys does not hand out metadata writes", async () => {
    // The reverse direction of the same separation: the metadata gate is `update`, not `rotateKeys`.
    const {groupService, groupRepository} = createGroupService(false, {group: {rotateKeys: "all"}});
    await expectRefusal("ACCESS_DENIED", () => groupService.updatePublicMeta(aliceCloudUser, publicMetaModel(1)));
    hasNoCalls(groupRepository.updatePublicMeta);
});

it("a context that forbids overwriting its policy still allows metadata writes", async () => {
    // Pins that the context-level veto left the metadata path along with `makeUpdateContainerCheck`, rather
    // than staying reachable from it.
    const policySide = createGroupService(false, {group: {canOverwriteContextPolicy: "no"}});
    await expectRefusal("ACCESS_DENIED",
        () => policySide.groupService.updatePolicy(janekCloudUser, {id: groupId, policy: {} as types.cloud.ContainerPolicy}));
    hasNoCalls(policySide.groupRepository.updatePolicy);
    
    const metaSide = createGroupService(false, {group: {canOverwriteContextPolicy: "no"}});
    await metaSide.groupService.updatePublicMeta(janekCloudUser, publicMetaModel(1));
    hasOneCall(metaSide.groupRepository.updatePublicMeta);
});

it("charges the rotation rate-limit budget only after a successful rotation", async () => {
    const {groupService, groupRotationRateLimiter} = createGroupService();
    await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1});
    hasOneCall(groupRotationRateLimiter.record);
});

it("does NOT charge the rate-limit budget on a lost CAS race (ROTATED_ALREADY)", async () => {
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService();
    mock(groupRepository, "generateNewGroupKey", (async () => null) as never); // CAS lost mid-write
    try {
        await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, ...rotation(2), expectedKeyVersion: 1, expectedRosterVersion: 1});
    }
    catch (e) {
        expect(AppException.is(e, "ROTATED_ALREADY")).toBe(true);
        hasNoCalls(groupRotationRateLimiter.record);
        return;
    }
    expect(true).toBeFalsy();
});

const typing = "typing" as types.core.WsChannelName;

it("a member can send a custom event, and the payload is relayed untouched", async () => {
    const {groupService, groupNotificationService} = createGroupService();
    await groupService.sendCustomNotification(aliceCloudUser, groupId, "base64Envelope", typing);
    hasOneCall(groupNotificationService.sendGroupCustomEvent);
    expect(groupNotificationService.sendGroupCustomEvent.mock.calls[0][1]).toBe("base64Envelope");
    expect(groupNotificationService.sendGroupCustomEvent.mock.calls[0][2]).toEqual({id: alice, pub: alicePub});
});

it("a context user who is not in the group cannot send a custom event", async () => {
    // The `context/groupSendCustomEvent` ACL is context-scoped and carol has ALLOW ALL, so the ACL alone lets
    // her through. Membership is the gate that stops her.
    const {groupService, groupNotificationService} = createGroupService();
    try {
        await groupService.sendCustomNotification(carolCloudUser, groupId, "base64Envelope", typing);
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupNotificationService.sendGroupCustomEvent);
        return;
    }
    expect(true).toBeFalsy();
});

it("a custom event cannot be aimed at somebody outside the group", async () => {
    const {groupService, groupNotificationService} = createGroupService();
    try {
        await groupService.sendCustomNotification(janekCloudUser, groupId, "base64Envelope", typing, [carol]);
    }
    catch (e) {
        expect(AppException.is(e, "USER_DOES_NOT_HAVE_ACCESS_TO_CONTAINER")).toBe(true);
        hasNoCalls(groupNotificationService.sendGroupCustomEvent);
        return;
    }
    expect(true).toBeFalsy();
});

it("a custom event on a group that does not exist is refused", async () => {
    const {groupService, groupNotificationService} = createGroupService();
    try {
        await groupService.sendCustomNotification(janekCloudUser, notExistingGroupId, "base64Envelope", typing);
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_DOES_NOT_EXIST")).toBe(true);
        hasNoCalls(groupNotificationService.sendGroupCustomEvent);
        return;
    }
    expect(true).toBeFalsy();
});

it("a context can narrow who may send a group custom event", async () => {
    const {groupService, groupNotificationService} = createGroupService(false, {group: {sendCustomNotification: "manager"}});
    try {
        await groupService.sendCustomNotification(aliceCloudUser, groupId, "base64Envelope", typing);
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupNotificationService.sendGroupCustomEvent);
        return;
    }
    expect(true).toBeFalsy();
});

it("a custom event never reads the group's tree or history", async () => {
    // A notification does not need the state, and reading it would put the cost of a keystroke back on the
    // size of the group.
    const {groupService, groupRepository} = createGroupService();
    await groupService.sendCustomNotification(janekCloudUser, groupId, "base64Envelope", typing);
    hasNoCalls(groupRepository.getTree);
    hasNoCalls(groupRepository.getHistoryKeyIds);
});
