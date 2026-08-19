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
import { ownGroupKeysOf } from "../GroupKeysNarrowing";

export class InboxConverter {
    
    /**
     * @param ownGroupIds the groups the caller belongs to, used to narrow `groupKeys`. Required rather than
     *                    optional so the compiler names every path that serves an inbox to a user; `undefined`
     *                    throws in `ownGroupKeysOf` instead of quietly stripping the caller's key material.
     */
    convertInbox(user: types.cloud.UserId, inbox: db.inbox.Inbox, ownGroupIds: types.group.GroupId[]|undefined) {
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
            groups: inbox.groups || [],
            groupKeys: ownGroupKeysOf(inbox.groupKeys || [], ownGroupIds),
            version: <types.inbox.InboxVersion>inbox.history.length,
            type: inbox.type,
            policy: inbox.policy || {},
        };
        if (inbox.clientResourceId) {
            res.resourceId = inbox.clientResourceId;
        }
        return res;
    }
    
    convertInboxToPublicView(inbox: db.inbox.Inbox) {
        const last = inbox.history[inbox.history.length - 1];
        const res: inboxApi.InboxGetPublicViewResult = {
            inboxId: inbox.id,
            contextId: inbox.contextId,
            publicData: last.data.publicData,
            version: <types.inbox.InboxVersion>inbox.history.length,
        };
        return res;
    }
}
