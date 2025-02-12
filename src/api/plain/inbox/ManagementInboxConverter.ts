/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as managementInboxApi from "./ManagementInboxApiTypes";
import * as db from "../../../db/Model";

export class ManagementInboxConverter {
    
    convertInbox(inbox: db.inbox.Inbox) {
        const res: managementInboxApi.Inbox = {
            id: inbox.id,
            contextId: inbox.contextId,
            createDate: inbox.createDate,
            creator: inbox.creator,
            lastModificationDate: inbox.lastModificationDate,
            lastModifier: inbox.lastModifier,
            users: inbox.users,
            managers: inbox.managers,
            keyId: inbox.keyId,
            version: <types.inbox.InboxVersion>inbox.history.length,
        };
        return res;
    }
}
