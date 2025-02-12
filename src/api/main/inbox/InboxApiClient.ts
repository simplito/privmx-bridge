/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as inboxApi from "./InboxApiTypes";
import { BaseApiClient } from "../../BaseApiClient";

export class InboxApiClient extends BaseApiClient implements inboxApi.IInboxApi {
    
    inboxCreate(model: inboxApi.InboxCreateModel): Promise<inboxApi.InboxCreateResult> {
        return this.request("inbox.inboxCreate", model);
    }
    
    inboxUpdate(model: inboxApi.InboxUpdateModel): Promise<types.core.OK> {
        return this.request("inbox.inboxUpdate", model);
    }
    
    inboxDelete(model: inboxApi.InboxDeleteModel): Promise<types.core.OK> {
        return this.request("inbox.inboxDelete", model);
    }
    
    inboxDeleteMany(model: inboxApi.InboxDeleteManyModel): Promise<inboxApi.InboxDeleteManyResult> {
        return this.request("inbox.inboxDeleteMany", model);
    }
    
    inboxGet(model: inboxApi.InboxGetModel): Promise<inboxApi.InboxGetResult> {
        return this.request("inbox.inboxGet", model);
    }
    
    inboxGetPublicView(model: inboxApi.InboxGetModel): Promise<inboxApi.InboxGetPublicViewResult> {
        return this.request("inbox.inboxGetPublicView", model);
    }
    
    inboxList(model: inboxApi.InboxListModel): Promise<inboxApi.InboxListResult> {
        return this.request("inbox.inboxList", model);
    }
    
    inboxListAll(model: inboxApi.InboxListAllModel): Promise<inboxApi.InboxListAllResult> {
        return this.request("inbox.inboxListAll", model);
    }
    
    inboxSend(model: inboxApi.InboxSendModel): Promise<types.core.OK> {
        return this.request("inbox.inboxSend", model);
    }
    
    inboxSendCustomEvent(model: inboxApi.InboxSendCustomEventModel): Promise<types.core.OK> {
        return this.request("inbox.inboxSendCustomEvent", model);
    }
}
