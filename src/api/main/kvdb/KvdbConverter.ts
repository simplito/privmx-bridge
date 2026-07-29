/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as kvdbApi from "./KvdbApiTypes";
import * as db from "../../../db/Model";

export class KvdbConverter {
    
    convertKvdb(user: types.cloud.UserId, kvdb: db.kvdb.Kvdb) {
        const res: kvdbApi.KvdbInfo = {
            id: kvdb.id,
            resourceId: kvdb.clientResourceId,
            contextId: kvdb.contextId,
            createDate: kvdb.createDate,
            creator: kvdb.creator,
            lastModificationDate: kvdb.lastModificationDate,
            lastModifier: kvdb.lastModifier,
            users: kvdb.users,
            managers: kvdb.managers,
            keyId: kvdb.keyId,
            data: kvdb.history.map(x => ({keyId: x.keyId, data: x.data})),
            keys: (kvdb.keys.find(x => x.user === user)?.keys) || [],
            version: <types.kvdb.KvdbVersion>kvdb.history.length,
            type: kvdb.type,
            policy: kvdb.policy || {},
            lastEntryDate: kvdb.lastEntryDate,
            entries: kvdb.entries,
        };
        return res;
    }
    
    convertKvdbEntry(kvdb: db.kvdb.Kvdb, kvdbEntry: db.kvdb.KvdbEntry) {
        const res: kvdbApi.KvdbEntryInfo = {
            kvdbEntryKey: kvdbEntry.entryKey,
            kvdbEntryValue: kvdbEntry.entryValue,
            kvdbId: kvdb.id,
            version: kvdbEntry.version,
            contextId: kvdb.contextId,
            createDate: kvdbEntry.createDate,
            author: kvdbEntry.author,
            keyId: kvdbEntry.keyId,
            lastModificationDate: kvdbEntry.lastModificationDate,
            lastModifier: kvdbEntry.lastModifier,
        };
        return res;
    }
    
    convertKvdbEntriesToKeys(kvdbEntry: db.kvdb.KvdbEntry[]) {
        return kvdbEntry.map(item => item.entryKey);
    }
}
