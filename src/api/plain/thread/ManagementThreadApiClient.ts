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
import * as threadApi from "./ManagementThreadApiTypes";

export class ManagementThreadApiClient implements threadApi.IThreadApi {
    
    constructor(
        private requester: Requester,
    ) {}

    async getThread(model: threadApi.GetThreadModel): Promise<threadApi.GetThreadResult> {
        return await this.requester.request("thread/getThread", model);
    }

    async listThreads(model: threadApi.ListThreadsModel): Promise<threadApi.ListThreadsResult> {
        return await this.requester.request("thread/listThreads", model);
    }

    async deleteThread(model: threadApi.DeleteThreadModel): Promise<types.core.OK> {
        return await this.requester.request("thread/deleteThread", model);
    }

    async deleteManyThreads(model: threadApi.DeleteManyThreadsModel): Promise<threadApi.DeleteManyThreadsResult> {
        return await this.requester.request("thread/deleteManyThreads", model);
    }

    async getThreadMessage(model: threadApi.GetThreadMessageModel): Promise<threadApi.GetThreadMessageResult> {
        return await this.requester.request("thread/getThreadMessage", model);
    }

    async listThreadMessages(model: threadApi.ListThreadMessagesModel): Promise<threadApi.ListThreadMessagesResult> {
        return await this.requester.request("thread/listThreadMessages", model);
    }
    
    async deleteThreadMessage(model: threadApi.DeleteThreadMessageModel): Promise<types.core.OK> {
        return await this.requester.request("thread/deleteThreadMessage", model);
    }

    async deleteManyThreadMessages(model: threadApi.DeleteManyThreadMessagesModel): Promise<threadApi.DeleteManyThreadMessagesResult> {
        return await this.requester.request("thread/deleteManyThreadMessages", model);
    }

    async deleteThreadMessagesOlderThan(model: threadApi.DeleteThreadMessagesOlderThanModel): Promise<threadApi.DeleteThreadMessagesOlderThanResult> {
        return await this.requester.request("thread/deleteThreadMessagesOlderThan", model);
    }
}