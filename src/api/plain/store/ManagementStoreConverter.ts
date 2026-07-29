/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as managementStoreApi from "./ManagementStoreApiTypes";
import * as db from "../../../db/Model";
import { Utils } from "../../../utils/Utils";

export class ManagementStoreConverter {
    
    convertStore(x: db.store.Store) {
        const res: managementStoreApi.Store = {
            id: x.id,
            contextId: x.contextId,
            createDate: x.createDate,
            creator: x.creator,
            lastModificationDate: x.lastModificationDate,
            lastModifier: x.lastModifier,
            keyId: x.keyId,
            users: x.users,
            managers: x.managers,
            version: x.history.length as types.store.StoreVersion,
            lastFileDate: x.lastFileDate,
            files: x.files,
            publicMeta: Utils.findFieldInUnknownObject(x.data, "publicMetaObject"),
        };
        return res;
    }
    
    convertStoreFile(store: db.store.Store, file: db.store.StoreFile) {
        const lastUpdate = file.updates ? file.updates[file.updates.length - 1] : {author: file.author, createDate: file.createDate};
        const res: managementStoreApi.StoreFile = {
            id: file.id,
            version: (file.updates || []).length + 1,
            storeId: file.storeId,
            contextId: store.contextId,
            created: file.createDate,
            creator: file.author,
            lastModifier: lastUpdate.author,
            lastModificationDate: lastUpdate.createDate,
            size: file.size,
            keyId: file.keyId,
            thumb: file.thumb ? {
                size: file.thumb.size,
            } : undefined,
            publicMeta: Utils.findFieldInUnknownObject(file.meta, "publicMetaObject"),
        };
        return res;
    }
}
