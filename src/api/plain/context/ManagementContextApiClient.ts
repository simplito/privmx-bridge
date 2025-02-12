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
import * as managementContextApi from "./ManagementContextApiTypes";

export class ManagementContextApiClient implements managementContextApi.IContextApi {
    
    constructor(
        private requester: Requester,
    ) {}
    
    async getContext(model: managementContextApi.GetContextModel): Promise<managementContextApi.GetContextResult> {
        return await this.requester.request("context/getContext", model);
    }
    
    async listContexts(model: managementContextApi.ListContextsModel): Promise<managementContextApi.ListContextsResult> {
        return await this.requester.request("context/listContexts", model);
    }
    
    async listContextsOfSolution(model: managementContextApi.ListContextsOfSolutionModel): Promise<managementContextApi.ListContextsResult> {
        return await this.requester.request("context/listContextsOfSolution", model);
    }
    
    async createContext(model: managementContextApi.CreateContextModel): Promise<managementContextApi.CreateContextResult> {
        return await this.requester.request("context/createContext", model);
    }
    
    async updateContext(model: managementContextApi.UpdateContextModel): Promise<types.core.OK> {
        return await this.requester.request("context/updateContext", model);
    }
    
    async deleteContext(model: managementContextApi.DeleteContextModel): Promise<types.core.OK> {
        return await this.requester.request("context/deleteContext", model);
    }
    
    async addSolutionToContext(model: managementContextApi.AddSolutionToContextModel): Promise<types.core.OK> {
        return await this.requester.request("context/addSolutionToContext", model);
    }
    
    async removeSolutionFromContext(model: managementContextApi.RemoveSolutionFromContextModel): Promise<types.core.OK> {
        return await this.requester.request("context/removeSolutionFromContext", model);
    }
    
    async addUserToContext(model: managementContextApi.AddUserToContextModel): Promise<types.core.OK> {
        return await this.requester.request("context/addUserToContext", model);
    }
    
    async removeUserFromContext(model: managementContextApi.RemoveUserFromContextModel): Promise<types.core.OK> {
        return await this.requester.request("context/removeUserFromContext", model);
    }
    
    async removeUserFromContextByPubKey(model: managementContextApi.RemoveUserFromContextByPubKeyModel): Promise<types.core.OK> {
        return await this.requester.request("context/removeUserFromContextByPubKey", model);
    }
    
    async getUserFromContext(model: managementContextApi.GetUserFromContextModel): Promise<managementContextApi.GetUserFromContextResult> {
        return await this.requester.request("context/getUserFromContext", model);
    }
    
    async getUserFromContextByPubKey(model: managementContextApi.GetUserFromContextByPubKeyModel): Promise<managementContextApi.GetUserFromContextResult> {
        return await this.requester.request("context/getUserFromContextByPubKey", model);
    }
    
    async listUsersFromContext(model: managementContextApi.ListUsersFromContextModel): Promise<managementContextApi.ListUsersFromContextResult> {
        return await this.requester.request("context/listUsersFromContext", model);
    }
    
    async setUserAcl(model: managementContextApi.SetUserAclModel): Promise<types.core.OK> {
        return await this.requester.request("context/setUserAcl", model);
    }
}