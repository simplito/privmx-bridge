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
import * as db from "../../../db/Model";

export class InboxConverter {
    
    convertInbox(user: types.cloud.UserId, inbox: db.inbox.Inbox) {
        const res: inboxApi.Inbox = {
            id: inbox.id,
            contextId: inbox.contextId,
            createDate: inbox.createDate,
            creator: inbox.creator,
            lastModificationDate: inbox.lastModificationDate,
            lastModifier: inbox.lastModifier,
            users: inbox.users,
            managers: inbox.managers,
            keyId: inbox.keyId,
            data: inbox.history.map(x => ({keyId: x.keyId, data: x.data})),
            keys: (inbox.keys.find(x => x.user === user)?.keys) || [],
            version: <types.inbox.InboxVersion>inbox.history.length,
            type: inbox.type,
            policy: inbox.policy || {},
        };
        return res;
    }
    
    convertInboxToPublicView(inbox: db.inbox.Inbox) {
        const last = inbox.history[inbox.history.length - 1];
        const res: inboxApi.InboxGetPublicViewResult = {
            inboxId: inbox.id,
            publicData: last.data.publicData,
            version: <types.inbox.InboxVersion>inbox.history.length,
        };
        return res;
    }
}
