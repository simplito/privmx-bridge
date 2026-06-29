/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface ContextGetModel {
    id: types.context.ContextId;
}

export interface ContextGetResult {
    context: ContextInfo;
}

export interface ContextInfo {
    userId: types.cloud.UserId;
    contextId: types.context.ContextId;
    acl: types.cloud.ContextAcl;
    policy: types.context.ContextPolicy;
    created: types.core.Timestamp;
    modified: types.core.Timestamp;
    name: types.context.ContextName;
    description: types.context.ContextDescription;
    scope: types.context.ContextScope;
}

export type ContextListModel = types.core.ListModel;

export interface ContextListResult {
    contexts: ContextInfo[];
    count: number;
}

export interface ContextGetUsersModel{
    contextId: types.context.ContextId;
}

export interface ContextGetUserResult {
    users: types.cloud.UserIdentityWithStatus[];
}

export interface ContextListUsersModel extends types.core.ListModel{
    contextId: types.context.ContextId;
}

export interface ContextListUsersResult {
    users: types.cloud.UserIdentityWithStatusAndAction[];
    count: number;
}

export interface ContextSendCustomEventModel {
    contextId: types.context.ContextId;
    channel: types.core.WsChannelName;
    data: unknown;
    users: {
        id: types.cloud.UserId;
        key: types.core.UserKeyData;
    }[];
}

export type ContextCustomEvent = types.cloud.Event<"custom", `context/${types.context.ContextId}/${types.core.WsChannelName}`, ContextCustomEventData>;

export interface ContextCustomEventData {
    id: types.context.ContextId;
    eventData: unknown;
    key: types.core.UserKeyData;
    author: types.cloud.UserIdentity;
};

export type ContextUserAddedEvent = types.cloud.Event<"contextUserAdded", "context", ContextUserAddedEventData>;

export interface ContextUserAddedEventData {
    contextId: types.context.ContextId;
    userId: types.cloud.UserId;
    pubKey: types.core.EccPubKey;
}

export type ContextUserRemovedEvent = types.cloud.Event<"contextUserRemoved", "context", ContextUserRemovedEventData>;

export interface ContextUserRemovedEventData {
    contextId: types.context.ContextId;
    userId: types.cloud.UserId;
    pubKey: types.core.EccPubKey;
}

export type ContextUsersStatusChange = types.cloud.Event<"contextUserStatusChanged", "context", ContextUsersStatusChangeData>;

export interface ContextUsersStatusChangeData {
    contextId: types.context.ContextId;
    users: {
        userId: types.cloud.UserId,
        pubKey: types.core.EccPubKey,
        action: "login"|"logout",
    }[],
}

// ===================
//        GROUP
// ===================

export interface GroupCreateModel {
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.group.GroupType;
    groupPubKey: types.cloud.GroupPubKey;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerPolicy;
}

export interface GroupCreateResult {
    groupId: types.group.GroupId;
}

export interface GroupUpdateModel {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    resourceId?: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.group.GroupVersion;
    force: boolean;
    policy?: types.cloud.ContainerPolicy;
    expectedKeyVersion?: number;
    confirmationTag?: types.core.Base64;
}

export interface GroupGenerateNewKeyModel {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    data: types.group.GroupData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    expectedKeyVersion: number;
    confirmationTag?: types.core.Base64;
}

export interface RotatedAlreadyData {
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
    winnerKeyEntry: types.core.KeyEntry;
}

export interface GroupDeleteModel {
    groupId: types.group.GroupId;
}

export interface GroupGetModel {
    groupId: types.group.GroupId;
    type?: types.group.GroupType;
}

export interface GroupGetResult {
    group: GroupInfo;
}

export interface GroupListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface GroupListResult {
    groups: GroupInfo[];
    count: number;
}

export interface GroupDataEntry {
    keyId: types.core.KeyId;
    data: types.group.GroupData;
}

/** A group version record. The membership signature + chain link is committed inside the opaque `data`
 *  (endpoint DIO) and verified client-side; the bridge stores it but does not interpret it. */
export interface GroupHistoryEntryInfo {
    keyId: types.core.KeyId;
    groupPubKey: types.cloud.GroupPubKey;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    created: types.core.Timestamp;
    author: types.cloud.UserId;
    confirmationTag?: types.core.Base64;
}

export interface GroupInfo {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.group.GroupType;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: GroupDataEntry[];
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.group.GroupVersion;
    keyVersion: number;
    keyHistory: types.cloud.GroupPubKeyAtEpoch[];
    policy: types.cloud.ContainerPolicy;
    history: GroupHistoryEntryInfo[];
}

export type GroupCreatedEvent = types.cloud.Event<"groupCreated", "context", GroupInfo>;
export type GroupUpdatedEvent = types.cloud.Event<"groupUpdated", "context", GroupInfo>;
export type GroupDeletedEvent = types.cloud.Event<"groupDeleted", "context", GroupDeletedEventData>;

export interface GroupDeletedEventData {
    groupId: types.group.GroupId;
    contextId: types.context.ContextId;
}

export interface IContextApi {
    contextGet(model: ContextGetModel): Promise<ContextGetResult>;
    contextList(model: ContextListModel): Promise<ContextListResult>;
    contextGetUsers(model: ContextGetUsersModel): Promise<ContextGetUserResult>;
    contextListUsers(model: ContextListUsersModel): Promise<ContextListUsersResult>
    contextSendCustomEvent(model: ContextSendCustomEventModel): Promise<types.core.OK>;
    groupCreate(model: GroupCreateModel): Promise<GroupCreateResult>;
    groupUpdate(model: GroupUpdateModel): Promise<types.core.OK>;
    groupGenerateNewKey(model: GroupGenerateNewKeyModel): Promise<types.core.OK>;
    groupDelete(model: GroupDeleteModel): Promise<types.core.OK>;
    groupGet(model: GroupGetModel): Promise<GroupGetResult>;
    groupList(model: GroupListModel): Promise<GroupListResult>;
}
