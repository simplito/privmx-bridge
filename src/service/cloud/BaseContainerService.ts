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
