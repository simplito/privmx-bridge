/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as contextApi from "./ContextApiTypes";
import { BaseApiClient } from "../../BaseApiClient";
import * as types from "../../../types";

export class ContextApiClient extends BaseApiClient implements contextApi.IContextApi {
    
    contextGet(model: contextApi.ContextGetModel): Promise<contextApi.ContextGetResult> {
        return this.request("context.contextGet", model);
    }
    
    contextList(model: contextApi.ContextListModel): Promise<contextApi.ContextListResult> {
        return this.request("context.contextList", model);
    }
    
    contextGetUsers(model: contextApi.ContextGetUsersModel): Promise<contextApi.ContextGetUserResult> {
        return this.request("context.contextGetUsers", model);
    }
    
    contextListUsers(model: contextApi.ContextListUsersModel): Promise<contextApi.ContextListUsersResult> {
        return this.request("context.contextListUsers", model);
    }
    
    contextSendCustomEvent(model: contextApi.ContextSendCustomEventModel): Promise<types.core.OK> {
        return this.request("context.contextSendCustomEvent", model);
    }
}
