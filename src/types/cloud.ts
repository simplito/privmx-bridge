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
export type KnownKeyId = string&{__knownKeyId: never};
export type KnownKeyStatus = "login"|"logout";
export type ChannelSchemeOptions = Pick<ChannelScheme, "containerType"|"limitedBy"|"objectId">;
export type ChannelSchemeSelectors = "containerId"|"itemId"|"contextId"|"none";

export interface UserIdentity {
    id: UserId;
    pub: UserPubKey;
}
export interface ChannelScheme {
    subscriptionId: types.core.SubscriptionId;
    orgChannel: string;
    path: string;
    limitedBy: string;
    objectId: string;
    version: number;
    containerType?: string;
}

export interface KnownKeyStatusChange {
    action: KnownKeyStatus;
    timestamp: types.core.Timestamp;
}

export interface UserIdentityWithStatus {
    id: UserId;
    pub: UserPubKey;
    status: "active"|"inactive";
}

export interface UserIdentityWithStatusAndAction {
    id: UserId;
    pub: UserPubKey;
    status: "active"|"inactive";
    lastStatusChange: null|KnownKeyStatusChange;
}

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
    timestamp: types.core.Timestamp;
}

export interface ContainerWithoutItemPolicy extends ItemPolicy {
    /** Determines who can get a container */
    get?: PolicyEntry;
    /** Determines who can list containers created by themselves */
    listMy?: PolicyEntry;
    /** Determines who can list all containers */
    listAll?: PolicyEntry;
    /** Determines who can create a container */
    create?: PolicyEntry;
    /** Determines who can update a container */
    update?: PolicyEntry;
    /** Determines who can update a container */
    delete?: PolicyEntry;
    /** Determines who can update policy */
    updatePolicy?: PolicyEntry;
    /** Determines whether the creator has to be added to the list of managers */
    creatorHasToBeManager?: PolicyBooleanEntry;
    /** Determines whether the updater can be removed from the list of managers */
    updaterCanBeRemovedFromManagers?: PolicyBooleanEntry;
    /** Determines whether the owner can be removed from the list of managers */
    ownerCanBeRemovedFromManagers?: PolicyBooleanEntry;
    /** Determines whether the policy can be overwritten in container */
    canOverwriteContextPolicy?: PolicyBooleanEntry;
    /** Determines who can send custom notifications */
    sendCustomNotification?: PolicyEntry;
}

export interface ContainerPolicy extends ContainerWithoutItemPolicy {
    /** Item policy */
    item?: ItemPolicy;
}

export interface ContextInnerPolicy {
    /** Determines who can list users of this context */
    listUsers?: PolicyEntry;
    /** Determines who can send custom notifications */
    sendCustomNotification?: PolicyEntry;
}

/** @doctype string */
export type PolicyEntry = "inherit"|"yes"|"no"|"default"|"none"|"all"|"user"|"owner"|"manager"|"itemOwner"|"itemOwner&user"|"itemOwner&user,manager"|"owner&user"|"manager&owner"|"itemOwner,manager"|"itemOwner,owner"|"itemOwner,manager,owner"|"manager,owner"|(string&{__policyEntry: never});
export type PolicyBooleanEntry = "inherit"|"default"|"yes"|"no";

export interface ItemPolicy {
    /** Determines who can get an item */
    get?: PolicyEntry;
    /** Determines who can list items created by themselves */
    listMy?: PolicyEntry;
    /** Determines who can list all items */
    listAll?: PolicyEntry;
    /** Determines who can create an item */
    create?: PolicyEntry;
    /** Determines who can update an item */
    update?: PolicyEntry;
    /** Determines who can update an item */
    delete?: PolicyEntry;
}
