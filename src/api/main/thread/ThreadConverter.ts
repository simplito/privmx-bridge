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
import * as db from "../../../db/Model";
import { ownGroupKeysOf } from "../GroupKeysNarrowing";
import { GroupEpochs, staleGroupsOf } from "../GroupEpochStaleness";

export class ThreadConverter {
    
    /**
     * @param ownGroupIds the groups the caller belongs to, used to narrow `groupKeys`. Required rather than
     *                    optional so the compiler names every path that serves a thread to a user; `undefined`
     *                    throws in `ownGroupKeysOf` instead of quietly stripping the caller's key material.
     * @param groupEpochs current epochs of this container's granted groups, from
     *                    `BaseContainerService.getGroupEpochs`; `staleGroups` is derived from it. Empty is the
     *                    honest answer for a container with no grants, and for one with grants it would claim
     *                    nothing needs re-keying — so every read path resolves it rather than defaulting it.
     */
    convertThread(user: types.cloud.UserId, thread: db.thread.Thread, ownGroupIds: types.group.GroupId[]|undefined, groupEpochs: GroupEpochs) {
        const res: threadApi.ThreadInfo = {
            id: thread.id,
            contextId: thread.contextId,
            createDate: thread.createDate,
            creator: thread.creator,
            lastModificationDate: thread.lastModificationDate,
            lastModifier: thread.lastModifier,
            users: thread.users,
            managers: thread.managers,
            keyId: thread.keyId,
            keeper: thread.keeper,
            data: thread.history.map(x => ({keyId: x.keyId, data: x.data})),
            keys: (thread.keys.find(x => x.user === user)?.keys) || [],
            groups: thread.groups || [],
            groupKeys: ownGroupKeysOf(thread.groupKeys || [], ownGroupIds),
            staleGroups: staleGroupsOf(thread, groupEpochs),
            version: <types.thread.ThreadVersion>thread.history.length,
            lastMsgDate: thread.lastMsgDate,
            messages: thread.messages,
            type: thread.type,
            policy: thread.policy || {},
        };
        if (thread.clientResourceId) {
            res.resourceId = thread.clientResourceId;
        }
        return res;
    }
    
    convertMessage(thread: db.thread.Thread, message: db.thread.ThreadMessage) {
        const res: threadApi.ThreadMessage = {
            id: message.id,
            version: ((message.updates || []).length + 1) as types.thread.ThreadMessageVersion,
            contextId: thread.contextId,
            threadId: message.threadId,
            createDate: message.createDate,
            author: message.author,
            data: message.data,
            keyId: message.keyId,
            updates: message.updates || [],
        };
        if (message.clientResourceId) {
            res.resourceId = message.clientResourceId;
        }
        return res;
    }
}
