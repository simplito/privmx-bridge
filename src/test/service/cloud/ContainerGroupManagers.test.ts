/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import "q2-test";
import { BaseContainerService } from "../../../service/cloud/BaseContainerService";
import { BasePolicy } from "../../../service/cloud/BasePolicy";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { PolicyService } from "../../../service/cloud/PolicyService";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { ActiveUsersMap } from "../../../cluster/master/ipcServices/ActiveUsers";
import { createMock, mock } from "../../testUtils/TestUtils";
import { AppException } from "../../../api/AppException";
import * as db from "../../../db/Model";
import * as types from "../../../types";

/**
 * A manager whose only manager role comes from a grantee group.
 *
 * `withGroupMembership` already puts such a caller on the container's managers before the policy checks read it,
 * so `creatorHasToBeManager` and `updaterCanBeRemovedFromManagers` would see every create and update they make as
 * taking their own manager role away — unless the managers list those checks compare against is widened the same
 * way. That is what `withGroupManagers` does, and what the lockout half of this file pins.
 *
 * The cheap paths matter too: the helper must not query the group roster when no manager-role grant could change
 * the answer, because it sits on every container create.
 */

const contextId = "MyContextId" as types.context.ContextId;
const managerGroupId = "ManagerGroupId" as types.group.GroupId;
const userGroupId = "UserGroupId" as types.group.GroupId;
const alice = "alice" as types.cloud.UserId;
const bob = "bob" as types.cloud.UserId;

const managerGrant = {groupId: managerGroupId, role: "manager" as types.cloud.ContainerRole};
const userGrant = {groupId: userGroupId, role: "user" as types.cloud.ContainerRole};

class ContainerService extends BaseContainerService {
    async effectiveManagers(
        managers: types.cloud.UserId[],
        groups: types.cloud.GroupGrant[]|undefined,
        userGroupIds?: types.group.GroupId[],
    ) {
        return this.withGroupManagers(contextId, alice, managers, groups, userGroupIds);
    }
    
    async asMember(container: {users: types.cloud.UserId[], managers: types.cloud.UserId[], groups?: types.cloud.GroupGrant[]}, userGroupIds: types.group.GroupId[]) {
        return this.withGroupMembership(container, alice, userGroupIds);
    }
}

/** Counts roster lookups, so a test can say the helper did not make one. */
function createService(groupsOfAlice: types.group.GroupId[]) {
    const repositoryFactory = createMock<RepositoryFactory>({});
    const groupRepository = createMock<GroupRepository>({});
    const calls = {getGroupsOfUser: 0};
    mock(groupRepository, "getGroupsOfUser", async () => {
        calls.getGroupsOfUser++;
        return groupsOfAlice.map(id => ({id: id})) as Awaited<ReturnType<GroupRepository["getGroupsOfUser"]>>;
    });
    mock(repositoryFactory, "createGroupRepository", () => groupRepository);
    const service = new ContainerService(repositoryFactory, createMock<ActiveUsersMap>({}), "localhost" as types.core.Host);
    return {service, calls};
}

// -- withGroupManagers --

it("puts a caller who is a manager through one of the new grants on the managers list", async () => {
    const {service} = createService([managerGroupId]);
    expect(await service.effectiveManagers([bob], [managerGrant])).toEqual([bob, alice]);
});

it("leaves the list alone for a caller the grants make a plain user", async () => {
    const {service} = createService([userGroupId]);
    expect(await service.effectiveManagers([bob], [userGrant])).toEqual([bob]);
});

it("leaves the list alone for a caller in none of the granted groups", async () => {
    const {service} = createService([userGroupId]);
    expect(await service.effectiveManagers([bob], [managerGrant])).toEqual([bob]);
});

it("reads no roster when the grants hold no manager role", async () => {
    const {service, calls} = createService([managerGroupId]);
    expect(await service.effectiveManagers([bob], [userGrant])).toEqual([bob]);
    expect(await service.effectiveManagers([bob], [])).toEqual([bob]);
    expect(await service.effectiveManagers([bob], undefined)).toEqual([bob]);
    expect(calls.getGroupsOfUser).toBe(0);
});

it("reads no roster when the caller is already a named manager", async () => {
    const {service, calls} = createService([managerGroupId]);
    expect(await service.effectiveManagers([alice], [managerGrant])).toEqual([alice]);
    expect(calls.getGroupsOfUser).toBe(0);
});

it("reuses group ids the caller already fetched", async () => {
    const {service, calls} = createService([]);
    expect(await service.effectiveManagers([bob], [managerGrant], [managerGroupId])).toEqual([bob, alice]);
    expect(calls.getGroupsOfUser).toBe(0);
});

// -- what the lockout checks make of it --

class ContainerPolicy extends BasePolicy<{creator: types.cloud.UserId, users: types.cloud.UserId[], managers: types.cloud.UserId[], policy?: types.cloud.ContainerPolicy}, never> {
    protected isItemCreator() {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy.kvdb || {};
    }
}

/** A context that configures nothing, so creatorHasToBeManager and updaterCanBeRemovedFromManagers are the defaults. */
const emptyContext = {id: contextId, policy: {}} as unknown as db.context.Context;
const policy = new ContainerPolicy(new PolicyService());

function expectDenied(run: () => void) {
    try {
        run();
    }
    catch (e) {
        expect(AppException.is(e, "ACCESS_DENIED")).toBe(true);
        return;
    }
    throw new Error("expected ACCESS_DENIED");
}

it("lets a creator who is a manager only through a grant create the container", async () => {
    const {service} = createService([managerGroupId]);
    const managers = await service.effectiveManagers([], [managerGrant]);
    policy.makeCreateContainerCheck({userId: alice} as db.context.ContextUser, emptyContext, managers, {});
});

it("still refuses a creator no grant makes a manager", async () => {
    const {service} = createService([userGroupId]);
    const managers = await service.effectiveManagers([], [managerGrant]);
    expectDenied(() => policy.makeCreateContainerCheck({userId: alice} as db.context.ContextUser, emptyContext, managers, {}));
});

it("lets a manager through a grant update without naming themselves a manager", async () => {
    const {service} = createService([managerGroupId]);
    const container = await service.asMember({users: [bob], managers: [bob], groups: [managerGrant]}, [managerGroupId]);
    const managers = await service.effectiveManagers([bob], [managerGrant], [managerGroupId]);
    policy.makeUpdateContainerCheck({userId: alice} as db.context.ContextUser, emptyContext, {...container, creator: bob}, managers, undefined);
});

it("still refuses an update that drops the grant the caller's manager role came from", async () => {
    // Revoking the grant really does take alice's manager role away, which is what the check is for.
    const {service} = createService([managerGroupId]);
    const container = await service.asMember({users: [bob], managers: [bob], groups: [managerGrant]}, [managerGroupId]);
    const managers = await service.effectiveManagers([bob], [], [managerGroupId]);
    expectDenied(() => policy.makeUpdateContainerCheck({userId: alice} as db.context.ContextUser, emptyContext, {...container, creator: bob}, managers, undefined));
});
