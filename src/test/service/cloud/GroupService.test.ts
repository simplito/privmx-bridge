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
import { GroupMembershipSignature, GroupSignaturePayload } from "../../../service/cloud/GroupMembershipSignature";
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
import { Base64 } from "../../../utils/Base64";

const solutionId = "MySolutionId" as types.cloud.SolutionId;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const notExistingGroupId = "NotExistingGroupId" as types.group.GroupId;
const resourceId = "MyGroupResourceId" as types.core.ClientResourceId;
const keyId = "SomeKeyId" as types.core.KeyId;
const data = "SomeGroupData" as types.group.GroupData;
const keys = [{} as types.cloud.KeyEntrySet];
const headSignature = "HEAD_SIGNATURE" as types.core.EccSignature;

const janekKeys = ECUtils.generateKeyPair();
const janekPub = janekKeys.pub58 as types.cloud.UserPubKey;
const janek = "janek" as types.cloud.UserId;
const alice = "alice" as types.cloud.UserId;
const janekCloudUser = new CloudUser(janekPub);
const bobCloudUser = new CloudUser("SomeUnknownPubKey" as types.core.EccPubKey);

function sign(payload: GroupSignaturePayload): types.core.EccSignature {
    return Base64.from(ECUtils.signToCompactSignature(janekKeys.keyPair, GroupMembershipSignature.digest(payload))) as types.core.EccSignature;
}

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
const group: db.group.Group = {
    id: groupId,
    clientResourceId: resourceId,
    contextId: contextId,
    groupPubKey: janekPub as unknown as types.cloud.GroupPubKey,
    createDate: DateUtils.now(),
    creator: janek,
    lastModificationDate: DateUtils.now(),
    lastModifier: janek,
    keyId: keyId,
    data: data,
    allTimeUsers: [janek, alice],
    users: [janek, alice],
    managers: [janek],
    keys: [],
    history: [{
        keyId: keyId,
        data: data,
        users: [janek, alice],
        managers: [janek],
        groupPubKey: janekPub as unknown as types.cloud.GroupPubKey,
        created: DateUtils.now(),
        author: janek,
        op: "create",
        authorPubKey: janekPub,
        prevSignature: null,
        signature: headSignature,
    }],
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
    const groupService = new GroupService(repositoryFactory, activeUsersMap, host, cloudKeyService, groupNotificationService, cloudAclChecker, policyService, cloudAccessValidator);
    
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
    
    mock(contextUserRepository, "getUsers", async () => []);
    mock(activeUsersMap, "getUsersState", async () => []);
    
    mock(groupNotificationService, "sendCreatedGroup", () => {});
    mock(groupNotificationService, "sendUpdatedGroup", () => {});
    mock(groupNotificationService, "sendDeletedGroup", () => {});
    
    mock(cloudAccessValidator, "getUserFromContext", async (cloudUser, ctx) => {
        const user = cloudUser.pub === janekPub && ctx === contextId ? janekUser : null;
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
    
    return {groupService, repositoryFactory, cloudKeyService, groupNotificationService, groupRepository, cloudAccessValidator};
}

it("Should create group with a valid signature", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    const signature = sign({
        op: "create", contextId, author: janek, authorPubKey: janekPub,
        groupPubKey: janekPub as unknown as types.cloud.GroupPubKey, keyId, prevSignature: null,
        resultUsers: [janek, alice], resultManagers: [janek],
    });
    const res = await groupService.createGroup(janekCloudUser, resourceId, contextId, undefined, janekPub as unknown as types.cloud.GroupPubKey, [janek, alice], [janek], data, keyId, keys, {}, signature);
    expect(res).not.toBeNull();
    hasOneCall(groupRepository.createGroup);
    hasOneCall(groupNotificationService.sendCreatedGroup);
});

it("Should fail to create group with an invalid signature", async () => {
    const {groupService, groupRepository} = createGroupService();
    const badSignature = "AAAA" as types.core.EccSignature;
    try {
        await groupService.createGroup(janekCloudUser, resourceId, contextId, undefined, janekPub as unknown as types.cloud.GroupPubKey, [janek, alice], [janek], data, keyId, keys, {}, badSignature);
    }
    catch (e) {
        expect(AppException.is(e, "INVALID_SIGNATURE")).toBe(true);
        hasNoCalls(groupRepository.createGroup);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should fail to create group as an unknown user", async () => {
    const {groupService, groupRepository} = createGroupService();
    const signature = sign({
        op: "create", contextId, author: janek, authorPubKey: janekPub,
        groupPubKey: janekPub as unknown as types.cloud.GroupPubKey, keyId, prevSignature: null,
        resultUsers: [janek, alice], resultManagers: [janek],
    });
    try {
        await groupService.createGroup(bobCloudUser, resourceId, contextId, undefined, janekPub as unknown as types.cloud.GroupPubKey, [janek, alice], [janek], data, keyId, keys, {}, signature);
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

it("Should update group with valid version, prevSignature and signature", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    const signature = sign({
        op: "update", contextId, author: janek, authorPubKey: janekPub,
        groupPubKey: janekPub as unknown as types.cloud.GroupPubKey, keyId, prevSignature: headSignature,
        resultUsers: [janek, alice], resultManagers: [janek],
    });
    await groupService.updateGroup(janekCloudUser, groupId, janekPub as unknown as types.cloud.GroupPubKey, [janek, alice], [janek], data, keyId, keys, 1 as types.group.GroupVersion, false, undefined, null, signature, headSignature);
    hasOneCall(groupRepository.updateGroup);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("Should reject update when prevSignature does not match the head", async () => {
    const {groupService, groupRepository} = createGroupService();
    const signature = sign({
        op: "update", contextId, author: janek, authorPubKey: janekPub,
        groupPubKey: janekPub as unknown as types.cloud.GroupPubKey, keyId, prevSignature: "WRONG" as types.core.EccSignature,
        resultUsers: [janek, alice], resultManagers: [janek],
    });
    try {
        await groupService.updateGroup(janekCloudUser, groupId, janekPub as unknown as types.cloud.GroupPubKey, [janek, alice], [janek], data, keyId, keys, 1 as types.group.GroupVersion, false, undefined, null, signature, "WRONG" as types.core.EccSignature);
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_VERSION_MISMATCH")).toBe(true);
        hasNoCalls(groupRepository.updateGroup);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should reject update with a stale version and no force", async () => {
    const {groupService, groupRepository} = createGroupService();
    const signature = sign({
        op: "update", contextId, author: janek, authorPubKey: janekPub,
        groupPubKey: janekPub as unknown as types.cloud.GroupPubKey, keyId, prevSignature: headSignature,
        resultUsers: [janek, alice], resultManagers: [janek],
    });
    try {
        await groupService.updateGroup(janekCloudUser, groupId, janekPub as unknown as types.cloud.GroupPubKey, [janek, alice], [janek], data, keyId, keys, 99 as types.group.GroupVersion, false, undefined, null, signature, headSignature);
    }
    catch (e) {
        expect(AppException.is(e, "GROUP_VERSION_MISMATCH")).toBe(true);
        hasNoCalls(groupRepository.updateGroup);
        return;
    }
    expect(true).toBeFalsy();
});

it("Should modify group members (remove a user) with a valid signature", async () => {
    const {groupService, groupRepository, groupNotificationService} = createGroupService();
    const signature = sign({
        op: "modifyMembers", contextId, author: janek, authorPubKey: janekPub,
        groupPubKey: janekPub as unknown as types.cloud.GroupPubKey, keyId, prevSignature: headSignature,
        resultUsers: [janek], resultManagers: [janek],
        delta: {usersAdded: [], usersRemoved: [alice], managersAdded: [], managersRemoved: []},
    });
    await groupService.modifyGroupMembers(janekCloudUser, groupId, {
        usersToAddOrUpdate: [], usersToRemove: [alice], managersToAddOrUpdate: [], managersToRemove: [],
    }, keyId, keys, signature, headSignature);
    hasOneCall(groupRepository.updateGroup);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
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
