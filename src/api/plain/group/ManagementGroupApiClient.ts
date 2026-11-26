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
import * as groupApi from "./ManagementGroupApiTypes";

export class ManagementGroupApiClient implements groupApi.IGroupApi {
    
    constructor(
        private requester: Requester,
    ) {}
    
    async getGroup(model: groupApi.GetGroupModel): Promise<groupApi.GetGroupResult> {
        return await this.requester.request("group/getGroup", model);
    }
    
    async listGroups(model: groupApi.ListGroupsModel): Promise<groupApi.ListGroupsResult> {
        return await this.requester.request("group/listGroups", model);
    }
    
    async listGroupsOfUser(model: groupApi.ListGroupsOfUserModel): Promise<groupApi.ListGroupsOfUserResult> {
        return await this.requester.request("group/listGroupsOfUser", model);
    }
    
    async listGroupCommits(model: groupApi.ListGroupCommitsModel): Promise<groupApi.ListGroupCommitsResult> {
        return await this.requester.request("group/listGroupCommits", model);
    }
    
    async deleteGroup(model: groupApi.DeleteGroupModel): Promise<types.core.OK> {
        return await this.requester.request("group/deleteGroup", model);
    }
    
    async deleteManyGroups(model: groupApi.DeleteManyGroupsModel): Promise<groupApi.DeleteManyGroupsResult> {
        return await this.requester.request("group/deleteManyGroups", model);
    }
}
