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

// The bridge no longer signs or verifies group data: signing/verification is the endpoint's responsibility
// (committed inside the opaque `data`). These tests exercise the bridge's storage, ACL, coverage, version-CAS
// and referential-integrity logic only. See documents/plan/10-endpoint-security-model-and-alignment.md.

const solutionId = "MySolutionId" as types.cloud.SolutionId;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const notExistingGroupId = "NotExistingGroupId" as types.group.GroupId;
const resourceId = "MyGroupResourceId" as types.core.ClientResourceId;
const keyId = "SomeKeyId" as types.core.KeyId;
const data = "SomeGroupData" as types.group.GroupData;
const keys = [{} as types.cloud.KeyEntrySet];

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
    data: data,
    users: [janek, alice],
    managers: [janek],
    keys: [],
    // The genesis entry lives in `groupHistoryEntry`; the document keeps the count.
    version: 1 as types.group.GroupVersion,
    policy: {},
};

function createGroupService(groupReferenced = false) {
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
    const groupService = new GroupService(repositoryFactory, activeUsersMap, host, cloudKeyService, groupNotificationService, cloudAclChecker, policyService, cloudAccessValidator, groupRotationRateLimiter);
    
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
    
    mock(cloudKeyService, "checkKeysAndUsersDuringCreation", async () => []);
    mock(cloudKeyService, "checkKeysAndClients", async () => []);
    
    mock(groupRepository, "get", async (id) => id === groupId ? group : null);
    mock(groupRepository, "createGroup", async () => group);
    mock(groupRepository, "updateGroup", async (...args: any[]) => ({...group, users: args[4], managers: args[3]}) as db.group.Group);
    mock(groupRepository, "deleteGroup", async () => {});
    mock(groupRepository, "getPage", async () => ({list: [group], count: 1}));
    // Phase 2 (epochs/CAS): default mocks — success path.
    mock(groupRepository, "getKeyVersion", ((g: db.group.Group) => g.keyVersion ?? 1) as never);
    mock(groupRepository, "getHistoryKeyIds", async () => [keyId]);
    mock(groupRepository, "casRotate", (async () => true) as never);
    mock(groupRepository, "generateNewGroupKey", (async () => ({...group, keyVersion: 2}) as db.group.Group) as never);
    
    mock(contextUserRepository, "getUsers", async () => []);
    mock(activeUsersMap, "getUsersState", async () => []);
    
    mock(groupNotificationService, "sendCreatedGroup", () => {});
    mock(groupNotificationService, "sendUpdatedGroup", () => {});
    mock(groupNotificationService, "sendDeletedGroup", () => {});
    
    mock(cloudAccessValidator, "getUserFromContext", async (cloudUser, ctx) => {
        const usersByPub: Record<string, db.context.ContextUser> = {[janekPub]: janekUser, [alicePub]: aliceUser};
        const user = ctx === contextId ? usersByPub[cloudUser.pub] ?? null : null;
        const context = ctx === contextId ? myContext : null;
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
    const res = await groupService.createGroup(janekCloudUser, resourceId, contextId, undefined, groupPubKey, [janek, alice], [janek], data, keyId, keys, {});
    expect(res).not.toBeNull();
    hasOneCall(groupRepository.createGroup);
    hasOneCall(groupNotificationService.sendCreatedGroup);
});

it("Should fail to create group as an unknown user", async () => {
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.createGroup(bobCloudUser, resourceId, contextId, undefined, groupPubKey, [janek, alice], [janek], data, keyId, keys, {});
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupRepository.createGroup);
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

it("Should update group with a valid version", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    await groupService.updateGroup(janekCloudUser, groupId, groupPubKey, [janek, alice], [janek], data, keyId, keys, 1 as types.group.GroupVersion, false, undefined, null);
    hasOneCall(groupRepository.updateGroup);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("Should reject update with a stale version and no force", async () => {
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.updateGroup(janekCloudUser, groupId, groupPubKey, [janek, alice], [janek], data, keyId, keys, 99 as types.group.GroupVersion, false, undefined, null);
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_VERSION_MISMATCH")).toBe(true);
        hasNoCalls(groupRepository.updateGroup);
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

// ---------- Phase 2: rotation is decoupled from updateGroup ----------

it("updateGroup changes membership WITHOUT rotating the key epoch (no casRotate)", async () => {
    const {groupService, groupRepository} = createGroupService();
    // remove alice (fixture has [janek, alice]); same groupPubKey → pure membership change, never a rotation
    await groupService.updateGroup(janekCloudUser, groupId, groupPubKey, [janek], [janek], data, keyId, keys, 1 as types.group.GroupVersion, false, undefined, null);
    hasOneCall(groupRepository.updateGroup);
    hasNoCalls(groupRepository.casRotate);
});

it("updateGroup rejects an attempt to rotate the group key (must use generateNewGroupKey)", async () => {
    const {groupService, groupRepository} = createGroupService();
    const rotatedPubKey = "DifferentGroupPubKey" as unknown as types.cloud.GroupPubKey;
    try {
        await groupService.updateGroup(janekCloudUser, groupId, rotatedPubKey, [janek, alice], [janek], data, keyId, keys, 1 as types.group.GroupVersion, false, undefined, null);
    }
    catch (e) {
        expect(AppException.is(e, "INVALID_PARAMS")).toBe(true);
        hasNoCalls(groupRepository.updateGroup);
        hasNoCalls(groupRepository.casRotate);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should generate a new group key (rotation without membership change)", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    const res = await groupService.generateNewGroupKey(janekCloudUser, {
        id: groupId, groupPubKey, data, keyId, keys: [], expectedKeyVersion: 1,
    });
    expect(res.keyVersion).toBe(2);
    hasOneCall(groupRepository.generateNewGroupKey);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("Should reject generateNewGroupKey with a stale expectedKeyVersion (ROTATED_ALREADY)", async () => {
    const {groupService, groupRepository} = createGroupService();
    try {
        await groupService.generateNewGroupKey(janekCloudUser, {
            id: groupId, groupPubKey, data, keyId, keys: [], expectedKeyVersion: 99,
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
        await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, keys: [], expectedKeyVersion: 1});
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
        await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, keys: [], expectedKeyVersion: 1});
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
        await groupService.generateNewGroupKey(aliceCloudUser, {id: groupId, groupPubKey, data, keyId, keys: [], expectedKeyVersion: 1});
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        hasNoCalls(groupRepository.generateNewGroupKey);
        hasNoCalls(groupRotationRateLimiter.record); // budget not charged when the gate rejects
        return;
    }
    expect(true).toBeFalsy();
});

it("charges the rotation rate-limit budget only after a successful rotation", async () => {
    const {groupService, groupRotationRateLimiter} = createGroupService();
    await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, keys: [], expectedKeyVersion: 1});
    hasOneCall(groupRotationRateLimiter.record);
});

it("does NOT charge the rate-limit budget on a lost CAS race (ROTATED_ALREADY)", async () => {
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService();
    mock(groupRepository, "generateNewGroupKey", (async () => null) as never); // CAS lost mid-write
    try {
        await groupService.generateNewGroupKey(janekCloudUser, {id: groupId, groupPubKey, data, keyId, keys: [], expectedKeyVersion: 1});
    }
    catch (e) {
        expect(AppException.is(e, "ROTATED_ALREADY")).toBe(true);
        hasNoCalls(groupRotationRateLimiter.record);
        return;
    }
    expect(true).toBeFalsy();
});
