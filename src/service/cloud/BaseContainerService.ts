/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { Utils } from "../../utils/Utils";
import { AppException } from "../../api/AppException";
import { GroupEpochs, staleGroupsOf } from "../../api/main/GroupKeys";

interface GranteeContainer {
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    groups?: types.cloud.GroupGrant[];
}

export class BaseContainerService {
    
    constructor(
        protected repositoryFactory: RepositoryFactory,
        protected activeUsersMap: ActiveUsersMap,
        protected host: types.core.Host,
    ) {}
    
    /** Group ids (in the given context) the user is a member or manager of — for grantee access resolution. */
    protected async getCallerGroupIds(contextId: types.context.ContextId, userId: types.cloud.UserId): Promise<types.group.GroupId[]> {
        const groups = await this.repositoryFactory.createGroupRepository().getGroupsOfUser(contextId, userId);
        return groups.map(g => g.id);
    }
    
    /** A shallow copy of the container with the caller added to users/managers when they belong to a granted
     *  group, so the existing BasePolicy role checks account for group membership unchanged. */
    protected withGroupMembership<T extends GranteeContainer>(container: T, userId: types.cloud.UserId, userGroupIds: types.group.GroupId[]): T {
        const grants = container.groups || [];
        const inAnyGroup = grants.some(g => userGroupIds.includes(g.groupId));
        const inManagerGroup = grants.some(g => g.role === "manager" && userGroupIds.includes(g.groupId));
        if (!inAnyGroup) {
            return container;
        }
        return {
            ...container,
            users: Utils.unique([...container.users, userId]),
            managers: inManagerGroup ? Utils.unique([...container.managers, userId]) : container.managers,
        };
    }
    
    /**
     * The managers list as the manager-lockout checks must read it: a caller who is a manager through one of
     * the grants being written is on it, the way {@link BaseContainerService.withGroupMembership} puts them on
     * the container being read. Without this, a caller whose only manager role comes from a group is seen as
     * removing themselves from the managers on every create and update they make.
     *
     * Costs no query unless a manager-role grant could change the answer; pass `userGroupIds` where the caller's
     * groups were already fetched.
     */
    protected async withGroupManagers(
        contextId: types.context.ContextId,
        userId: types.cloud.UserId,
        managers: types.cloud.UserId[],
        groups: types.cloud.GroupGrant[]|undefined,
        userGroupIds?: types.group.GroupId[],
    ): Promise<types.cloud.UserId[]> {
        const managerGrants = (groups || []).filter(g => g.role === "manager");
        if (managerGrants.length === 0 || managers.includes(userId)) {
            return managers;
        }
        const ownGroupIds = userGroupIds || await this.getCallerGroupIds(contextId, userId);
        if (!managerGrants.some(g => ownGroupIds.includes(g.groupId))) {
            return managers;
        }
        return Utils.unique([...managers, userId]);
    }
    
    /**
     * Current epoch of every group granted on the given containers, in one query. Takes a list so a page of
     * containers costs the same as one; a page granting no groups costs no query at all.
     *
     * All containers must belong to `contextId` — `getKeyVersions` drops anything that does not.
     */
    protected async getGroupEpochs(
        contextId: types.context.ContextId,
        containers: {groups?: types.cloud.GroupGrant[]}[],
    ): Promise<GroupEpochs> {
        const groupIds = Utils.unique(containers.flatMap(c => (c.groups || []).map(g => g.groupId)));
        if (groupIds.length === 0) {
            return new Map();
        }
        return this.repositoryFactory.createGroupRepository().getKeyVersions(contextId, groupIds);
    }
    
    /**
     * Throws CONTAINER_GROUP_EPOCH_OUTDATED if the container's current key is wrapped to a grantee group at an
     * epoch that group has left behind. Call on every item-write path before accepting new content.
     */
    protected async checkGroupEpochs(container: {
        contextId: types.context.ContextId;
        keyId: types.core.KeyId;
        groups?: types.cloud.GroupGrant[];
        groupKeys?: types.cloud.GroupKeysEntry[];
    }, enforced: boolean): Promise<void> {
        if (!enforced) {
            return;
        }
        // A container with no grants costs no query: getGroupEpochs finds no ids and returns an empty map.
        const groupEpochs = await this.getGroupEpochs(container.contextId, [container]);
        // A current grant whose epoch cannot be resolved is refused rather than assumed current: the group was
        // deleted or moved out of the context, and nothing here can say what the container's key is wrapped to.
        for (const grant of container.groups || []) {
            if (!groupEpochs.has(grant.groupId)) {
                throw new AppException("CONTAINER_GROUP_EPOCH_OUTDATED");
            }
        }
        if (staleGroupsOf(container, groupEpochs).length > 0) {
            throw new AppException("CONTAINER_GROUP_EPOCH_OUTDATED");
        }
    }
    
    protected async getUsersWithStatus(userIds: types.cloud.UserId[], contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        if (userIds.length == 0) {
            return [];
        }
        const deletedContextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(contextId, userIds);
        const usersState = await this.activeUsersMap.getUsersState({host: this.host, userPubkeys: deletedContextUsers.map(user => user.userPubKey), solutionIds: [solutionId]});
        return usersState.map(user => {
            const userIdentity: types.cloud.UserIdentityWithStatus = {
                id: deletedContextUsers.find(u => u.userPubKey == user.userPubKey)!.userId,
                pub: user.userPubKey,
                status: user.status,
            };
            return userIdentity;
        });
    }
}
