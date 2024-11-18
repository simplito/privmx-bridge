/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { PolicyService, PolicyUser } from "./PolicyService";
import * as db from "../../db/Model";
import * as types from "../../types";
import { AppException } from "../../api/AppException";

export abstract class BasePolicy<T extends {creator: types.cloud.UserId; users: types.cloud.UserId[]; managers: types.cloud.UserId[]; policy?: types.cloud.ContainerPolicy;}, I> {
    
    constructor(
        private policyService: PolicyService,
    ) {
    }
    
    makeCreateContainerCheck(user: db.context.ContextUser, context: db.context.Context, managers: types.cloud.UserId[], policy: types.cloud.ContainerPolicy) {
        if (!this.canCreateContainer(user, context)) {
            throw new AppException("ACCESS_DENIED", "policy is not met");
        }
        if (Object.keys(policy).length > 0 && !this.canOverwriteContextPolicy(context)) {
            throw new AppException("ACCESS_DENIED", "cannot overwrite policy");
        }
        if (this.creatorIsNotManagerAndItIsForbidden(context, user, managers)) {
            throw new AppException("ACCESS_DENIED", "creator has to belong to managers");
        }
    }
    
    makeUpdateContainerCheck(user: db.context.ContextUser, context: db.context.Context, oldContainer: T, managers: types.cloud.UserId[], policy: types.cloud.ContainerPolicy|undefined) {
        if (!this.canUpdateContainer(user, context, oldContainer)) {
            throw new AppException("ACCESS_DENIED", "policy is not met");
        }
        if (this.updaterIsRemovedFromManagersAndItIsForbidden(context, oldContainer, user, managers)) {
            throw new AppException("ACCESS_DENIED", "modifier has to belong to managers");
        }
        if (this.ownerIsRemovedFromManagersAndItIsForbidden(context, oldContainer, managers)) {
            throw new AppException("ACCESS_DENIED", "owner has to belong to managers");
        }
        if (policy !== undefined && (!this.canOverwriteContextPolicy(context) || !this.canUpdateContainerPolicy(user, context, oldContainer))) {
            throw new AppException("ACCESS_DENIED", "cannot update policy");
        }
    }
    
    canCreateContainer(user: db.context.ContextUser, context: db.context.Context) {
        return this.isContextPolicyMet(user, context, p => p?.create);
    }
    
    canUpdateContainer(user: db.context.ContextUser, context: db.context.Context, container: T) {
        return this.isContainerPolicMet(user, context, container, p => p?.update);
    }
    
    canUpdateContainerPolicy(user: db.context.ContextUser, context: db.context.Context, container: T) {
        return this.isContainerPolicMet(user, context, container, p => p?.updatePolicy);
    }
    
    canDeleteContainer(user: db.context.ContextUser, context: db.context.Context, container: T) {
        return this.isContainerPolicMet(user, context, container, p => p?.delete);
    }
    
    canReadContainer(user: db.context.ContextUser, context: db.context.Context, container: T) {
        return this.isContainerPolicMet(user, context, container, p => p?.get);
    }
    
    canListMyContainers(user: db.context.ContextUser, context: db.context.Context) {
        return this.isContextPolicyMet(user, context, p => p?.listMy);
    }
    
    canListAllContainers(user: db.context.ContextUser, context: db.context.Context) {
        return this.isContextPolicyMet(user, context, p => p?.listAll);
    }
    
    canReadItem(user: db.context.ContextUser, context: db.context.Context, container: T, item: I) {
        return this.isContainerItemPolicMet(user, context, container, item, p => p?.item?.get);
    }
    
    canListAllItems(user: db.context.ContextUser, context: db.context.Context, container: T) {
        return this.isContainerPolicMet(user, context, container, p => p?.item?.listAll);
    }

    canListMyItems(user: db.context.ContextUser, context: db.context.Context, container: T) {
        return this.isContainerPolicMet(user, context, container, p => p?.item?.listMy);
    }
    
    canCreateItem(user: db.context.ContextUser, context: db.context.Context, container: T) {
        return this.isContainerPolicMet(user, context, container, p => p?.item?.create);
    }
    
    canUpdateItem(user: db.context.ContextUser, context: db.context.Context, container: T, item: I) {
        return this.isContainerItemPolicMet(user, context, container, item, p => p?.item?.update);
    }
    
    canDeleteItem(user: db.context.ContextUser, context: db.context.Context, container: T, item: I) {
        return this.isContainerItemPolicMet(user, context, container, item, p => p?.item?.delete);
    }
    
    creatorHasToBeManager(context: db.context.Context) {
        return this.getPolicyBooleanValue(context, p => p?.creatorHasToBeManager);
    }
    
    canOverwriteContextPolicy(context: db.context.Context) {
        return this.getPolicyBooleanValue(context, p => p?.canOverwriteContextPolicy);
    }
    
    updaterCanBeRemovedFromManagers(context: db.context.Context, container: T) {
        return this.getPolicyBooleanValue2x(context, container, p => p?.updaterCanBeRemovedFromManagers);
    }
    
    ownerCanBeRemovedFromManagers(context: db.context.Context, container: T) {
        return this.getPolicyBooleanValue2x(context, container, p => p?.ownerCanBeRemovedFromManagers);
    }
    
    creatorIsNotManagerAndItIsForbidden(context: db.context.Context, creator: db.context.ContextUser, managers: types.cloud.UserId[]) {
        return !this.isOnManagersList(creator, managers) && this.creatorHasToBeManager(context);
    }
    
    updaterIsRemovedFromManagersAndItIsForbidden(context: db.context.Context, container: T, updater: db.context.ContextUser, newManagers: types.cloud.UserId[]) {
        return this.isOnManagersList(updater, container.managers) && !this.isOnManagersList(updater, newManagers) && !this.updaterCanBeRemovedFromManagers(context, container);
    }
    
    ownerIsRemovedFromManagersAndItIsForbidden(context: db.context.Context, container: T, newManagers: types.cloud.UserId[]) {
        return this.isOnManagersList(container.creator, container.managers) && !this.isOnManagersList(container.creator, newManagers) && !this.ownerCanBeRemovedFromManagers(context, container);
    }
    
    protected isContextPolicyMet(user: db.context.ContextUser, context: db.context.Context, func: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        return this.policyService.isPolicyMet(this.getPolicyUser(user), context, policy => func(this.extractPolicyFromContext(policy)));
    }
    
    protected isContainerPolicMet(user: db.context.ContextUser, context: db.context.Context, container: T, func: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        return this.isContainerPolicMetCore(this.getPolicyUser(user, container), context, container, func);
    }
    
    protected isContainerItemPolicMet(user: db.context.ContextUser, context: db.context.Context, container: T, item: I, func: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        return this.isContainerPolicMetCore(this.getPolicyUser(user, container, item), context, container, func);
    }
    
    protected isContainerPolicMetCore(user: PolicyUser, context: db.context.Context, container: T, func: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        return this.policyService.isPolicyMet2x(user, context, container.policy || {}, p => this.extractPolicyFromContext(p), func);
    }
    
    protected getPolicyBooleanValue(context: db.context.Context, func: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        const value = this.policyService.getPolicy(context, policy => func(this.extractPolicyFromContext(policy)));
        if (value !== "yes" && value !== "no") {
            throw new Error(`Invalid policy value, expected yes/no get ${value}`);
        }
        return value === "yes";
    }
    
    protected getPolicyBooleanValue2x(context: db.context.Context, container: T, func: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        const value = this.policyService.getPolicy2x(context, container.policy || {}, p => this.extractPolicyFromContext(p), func);
        if (value !== "yes" && value !== "no") {
            throw new Error(`Invalid policy value, expected yes/no get ${value}`);
        }
        return value === "yes";
    }
    
    protected getPolicyUser(user: db.context.ContextUser, container?: T, item?: I) {
        const res: PolicyUser = {
            user: container && (this.isOnUsersList(user, container) || this.isOnManagersList(user, container.managers)),
            manager: container && this.isOnManagersList(user, container.managers),
            owner: container && this.isContainerCreator(user, container),
            itemOwner: item && this.isItemCreator(user, item),
        };
        return res;
    }
    
    protected isOnManagersList(user: db.context.ContextUser|types.cloud.UserId, managers: types.cloud.UserId[]) {
        return managers.includes(typeof(user) === "string" ? user : user.userId);
    }
    
    protected isOnUsersList(user: db.context.ContextUser, container: T) {
        return container.users.includes(user.userId);
    }
    
    protected isContainerCreator(user: db.context.ContextUser, container: T) {
        return container.creator === user.userId;
    }
    
    protected abstract isItemCreator(user: db.context.ContextUser, item: I): boolean;
    
    protected abstract extractPolicyFromContext(policy: types.context.ContextPolicy): types.cloud.ContainerPolicy;
}
