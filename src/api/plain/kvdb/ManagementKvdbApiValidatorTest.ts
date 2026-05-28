/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementKvdbApi } from "./ManagementKvdbApi";
import { ManagementKvdbApiValidator } from "./ManagementKvdbApiValidator";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

export const test = testApi("client", "kvdb/", ManagementKvdbApi, new ManagementKvdbApiValidator(new TypesValidator()), call => {
    call("getKvdb", api => api.getKvdb({
        kvdbId: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
    })).setResult({
        kvdb: {
            id: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1715959261142 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModificationDate: 1715959261142 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            users: ["john" as types.cloud.UserId],
            managers: ["john" as types.cloud.UserId],
            version: 1 as types.kvdb.KvdbVersion,
            lastEntryDate: 1715959261142 as types.core.Timestamp,
            entries: 1,
            publicMeta: null,
        },
    });
    call("listKvdbs", api => api.listKvdbs({
        contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [
            {
                id: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
                contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
                createDate: 1715959261142 as types.core.Timestamp,
                creator: "john" as types.cloud.UserId,
                lastModificationDate: 1715959261142 as types.core.Timestamp,
                lastModifier: "john" as types.cloud.UserId,
                keyId: "my-key" as types.core.KeyId,
                users: ["john" as types.cloud.UserId],
                managers: ["john" as types.cloud.UserId],
                version: 1 as types.kvdb.KvdbVersion,
                lastEntryDate: 1715959261142 as types.core.Timestamp,
                entries: 1,
                publicMeta: null,
            },
        ],
    });
    call("deleteKvdb", api => api.deleteKvdb({
        kvdbId: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
    })).setResult("OK");
    call("getKvdbEntry", api => api.getKvdbEntry({
        kvdbId: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
        kvdbEntryKey: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbEntryKey,
    })).setResult({
        kvdbEntry: {
            kvdbEntryKey: "664775dd05c7c6f92f654a11" as types.kvdb.KvdbEntryKey,
            kvdbId: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1715959261318 as types.core.Timestamp,
            author: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            version: 1 as types.kvdb.KvdbEntryVersion,
            lastModificationDate: 1715959261318 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            publicMeta: null,
        },
    });
    call("listKvdbEntries", api => api.listKvdbKeys({
        kvdbId: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        kvdb: {
            id: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1715959261142 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModificationDate: 1715959261142 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            users: ["john" as types.cloud.UserId],
            managers: ["john" as types.cloud.UserId],
            version: 1 as types.kvdb.KvdbVersion,
            lastEntryDate: 1715959261142 as types.core.Timestamp,
            entries: 1,
            publicMeta: null,
        },
        list: ["664775dd05c7c6f92f654a11"] as types.kvdb.KvdbEntryKey[],
    });
    call("deleteKvdbEntry", api => api.deleteKvdbEntry({
        kvdbId: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbId,
        kvdbEntryKey: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbEntryKey,
    })).setResult("OK");
    call("deleteManyKvdbs", api => api.deleteManyKvdbs({
        kvdbIds: ["65ad8f6c2e4f4f1adb40bf81"] as types.kvdb.KvdbId[],
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbId,
                status: "OK",
            },
        ],
    });
    call("deleteManyKvdbEntries", api => api.deleteManyKvdbEntries({
        kvdbId: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbId,
        kvdbEntryKeys: ["65ad8f6c2e4f4f1adb40bf81"] as types.kvdb.KvdbEntryKey[],
    })).setResult({
        results: [
            {
                kvdbEntryKey: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbEntryKey,
                status: "OK",
            },
        ],
    });
    call("listKvdbEntryWithPrefix", api => api.listKvdbEntries({
        kvdbId: "65ad8f6c2e4f4f1adb40bf81" as types.kvdb.KvdbId,
        from: null,
        limit: 10,
        sortOrder: "asc",
        prefix: "6647",
    })).setResult({
        count: 1,
        kvdb: {
            id: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1715959261142 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModificationDate: 1715959261142 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            users: ["john" as types.cloud.UserId],
            managers: ["john" as types.cloud.UserId],
            version: 1 as types.kvdb.KvdbVersion,
            lastEntryDate: 1715959261142 as types.core.Timestamp,
            entries: 1,
            publicMeta: null,
        },
        list: [{
            kvdbEntryKey: "664775dd05c7c6f92f654a11" as types.kvdb.KvdbEntryKey,
            kvdbId: "664775ddb5d9a3f95b619ef0" as types.kvdb.KvdbId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1715959261318 as types.core.Timestamp,
            author: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            version: 1 as types.kvdb.KvdbEntryVersion,
            lastModificationDate: 1715959261318 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            publicMeta: null,
        }],
    });
});
