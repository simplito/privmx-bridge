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
    
    /**
     * Returns a shallow copy of the container with the caller added to its users/managers lists when the
     * caller belongs to a granted group. This lets the existing BasePolicy role checks (which read
     * users/managers) account for group membership without changing the policy engine.
     */
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
     * Throws CONTAINER_GROUP_EPOCH_OUTDATED if any grantee group's stored epoch is behind
     * the group's current keyVersion. Call this on every item-write path (sendMessage,
     * createFile, setEntry, …) before accepting new encrypted content.
     */
    protected async checkGroupEpochs(container: {
        contextId: types.context.ContextId;
        groups?: types.cloud.GroupGrant[];
        groupKeys?: types.cloud.GroupKeysEntry[];
    }, enforced: boolean): Promise<void> {
        if (!enforced) return;
        if ((container.groups || []).length === 0) return;
        const groupIds = (container.groups || []).map(g => g.groupId);
        const currentVersions = await this.repositoryFactory.createGroupRepository()
            .getKeyVersions(container.contextId, groupIds);
        const isStale = (container.groupKeys || []).some(entry => {
            const current = currentVersions.get(entry.group) ?? 1;
            return entry.keys.some(k => (k.groupEpoch ?? 0) < current);
        });
        if (isStale) {
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
