/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as threadApi from "./ThreadApiTypes";
import { BaseApiClient } from "../../BaseApiClient";

export class ThreadApiClient extends BaseApiClient implements threadApi.IThreadApi {
    
    threadCreate(model: threadApi.ThreadCreateModel): Promise<threadApi.ThreadCreateResult> {
        return this.request("thread.threadCreate", model);
    }
    
    threadUpdate(model: threadApi.ThreadUpdateModel): Promise<types.core.OK> {
        return this.request("thread.threadUpdate", model);
    }
    
    threadDelete(model: threadApi.ThreadDeleteModel): Promise<types.core.OK> {
        return this.request("thread.threadDelete", model);
    }
    
    threadGet(model: threadApi.ThreadGetModel): Promise<threadApi.ThreadGetResult> {
        return this.request("thread.threadGet", model);
    }
    
    threadList(model: threadApi.ThreadListModel): Promise<threadApi.ThreadListResult> {
        return this.request("thread.threadList", model);
    }

    threadListAll(model: threadApi.ThreadListAllModel): Promise<threadApi.ThreadListAllResult> {
        return this.request("thread.threadListAll", model);
    }
    
    threadMessageSend(model: threadApi.ThreadMessageSendModel): Promise<threadApi.ThreadMessageSendResult> {
        return this.request("thread.threadMessageSend", model);
    }
    
    threadMessageUpdate(model: threadApi.ThreadMessageUpdateModel): Promise<types.core.OK> {
        return this.request("thread.threadMessageUpdate", model);
    }
    
    threadMessageDelete(model: threadApi.ThreadMessageDeleteModel): Promise<types.core.OK> {
        return this.request("thread.threadMessageDelete", model);
    }
    
    threadMessageGet(model: threadApi.ThreadMessageGetModel): Promise<threadApi.ThreadMessageGetResult> {
        return this.request("thread.threadMessageGet", model);
    }
    
    threadMessagesGet(model: threadApi.ThreadMessagesGetModel): Promise<threadApi.ThreadMessagesGetResult> {
        return this.request("thread.threadMessagesGet", model);
    }

    threadMessagesGetMy(model: threadApi.ThreadMessagesGetMyModel): Promise<threadApi.ThreadMessagesGetMyResult> {
        return this.request("thread.threadMessagesGetMy", model);
    }

    threadDeleteMany(model: threadApi.ThreadDeleteManyModel): Promise<threadApi.ThreadDeleteManyResult> {
        return this.request("thread.threadDeleteMany", model);
    }

    threadMessageDeleteMany(model: threadApi.ThreadMessageDeleteManyModel): Promise<threadApi.ThreadMessageDeleteManyResult> {
        return this.request("thread.threadMessageDeleteMany", model);
    }

    threadMessageDeleteOlderThan(model: threadApi.ThreadMessageDeleteOlderThanModel): Promise<threadApi.ThreadMessageDeleteOlderThanResult> {
        return this.request("thread.threadMessageDeleteOlderThan", model);
    }
    
}