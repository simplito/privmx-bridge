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

export interface IContextApi {
    contextGet(model: ContextGetModel): Promise<ContextGetResult>;
    contextList(model: ContextListModel): Promise<ContextListResult>;
}
