/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as contextApi from "./ContextApiTypes";
import * as db from "../../../db/Model";

export class GroupConverter {
    
    convertGroup(user: types.cloud.UserId, group: db.group.Group): contextApi.GroupInfo {
        const res: contextApi.GroupInfo = {
            id: group.id,
            groupPubKey: group.groupPubKey,
            contextId: group.contextId,
            type: group.type,
            createDate: group.createDate,
            creator: group.creator,
            lastModificationDate: group.lastModificationDate,
            lastModifier: group.lastModifier,
            data: group.history.map(x => ({keyId: x.keyId, data: x.data})),
            users: group.users,
            managers: group.managers,
            keys: (group.keys.find(x => x.user === user)?.keys) || [],
            version: group.history.length as types.group.GroupVersion,
            keyVersion: group.keyVersion ?? 0,
            keyHistory: group.keyHistory ?? [],
            policy: group.policy || {},
            history: group.history.map(x => this.convertHistoryEntry(x)),
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        return res;
    }
    
    private convertHistoryEntry(entry: db.group.GroupHistoryEntry): contextApi.GroupHistoryEntryInfo {
        const res: contextApi.GroupHistoryEntryInfo = {
            keyId: entry.keyId,
            groupPubKey: entry.groupPubKey,
            users: entry.users,
            managers: entry.managers,
            created: entry.created,
            author: entry.author,
        };
        if (entry.confirmationTag !== undefined) {
            res.confirmationTag = entry.confirmationTag;
        }
        return res;
    }
}
