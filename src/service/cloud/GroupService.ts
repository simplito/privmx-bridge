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
import { DateUtils } from "../../utils/DateUtils";
import { Utils } from "../../utils/Utils";
import type { GroupGenerateNewKeyModel, RotatedAlreadyData } from "../../api/main/context/ContextApiTypes";

export class GroupService extends BaseContainerService {
    
    private policy: GroupPolicy;
    private rotationRateLimiter = new RotationRateLimiter();
    
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
        policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null, expectedKeyVersion?: number, confirmationTag?: types.core.Base64) {
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
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldGroup.contextId, [...oldGroup.history.map(x => x.keyId), keyId], oldGroup.keys, keys, keyId, users, managers);
            if (oldGroup.clientResourceId && resourceId && oldGroup.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            const isRotation = this.isRemoval(oldGroup, users, managers) || (expectedKeyVersion !== undefined);
            // Membership integrity is committed inside the opaque `data` (endpoint DIO) and verified client-side.
            try {
                if (isRotation) {
                    this.rotationRateLimiter.check(id, user.userId);
                    const casExpected = expectedKeyVersion ?? groupRepository.getKeyVersion(oldGroup);
                    const now = DateUtils.now();
                    const entry: db.group.GroupHistoryEntry = {
                        created: now,
                        author: user.userId,
                        keyId: keyId,
                        data: data,
                        users: users,
                        managers: managers,
                        groupPubKey: groupPubKey,
                        ...(confirmationTag ? {confirmationTag} : {}),
                    };
                    const epochGroup: db.group.Group = {
                        ...oldGroup,
                        groupPubKey: groupPubKey,
                        lastModifier: user.userId,
                        lastModificationDate: now,
                        keyId: keyId,
                        data: data,
                        users: users,
                        managers: managers,
                        keys: newKeys,
                        history: [...oldGroup.history, entry],
                        allTimeUsers: Utils.uniqueFromArrays(oldGroup.allTimeUsers, users, managers),
                        policy: policy === undefined ? oldGroup.policy : policy,
                        keyVersion: casExpected + 1,
                        keyHistory: [...(oldGroup.keyHistory ?? []), {keyVersion: casExpected, groupPubKey: oldGroup.groupPubKey}],
                    };
                    if (resourceId && !oldGroup.clientResourceId) {
                        epochGroup.clientResourceId = resourceId;
                    }
                    else if (oldGroup.clientResourceId) {
                        epochGroup.clientResourceId = oldGroup.clientResourceId;
                    }
                    const result = await groupRepository.casRotate(oldGroup, casExpected, epochGroup);
                    if (!result) {
                        const winner = await groupRepository.get(id);
                        throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(winner!, user.userId));
                    }
                    return {group: result, context, oldGroup};
                }
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
            this.rotationRateLimiter.check(model.id, user.userId);
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
        this.groupNotificationService.sendUpdatedGroup(rGroup, usedContext.solution, []);
        return rGroup;
    }
    
    private isRemoval(oldGroup: db.group.Group, newUsers: types.cloud.UserId[], newManagers: types.cloud.UserId[]): boolean {
        const oldSet = new Set([...oldGroup.users, ...oldGroup.managers]);
        return [...oldSet].some(u => !newUsers.includes(u) && !newManagers.includes(u));
    }
    
    private buildRotatedAlreadyData(winner: db.group.Group, callerId: types.cloud.UserId): RotatedAlreadyData {
        const callerEntry = winner.keys.find(k => k.user === callerId);
        const winnerKeyEntry = callerEntry?.keys.find(k => k.keyId === winner.keyId);
        return {
            keyVersion: winner.keyVersion ?? 0,
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

/** In-memory sliding-window rate limiter: max 10 rotations per (groupId, userId) per hour. */
class RotationRateLimiter {
    private static readonly MAX_ROTATIONS = 10;
    private static readonly WINDOW_MS = 60 * 60 * 1000;
    private readonly windows = new Map<string, number[]>();
    
    check(groupId: types.group.GroupId, userId: types.cloud.UserId): void {
        const key = `${groupId}:${userId}`;
        const now = Date.now();
        const cutoff = now - RotationRateLimiter.WINDOW_MS;
        const timestamps = (this.windows.get(key) ?? []).filter(t => t > cutoff);
        if (timestamps.length >= RotationRateLimiter.MAX_ROTATIONS) {
            throw new AppException("GROUP_ROTATION_RATE_LIMIT");
        }
        timestamps.push(now);
        this.windows.set(key, timestamps);
    }
}
