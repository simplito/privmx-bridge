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

export interface IContextApi {
    contextGet(model: ContextGetModel): Promise<ContextGetResult>;
    contextList(model: ContextListModel): Promise<ContextListResult>;
    contextGetUsers(model: ContextGetUsersModel): Promise<ContextGetUserResult>;
    contextListUsers(model: ContextListUsersModel): Promise<ContextListUsersResult>
    contextSendCustomEvent(model: ContextSendCustomEventModel): Promise<types.core.OK>;
}
