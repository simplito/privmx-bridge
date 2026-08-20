/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as storeApi from "./StoreApiTypes";
import * as db from "../../../db/Model";
import { ownGroupKeysOf } from "../GroupKeysNarrowing";
import { GroupEpochs, staleGroupsOf } from "../GroupEpochStaleness";

export class StoreConverter {
    
    /**
     * @param ownGroupIds the groups the caller belongs to, used to narrow `groupKeys`. Required rather than
     *                    optional so the compiler names every path that serves a store to a user; `undefined`
     *                    throws in `ownGroupKeysOf` instead of quietly stripping the caller's key material.
     * @param groupEpochs current epochs of this container's granted groups, from
     *                    `BaseContainerService.getGroupEpochs`; `staleGroups` is derived from it. Empty is the
     *                    honest answer for a container with no grants, and for one with grants it would claim
     *                    nothing needs re-keying — so every read path resolves it rather than defaulting it.
     */
    convertStore(user: types.cloud.UserId, store: db.store.Store, ownGroupIds: types.group.GroupId[]|undefined, groupEpochs: GroupEpochs) {
        const res: storeApi.Store = {
            id: store.id,
            contextId: store.contextId,
            createDate: store.createDate,
            creator: store.creator,
            lastModificationDate: store.lastModificationDate,
            lastModifier: store.lastModifier,
            users: store.users,
            managers: store.managers,
            keyId: store.keyId,
            data: store.history.map(x => ({keyId: x.keyId, data: x.data})),
            keys: (store.keys.find(x => x.user === user)?.keys) || [],
            groups: store.groups || [],
            groupKeys: ownGroupKeysOf(store.groupKeys || [], ownGroupIds),
            staleGroups: staleGroupsOf(store, groupEpochs),
            version: <types.store.StoreVersion>store.history.length,
            lastFileDate: store.lastFileDate,
            files: store.files,
            type: store.type,
            policy: store.policy || {},
        };
        if (store.clientResourceId) {
            res.resourceId = store.clientResourceId;
        }
        return res;
    }
    
    convertFile(store: db.store.Store, file: db.store.StoreFile) {
        const lastUpdate = file.updates ? file.updates[file.updates.length - 1] : {author: file.author, createDate: file.createDate};
        const res: storeApi.StoreFile = {
            id: file.id,
            version: ((file.updates || []).length + 1) as types.store.StoreFileVersion,
            storeId: file.storeId,
            contextId: store.contextId,
            createDate: file.createDate,
            author: file.author,
            meta: file.meta,
            size: file.size,
            keyId: file.keyId,
            thumb: file.thumb ? {
                size: file.thumb.size,
            } : undefined,
            updates: file.updates || [],
            
            // depracated fields
            created: file.createDate,
            creator: file.author,
            lastModifier: lastUpdate.author,
            lastModificationDate: lastUpdate.createDate,
        };
        if (file.clientResourceId) {
            res.resourceId = file.clientResourceId;
        }
        return res;
    }
}
