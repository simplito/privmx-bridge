/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { AppException } from "../../api/AppException";
import * as db from "../../db/Model";
import { Utils } from "../../utils/Utils";

export interface PolicyUser {
    user?: boolean;
    manager?: boolean;
    owner?: boolean;
    itemOwner?: boolean;
}

export const DefaultContextPolicy: types.context.ContextPolicy = {
    thread: {
        get: "user",
        listMy: "all",
        listAll: "none",
        create: "all",
        update: "manager",
        delete: "manager",
        updatePolicy: "manager",
        creatorHasToBeManager: "yes",
        updaterCanBeRemovedFromManagers: "no",
        ownerCanBeRemovedFromManagers: "yes",
        canOverwriteContextPolicy: "yes",
        item: {
            get: "user",
            listMy: "user",
            listAll: "user",
            create: "user",
            update: "itemOwner&user,manager",
            delete: "itemOwner&user,manager",
        }
    },
    store: {
        get: "user",
        listMy: "all",
        listAll: "none",
        create: "all",
        update: "manager",
        delete: "manager",
        updatePolicy: "manager",
        creatorHasToBeManager: "yes",
        updaterCanBeRemovedFromManagers: "no",
        ownerCanBeRemovedFromManagers: "yes",
        canOverwriteContextPolicy: "yes",
        item: {
            get: "user",
            listMy: "user",
            listAll: "user",
            create: "user",
            update: "itemOwner&user,manager",
            delete: "itemOwner&user,manager",
        }
    },
    inbox: {
        get: "user",
        listMy: "all",
        listAll: "none",
        create: "all",
        update: "manager",
        delete: "manager",
        updatePolicy: "manager",
        creatorHasToBeManager: "yes",
        updaterCanBeRemovedFromManagers: "no",
        ownerCanBeRemovedFromManagers: "yes",
        canOverwriteContextPolicy: "yes",
    },
    stream: {
        get: "user",
        listMy: "all",
        listAll: "none",
        create: "all",
        update: "manager",
        delete: "manager",
        updatePolicy: "manager",
        creatorHasToBeManager: "yes",
        updaterCanBeRemovedFromManagers: "no",
        ownerCanBeRemovedFromManagers: "yes",
        canOverwriteContextPolicy: "yes",
    },
};

export class PolicyService {
    
    validateContextPolicy(policy: types.context.ContextPolicy) {
        if (policy.thread) {
            this.validateContainerPolicyForContext("policy.thread", policy.thread);
        }
        if (policy.store) {
            this.validateContainerPolicyForContext("policy.store", policy.store);
        }
        if (policy.inbox) {
            this.validateContainerPolicyForContext("policy.inbox", policy.inbox);
        }
        if (policy.stream) {
            this.validateContainerPolicyForContext("policy.stream", policy.stream);
        }
    }
    
    private validateContainerPolicyForContext(path: string, policy: types.cloud.ContainerPolicy) {
        if (policy.get !== undefined) {
            this.validatePolicyEntry(path + ".get", policy.get, ["default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.listMy !== undefined) {
            this.validatePolicyEntry(path + ".listMy", policy.listMy, ["default", "none", "all"], []);
        }
        if (policy.listAll !== undefined) {
            this.validatePolicyEntry(path + ".listAll", policy.listMy, ["default", "none", "all"], []);
        }
        if (policy.create !== undefined) {
            this.validatePolicyEntry(path + ".create", policy.create, ["default", "none", "all"], []);
        }
        if (policy.update !== undefined) {
            this.validatePolicyEntry(path + ".update", policy.update, ["default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.updatePolicy !== undefined) {
            this.validatePolicyEntry(path + ".updatePolicy", policy.updatePolicy, ["default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.delete !== undefined) {
            this.validatePolicyEntry(path + ".delete", policy.delete, ["default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.canOverwriteContextPolicy !== undefined) {
            this.validatePolicyEntry(path + ".canOverwriteContextPolicy", policy.canOverwriteContextPolicy, ["default", "yes", "no"], []);
        }
        if (policy.creatorHasToBeManager !== undefined) {
            this.validatePolicyEntry(path + ".creatorHasToBeManager", policy.creatorHasToBeManager, ["default", "yes", "no"], []);
        }
        if (policy.updaterCanBeRemovedFromManagers !== undefined) {
            this.validatePolicyEntry(path + ".updaterCanBeRemovedFromManagers", policy.updaterCanBeRemovedFromManagers, ["default", "yes", "no"], []);
        }
        if (policy.ownerCanBeRemovedFromManagers !== undefined) {
            this.validatePolicyEntry(path + ".ownerCanBeRemovedFromManagers", policy.ownerCanBeRemovedFromManagers, ["default", "yes", "no"], []);
        }
        if (policy.item !== undefined) {
            this.validateItemPolicy(path + ".item", policy.item, false);
        }
    }
    
    validateContainerPolicyForContainer(path: string, policy: types.cloud.ContainerPolicy) {
        if (policy.get !== undefined) {
            this.validatePolicyEntry(path + ".get", policy.get, ["inherit", "default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.listMy !== undefined) {
            throw new AppException("INVALID_PARAMS", `${path}.listMy is not allowed here`);
        }
        if (policy.listAll !== undefined) {
            throw new AppException("INVALID_PARAMS", `${path}.listAll is not allowed here`);
        }
        if (policy.create !== undefined) {
            throw new AppException("INVALID_PARAMS", `${path}.create is not allowed here`);
        }
        if (policy.update !== undefined) {
            this.validatePolicyEntry(path + ".update", policy.update, ["inherit", "default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.updatePolicy !== undefined) {
            this.validatePolicyEntry(path + ".updatePolicy", policy.updatePolicy, ["inherit", "default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.delete !== undefined) {
            this.validatePolicyEntry(path + ".delete", policy.delete, ["inherit", "default", "none", "all"], ["user", "manager", "owner"]);
        }
        if (policy.canOverwriteContextPolicy !== undefined) {
            throw new AppException("INVALID_PARAMS", `${path}.canOverwriteContextPolicy is not allowed here`);
        }
        if (policy.creatorHasToBeManager !== undefined) {
            throw new AppException("INVALID_PARAMS", `${path}.creatorHasToBeManager is not allowed here`);
        }
        if (policy.updaterCanBeRemovedFromManagers !== undefined) {
            this.validatePolicyEntry(path + ".updaterCanBeRemovedFromManagers", policy.updaterCanBeRemovedFromManagers, ["inherit", "default", "yes", "no"], []);
        }
        if (policy.ownerCanBeRemovedFromManagers !== undefined) {
            this.validatePolicyEntry(path + ".ownerCanBeRemovedFromManagers", policy.ownerCanBeRemovedFromManagers, ["inherit", "default", "yes", "no"], []);
        }
        if (policy.item !== undefined) {
            this.validateItemPolicy(path + ".item", policy.item, true);
        }
    }
    
    private validateItemPolicy(path: string, policy: types.cloud.ItemPolicy, allowInherit: boolean) {
        const baseValues = allowInherit ? ["default", "none", "all", "inherit"] : ["default", "none", "all"];
        if (policy.get !== undefined) {
            this.validatePolicyEntry(path + ".get", policy.get, baseValues, ["user", "itemOwner", "manager", "owner"]);
        }
        if (policy.listMy !== undefined) {
            this.validatePolicyEntry(path + ".listMy", policy.listMy, baseValues, ["user", "manager", "owner"]);
        }
        if (policy.listAll !== undefined) {
            this.validatePolicyEntry(path + ".listAll", policy.listAll, baseValues, ["user", "manager", "owner"]);
        }
        if (policy.create !== undefined) {
            this.validatePolicyEntry(path + ".create", policy.create, baseValues, ["user", "manager", "owner"]);
        }
        if (policy.update !== undefined) {
            this.validatePolicyEntry(path + ".update", policy.update, baseValues, ["user", "itemOwner", "manager", "owner"]);
        }
        if (policy.delete !== undefined) {
            this.validatePolicyEntry(path + ".delete", policy.delete, baseValues, ["user", "itemOwner", "manager", "owner"]);
        }
    }
    
    private isValidPolicyEntry(value: string, availableValues: string[], combination: string[]) {
        if (availableValues.includes(value)) {
            return true;
        }
        const fragments = value.split(",").map(x => x.split("&"));
        if (!fragments.every(x => Utils.isUnique(x) && x.every(y => combination.includes(y)))) {
            return false;
        }
        return Utils.isUnique(fragments.map(x => x.sort().join("&")));
    }
    
    private validatePolicyEntry(path: string, value: string, availableValues: string[], combination: string[]) {
        if (!this.isValidPolicyEntry(value, availableValues, combination)) {
            throw new AppException("INVALID_PARAMS", `${path} -> Invalid value, get '${value}' expected one of ${availableValues.join(",")} or combination of ${combination.join(",")}`);
        }
    }
    
    getPolicy(context: db.context.Context, func: (policy: types.context.ContextPolicy) => types.cloud.PolicyEntry|undefined) {
        const contextDefined = func(context.policy || {});
        return !contextDefined || contextDefined === "default" ? func(DefaultContextPolicy) : contextDefined;
    }
    
    isPolicyMet(user: PolicyUser, context: db.context.Context, func: (policy: types.context.ContextPolicy) => types.cloud.PolicyEntry|undefined) {
        return this.userMeetsPolicy(user, this.getPolicy(context, func));
    }
    
    getPolicy2x(context: db.context.Context, policy: types.cloud.ContainerPolicy, func: (policy: types.context.ContextPolicy) => types.cloud.ContainerPolicy|undefined, func2: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        const containerDefined = func2(policy || {});
        if (containerDefined) {
            if (containerDefined === "default") {
                return func2(func(DefaultContextPolicy) || {});
            }
            if (containerDefined !== "inherit") {
                return containerDefined;
            }
        }
        const contextDefined = func2(func(context.policy || {}) || {});
        return !contextDefined || contextDefined === "default" ? func2(func(DefaultContextPolicy) || {}) : contextDefined;
    }
    
    isPolicyMet2x(user: PolicyUser, context: db.context.Context, policy: types.cloud.ContainerPolicy, func: (policy: types.context.ContextPolicy) => types.cloud.ContainerPolicy|undefined, func2: (policy: types.cloud.ContainerPolicy) => types.cloud.PolicyEntry|undefined) {
        return this.userMeetsPolicy(user, this.getPolicy2x(context, policy, func, func2));
    }
    
    private userMeetsPolicy(user: PolicyUser, policy: types.cloud.PolicyEntry) {
        return (policy || "").split(",").some(fragment => fragment.split("&").every(atom => this.userMeetsPolicyAtom(user, atom)));
    }
    
    private userMeetsPolicyAtom(user: PolicyUser, atom: string) {
        if (atom === "none") {
            return false;
        }
        if (atom === "all") {
            return true;
        }
        if (atom === "user" && user.user) {
            return true;
        }
        if (atom === "manager" && user.manager) {
            return true;
        }
        if (atom === "owner" && user.owner) {
            return true;
        }
        if (atom === "itemOwner" && user.itemOwner) {
            return true;
        }
        return false;
    }
}
