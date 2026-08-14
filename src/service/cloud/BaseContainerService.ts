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
     * Throws CONTAINER_GROUP_EPOCH_OUTDATED if the key the container **currently** encrypts with
     * (`container.keyId`) was wrapped to an epoch behind a grantee group's current keyVersion. Call this on
     * every item-write path (sendMessage, createFile, setEntry, …) before accepting new encrypted content:
     * after a group re-key the container must be re-keyed (threadUpdate/*RotateKeys) before new content is
     * written, otherwise the removed member could still read it.
     *
     * Only the current `keyId` is examined. Historical entries are kept on purpose — buildGroupKeys copies
     * `oldGroupKeys` forward and every past keyId stays in `availableKeyIds` so pre-rotation content remains
     * readable — so they are *expected* to sit on older epochs. Checking all of them (BR-31's literal "any
     * entry" rule) made the container permanently unwritable after the first removal, since nothing ever
     * removes those entries (BR-36). New content can only be written under `container.keyId` anyway: a
     * mismatched keyId is rejected earlier as INVALID_THREAD_KEY / INVALID_KEY / INVALID_KEY_ID.
     *
     * This guards the *write* path only. The read-path threat BR-31 describes (a removed member replaying an
     * old epoch key to decrypt content encrypted under a historical keyId) is not addressed here and cannot
     * be — see documents/bridge_phase_two/02-services-and-rpc.md §5a.
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
        const groupIds = (container.groups || []).map(g => g.groupId);
        if (groupIds.length === 0) {
            return;
        }
        const currentVersions = await this.repositoryFactory.createGroupRepository()
            .getKeyVersions(container.contextId, groupIds);
        const groupKeys = container.groupKeys || [];
        const isStale = groupIds.some(groupId => {
            const current = currentVersions.get(groupId) ?? 1;
            const currentKey = groupKeys.find(entry => entry.group === groupId)?.keys.find(k => k.keyId === container.keyId);
            // No entry for the current keyId ⇒ nothing was claimed for this group at this key, so there is no
            // stale claim to reject (verifyThatOnlyGivenGroupsHaveAccess already rejects a grant without one).
            // A missing groupEpoch counts as epoch 0 — pre-BR-5 data that must be re-keyed before writing.
            return currentKey !== undefined && (currentKey.groupEpoch ?? 0) < current;
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
