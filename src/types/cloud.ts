/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type InstanceId = string&{__instanceId: never};
export type SolutionId = string&{__solutionId: never};
export type SolutionName = string&{__solutionName: never};
export type UserId = string&{__userId: never};
export type ContextAcl = string&{__contextAcl: never};
export type AclFunctionName = string&{__aclFunctionName: never};
export type AclFunctionArgument = string&{__aclFunctionArgument: never};
export type AclFunctions = Record<AclFunctionName, AclFunctionArgument[]>;
export type AclGroupName = string&{__aclGroupName: never};
export type AclGroups =  Record<AclGroupName, AclFunctions>;
export type AppPubKey = types.core.EccPubKey;
export type UserPubKey = types.core.EccPubKey;

export interface UserKeysEntry {
    user: UserId;
    keys: types.core.KeyEntry[];
}

export interface KeyEntrySet {
    user: UserId;
    keyId: types.core.KeyId;
    data: types.core.UserKeyData;
}

export interface Event<T extends string, C extends string, D> {
    type: T;
    channel: C;
    data: D;
}

export interface ContainerWithoutItemPolicy extends ItemPolicy {
    /** Determine who can get a container */
    get?: PolicyEntry;
    /** Determine who can list containers created by me */
    listMy?: PolicyEntry;
    /** Determine who can list all containers */
    listAll?: PolicyEntry;
    /** Determine who can create a container */
    create?: PolicyEntry;
    /** Determine who can update a container */
    update?: PolicyEntry;
    /** Determine who can update a container */
    delete?: PolicyEntry;
    /** Determine who can update policy */
    updatePolicy?: PolicyEntry;
    /** Determine whether the creator has to be added to the list of managers */
    creatorHasToBeManager?: PolicyBooleanEntry;
    /** Determine whether the updater can be removed from the list of managers */
    updaterCanBeRemovedFromManagers?: PolicyBooleanEntry;
    /** Determine whether the owner can be removed from the list of managers */
    ownerCanBeRemovedFromManagers?: PolicyBooleanEntry;
    /** Determine whether the policy can be overwritten in container */
    canOverwriteContextPolicy?: PolicyBooleanEntry;
}

export interface ContainerPolicy extends ContainerWithoutItemPolicy {
    /** Item policy */
    item?: ItemPolicy;
}

/** @doctype string */
export type PolicyEntry = "inherit"|"yes"|"no"|"default"|"none"|"all"|"user"|"owner"|"manager"|"itemOwner"|"itemOwner&user"|"itemOwner&user,manager"|"owner&user"|"manager&owner"|"itemOwner,manager"|"itemOwner,owner"|"itemOwner,manager,owner"|"manager,owner"|(string&{__policyEntry: never});
export type PolicyBooleanEntry = "inherit"|"default"|"yes"|"no";

export interface ItemPolicy {
    /** Determine who can get an item */
    get?: PolicyEntry;
    /** Determine who can list items created by me */
    listMy?: PolicyEntry;
    /** Determine who can list all items */
    listAll?: PolicyEntry;
    /** Determine who can create an item */
    create?: PolicyEntry;
    /** Determine who can update an item */
    update?: PolicyEntry;
    /** Determine who can update an item */
    delete?: PolicyEntry;
}
