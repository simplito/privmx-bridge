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
import * as inboxApi from "./ManagementInboxApiTypes";

export class ManagementInboxApiClient implements inboxApi.IInboxApi {
    
    constructor(
        private requester: Requester,
    ) {}
    
    async getInbox(model: inboxApi.GetInboxModel): Promise<inboxApi.GetInboxResult> {
        return await this.requester.request("inbox/getInbox", model);
    }
    
    async listInboxes(model: inboxApi.ListInboxesModel): Promise<inboxApi.ListInboxesResult> {
        return await this.requester.request("inbox/listInboxes", model);
    }
    
    async deleteInbox(model: inboxApi.DeleteInboxModel): Promise<types.core.OK> {
        return await this.requester.request("inbox/deleteInbox", model);
    }
    
    async deleteManyInboxes(model: inboxApi.DeleteManyInboxesModel): Promise<inboxApi.DeleteManyInboxesResult> {
        return await this.requester.request("inbox/deleteManyInboxes", model);
    }
}