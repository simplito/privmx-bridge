/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Requester } from "../../../CommonTypes";
import * as types from "../../../types";
import * as managerApi from "./ManagerApiTypes";

export class ManagerApiClient implements managerApi.IManagerApi {
    
    constructor(
        private requester: Requester,
    ) {}
    
    async auth(model: managerApi.AuthModel): Promise<managerApi.AuthResult> {
        return await this.requester.request("manager/auth", model);
    }
    
    async createApiKey(model: managerApi.CreateApiKeyModel): Promise<managerApi.CreateApiKeyResult> {
        return await this.requester.request("manager/createApiKey", model);
    }
    
    async getApiKey(model: managerApi.GetApiKeyModel): Promise<managerApi.GetApiKeyResult> {
        return await this.requester.request("manager/getApiKey", model);
    }
    
    async listApiKeys(): Promise<managerApi.ListApiKeysResult> {
        return await this.requester.request("manager/listApiKeys", {});
    }
    
    async updateApiKey(model: managerApi.UpdateApiKeyModel): Promise<types.core.OK> {
        return await this.requester.request("manager/updateApiKey", model);
    }
    
    async deleteApiKey(model: managerApi.DeleteApiKeyModel): Promise<types.core.OK> {
        return await this.requester.request("manager/deleteApiKey", model);
    }
    
    async bindAccessToken(model: managerApi.BindAccessTokenModel): Promise<types.core.OK> {
        return await this.requester.request("manager/bindAccessToken", model);
    }
    
    async subscribeToChannel(model: managerApi.SubscribeToChannelModel): Promise<types.core.OK> {
        return await this.requester.request("manager/subscribeToChannel", model);
    }
    
    async unsubscribeFromChannel(model: managerApi.UnsubscribeFromChannelModel): Promise<types.core.OK> {
        return await this.requester.request("manager/unsubscribeFromChannel", model);
    }
}