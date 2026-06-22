/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import * as types from "../../types";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { CloudUser, Executor } from "../../CommonTypes";
import { CloudKeyService } from "./CloudKeyService";
import { GroupNotificationService } from "./GroupNotificationService";
import { CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { BasePolicy } from "./BasePolicy";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbDuplicateError } from "../../error/DbDuplicateError";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { BaseContainerService } from "./BaseContainerService";
import { Utils } from "../../utils/Utils";
import { GroupMembershipSignature, GroupSignaturePayload } from "./GroupMembershipSignature";
import { GroupEntrySignature } from "./GroupRepository";

export interface GroupMembersModification {
    usersToAddOrUpdate: types.cloud.UserId[];
    usersToRemove: types.cloud.UserId[];
    managersToAddOrUpdate: types.cloud.UserId[];
    managersToRemove: types.cloud.UserId[];
}

export class GroupService extends BaseContainerService {
    
    private policy: GroupPolicy;
    
    constructor(
        repositoryFactory: RepositoryFactory,
        activeUsersMap: ActiveUsersMap,
        host: types.core.Host,
        private cloudKeyService: CloudKeyService,
        private groupNotificationService: GroupNotificationService,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
    ) {
        super(repositoryFactory, activeUsersMap, host);
        this.policy = new GroupPolicy(this.policyService);
    }
    
    async getGroup(executor: Executor, groupId: types.group.GroupId, type: types.group.GroupType|undefined) {
        const group = await this.repositoryFactory.createGroupRepository().get(groupId);
        if (!group || (type && group.type !== type)) {
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, group.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupGet", ["groupId=" + groupId]);
            if (!this.policy.canReadContainer(user, context, group)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        return group;
    }
    
    async getGroupsByContext(cloudUser: CloudUser, contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.group.Group) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupList", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const groups = await this.repositoryFactory.createGroupRepository().getPage(contextId, listParams, sortBy);
        return {user, groups};
    }
    
    async createGroup(cloudUser: CloudUser, resourceId: types.core.ClientResourceId|null, contextId: types.context.ContextId, type: types.group.GroupType|undefined,
        groupPubKey: types.cloud.GroupPubKey, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.group.GroupData,
        keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerPolicy, signature: types.core.EccSignature) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        const sig = this.verifyAndBuildSignature(signature, {
            op: "create",
            contextId: contextId,
            author: user.userId,
            authorPubKey: user.userPubKey,
            groupPubKey: groupPubKey,
            keyId: keyId,
            prevSignature: null,
            resultUsers: users,
            resultManagers: managers,
        });
        try {
            const group = await this.repositoryFactory.createGroupRepository().createGroup(contextId, resourceId, type, groupPubKey, user.userId, managers, users, data, keyId, newKeys, policy, sig);
            this.groupNotificationService.sendCreatedGroup(group, context.solution);
            return group;
        }
        catch (err) {
            if (err instanceof DbDuplicateError) {
                throw new AppException("DUPLICATE_RESOURCE_ID");
            }
            throw err;
        }
    }
    
    async updateGroup(cloudUser: CloudUser, id: types.group.GroupId, groupPubKey: types.cloud.GroupPubKey, users: types.cloud.UserId[], managers: types.cloud.UserId[],
        data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.group.GroupVersion, force: boolean,
        policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null, signature: types.core.EccSignature, prevSignature: types.core.EccSignature) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        const {group: rGroup, context: usedContext, oldGroup: old} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldGroup, managers, policy);
            const currentVersion = oldGroup.history.length as types.group.GroupVersion;
            if (currentVersion !== version && !force) {
                throw new AppException("GROUP_VERSION_MISMATCH", "version does not match");
            }
            this.checkChainLink(oldGroup, prevSignature);
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldGroup.contextId, [...oldGroup.history.map(x => x.keyId), keyId], oldGroup.keys, keys, keyId, users, managers);
            if (oldGroup.clientResourceId && resourceId && oldGroup.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            const sig = this.verifyAndBuildSignature(signature, {
                op: "update",
                contextId: oldGroup.contextId,
                author: user.userId,
                authorPubKey: user.userPubKey,
                groupPubKey: groupPubKey,
                keyId: keyId,
                prevSignature: prevSignature,
                resultUsers: users,
                resultManagers: managers,
            });
            try {
                const group = await groupRepository.updateGroup(oldGroup, user.userId, groupPubKey, managers, users, data, keyId, newKeys, policy, resourceId, sig);
                return {group, context, oldGroup};
            }
            catch (err) {
                if (err instanceof DbDuplicateError) {
                    throw new AppException("DUPLICATE_RESOURCE_ID");
                }
                throw err;
            }
        });
        const updatedUsers = rGroup.managers.concat(rGroup.users);
        const deletedUsers = old.managers.concat(old.users).filter(u => !updatedUsers.includes(u));
        const additionalUsersToNotify = await this.getUsersWithStatus(deletedUsers, usedContext.id, usedContext.solution);
        this.groupNotificationService.sendUpdatedGroup(rGroup, usedContext.solution, additionalUsersToNotify);
        return rGroup;
    }
    
    async modifyGroupMembers(cloudUser: CloudUser, id: types.group.GroupId, modification: GroupMembersModification,
        keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], signature: types.core.EccSignature, prevSignature: types.core.EccSignature) {
        const {group: rGroup, context: usedContext, oldGroup: old} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + id]);
            this.checkChainLink(oldGroup, prevSignature);
            const delta = this.normalizeDelta(modification);
            const users = Utils.unique(oldGroup.users.concat(delta.usersAdded).filter(u => !delta.usersRemoved.includes(u)));
            const managers = Utils.unique(oldGroup.managers.concat(delta.managersAdded).filter(u => !delta.managersRemoved.includes(u)));
            this.policy.makeUpdateContainerCheck(user, context, oldGroup, managers, undefined);
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldGroup.contextId, [...oldGroup.history.map(x => x.keyId), keyId], oldGroup.keys, keys, keyId, users, managers);
            const sig = this.verifyAndBuildSignature(signature, {
                op: "modifyMembers",
                contextId: oldGroup.contextId,
                author: user.userId,
                authorPubKey: user.userPubKey,
                groupPubKey: oldGroup.groupPubKey,
                keyId: keyId,
                prevSignature: prevSignature,
                resultUsers: users,
                resultManagers: managers,
                delta: delta,
            });
            const group = await groupRepository.updateGroup(oldGroup, user.userId, oldGroup.groupPubKey, managers, users, oldGroup.data, keyId, newKeys, undefined, null, sig);
            return {group, context, oldGroup};
        });
        const updatedUsers = rGroup.managers.concat(rGroup.users);
        const deletedUsers = old.managers.concat(old.users).filter(u => !updatedUsers.includes(u));
        const additionalUsersToNotify = await this.getUsersWithStatus(deletedUsers, usedContext.id, usedContext.solution);
        this.groupNotificationService.sendUpdatedGroup(rGroup, usedContext.solution, additionalUsersToNotify);
        return rGroup;
    }
    
    async deleteGroup(executor: Executor, id: types.group.GroupId) {
        const result = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, oldGroup.contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "context/groupDelete", ["groupId=" + id]);
                if (!this.policy.canDeleteContainer(user, context, oldGroup)) {
                    throw new AppException("ACCESS_DENIED");
                }
            });
            // Phase 2 referential integrity: refuse deletion while the group is still a member of a container.
            const referenced =
                await this.repositoryFactory.createThreadRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createStoreRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createInboxRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createKvdbRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createStreamRoomRepository(session).isGroupReferenced(oldGroup.id);
            if (referenced) {
                throw new AppException("GROUP_IN_USE");
            }
            await groupRepository.deleteGroup(oldGroup.id);
            return {oldGroup, context: usedContext};
        });
        this.groupNotificationService.sendDeletedGroup(result.oldGroup, result.context.solution);
        return result.oldGroup;
    }
    
    async deleteGroupsByContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const groupRepository = this.repositoryFactory.createGroupRepository();
        await groupRepository.deleteOneByOneByContext(contextId, async group => {
            this.groupNotificationService.sendDeletedGroup(group, solutionId);
        });
    }
    
    private normalizeDelta(modification: GroupMembersModification): types.group.GroupMembersDelta {
        return {
            usersAdded: Utils.unique(modification.usersToAddOrUpdate),
            usersRemoved: Utils.unique(modification.usersToRemove),
            managersAdded: Utils.unique(modification.managersToAddOrUpdate),
            managersRemoved: Utils.unique(modification.managersToRemove),
        };
    }
    
    private checkChainLink(oldGroup: db.group.Group, prevSignature: types.core.EccSignature) {
        const head = oldGroup.history[oldGroup.history.length - 1];
        if (!head || head.signature !== prevSignature) {
            throw new AppException("GROUP_VERSION_MISMATCH", "prevSignature does not match the current head of the membership log");
        }
    }
    
    private verifyAndBuildSignature(signature: types.core.EccSignature, payload: GroupSignaturePayload): GroupEntrySignature {
        if (!GroupMembershipSignature.verify(signature, payload)) {
            throw new AppException("INVALID_SIGNATURE", "group membership signature verification failed");
        }
        return {
            op: payload.op,
            delta: payload.delta,
            authorPubKey: payload.authorPubKey,
            prevSignature: payload.prevSignature,
            signature: signature,
        };
    }
}

class GroupPolicy extends BasePolicy<db.group.Group, never> {
    
    protected isItemCreator(_user: db.context.ContextUser, _item: never) {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.group || {};
    }
}
