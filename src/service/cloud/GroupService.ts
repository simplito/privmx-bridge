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
import type { GroupGenerateNewKeyModel, RotatedAlreadyData } from "../../api/main/context/ContextApiTypes";
import type { GroupRotationRateLimiter } from "../../cluster/master/ipcServices/GroupRotationRateLimiter";

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
        private groupRotationRateLimiter: GroupRotationRateLimiter,
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
        keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerPolicy) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        // Membership integrity (signature/chain) is committed inside the opaque `data` (endpoint DIO) and verified
        // client-side; the bridge only stores it. See documents/plan/10-endpoint-security-model-and-alignment.md.
        try {
            const group = await this.repositoryFactory.createGroupRepository().createGroup(contextId, resourceId, type, groupPubKey, user.userId, managers, users, data, keyId, newKeys, policy);
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
        policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
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
            // updateGroup changes membership/metadata only — it must NOT rotate the group identity key (epoch).
            // Key rotation is a separate, narrowly-scoped operation: context.groupGenerateNewKey (which cannot
            // add/remove members). This keeps the two capabilities cleanly separable.
            if (groupPubKey !== oldGroup.groupPubKey) {
                throw new AppException("INVALID_PARAMS", "groupUpdate cannot rotate the group key; use generateNewGroupKey");
            }
            const currentVersion = oldGroup.history.length as types.group.GroupVersion;
            if (currentVersion !== version && !force) {
                throw new AppException("GROUP_VERSION_MISMATCH", "version does not match");
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldGroup.contextId, [...oldGroup.history.map(x => x.keyId), keyId], oldGroup.keys, keys, keyId, users, managers);
            if (oldGroup.clientResourceId && resourceId && oldGroup.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            // Membership integrity is committed inside the opaque `data` (endpoint DIO) and verified client-side.
            try {
                const group = await groupRepository.updateGroup(oldGroup, user.userId, groupPubKey, managers, users, data, keyId, newKeys, policy, resourceId);
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
    
    async generateNewGroupKey(cloudUser: CloudUser, model: GroupGenerateNewKeyModel) {
        const {group: rGroup, context: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(model.id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            // Rotation is a container mutation, so it must pass the same manager/policy gate as updateGroup.
            // Rotation changes neither membership nor policy → reuse the existing managers and pass no policy.
            this.policy.makeUpdateContainerCheck(user, context, oldGroup, oldGroup.managers, undefined);
            await this.checkRotationRateLimit(model.id);
            const currentKeyVersion = groupRepository.getKeyVersion(oldGroup);
            if (currentKeyVersion !== model.expectedKeyVersion) {
                const winner = await groupRepository.get(model.id);
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(winner!, user.userId));
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(
                oldGroup.contextId,
                [...oldGroup.history.map(x => x.keyId), model.keyId],
                oldGroup.keys,
                model.keys,
                model.keyId,
                oldGroup.users,
                oldGroup.managers,
            );
            const result = await groupRepository.generateNewGroupKey(oldGroup, user.userId, model.groupPubKey, model.data, model.keyId, newKeys, model.confirmationTag);
            if (!result) {
                const winner = await groupRepository.get(model.id);
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(winner!, user.userId));
            }
            return {group: result, context};
        });
        // Charge the rotation rate-limit budget only on a committed rotation, so lost CAS races / version
        // mismatches (ROTATED_ALREADY) don't consume the group's quota.
        await this.groupRotationRateLimiter.record({key: this.rotationRateLimitKey(model.id)});
        this.groupNotificationService.sendUpdatedGroup(rGroup, usedContext.solution, []);
        return rGroup;
    }
    
    // The rotation rate limit is keyed per GROUP (not per caller): BR-4 protects grantee containers from
    // epoch churn, which is a per-group cost regardless of which manager triggers it.
    private rotationRateLimitKey(groupId: types.group.GroupId): string {
        return groupId;
    }
    
    /**
     * Cross-worker rotation rate limit (BR-4) via the master-held IPC service. Peek only — the quota is
     * consumed by `record` after the rotation actually commits (see generateNewGroupKey).
     */
    private async checkRotationRateLimit(groupId: types.group.GroupId): Promise<void> {
        const {allowed} = await this.groupRotationRateLimiter.check({key: this.rotationRateLimitKey(groupId)});
        if (!allowed) {
            throw new AppException("GROUP_ROTATION_RATE_LIMIT");
        }
    }
    
    private buildRotatedAlreadyData(winner: db.group.Group, callerId: types.cloud.UserId): RotatedAlreadyData {
        const callerEntry = winner.keys.find(k => k.user === callerId);
        const winnerKeyEntry = callerEntry?.keys.find(k => k.keyId === winner.keyId);
        return {
            keyVersion: winner.keyVersion ?? 1,
            groupPubKey: winner.groupPubKey,
            winnerKeyEntry: winnerKeyEntry ?? {keyId: winner.keyId, data: "" as types.core.UserKeyData},
        };
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
    
}

class GroupPolicy extends BasePolicy<db.group.Group, never> {
    
    protected isItemCreator(_user: db.context.ContextUser, _item: never) {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.group || {};
    }
}
