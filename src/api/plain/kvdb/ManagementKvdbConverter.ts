/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as managementKvdbApi from "./ManagementKvdbApiTypes";
import * as db from "../../../db/Model";

export class ManagementKvdbConverter {
    
    convertKvdb(x: db.kvdb.Kvdb) {
        const res: managementKvdbApi.Kvdb = {
            id: x.id,
            contextId: x.contextId,
            createDate: x.createDate,
            creator: x.creator,
            lastModificationDate: x.lastModificationDate,
            lastModifier: x.lastModifier,
            keyId: x.keyId,
            users: x.users,
            managers: x.managers,
            version: x.history.length as types.kvdb.KvdbVersion,
            lastEntryDate: x.lastEntryDate,
            entries: x.entries,
        };
        return res;
    }
    
    convertKvdbEntry(kvdb: db.kvdb.Kvdb, x: db.kvdb.KvdbEntry) {
        const res: managementKvdbApi.KvdbEntry = {
            kvdbEntryKey: x.entryKey,
            version: x.version,
            contextId: kvdb.contextId,
            kvdbId: x.kvdbId,
            createDate: x.createDate,
            author: x.author,
            keyId: x.keyId,
            lastModificationDate: x.lastModificationDate,
            lastModifier: x.lastModifier,
        };
        return res;
    }
    
    convertKvdbEntriesToKeys(kvdbEntry: db.kvdb.KvdbEntry[]) {
        return kvdbEntry.map(item => item.entryKey);
    }
}
