/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementStoreApi} from "./ManagementStoreApi";
import { ManagementStoreApiValidator } from "./ManagementStoreApiValidator";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

export const test = testApi("client", "store/", ManagementStoreApi, new ManagementStoreApiValidator(new TypesValidator()), call => {
    call("getStore", api => api.getStore({
        storeId: "65e71856bcf6598993a0f19e" as types.store.StoreId,
    })).setResult({
        store: {
            id: "65e71856bcf6598993a0f19e" as types.store.StoreId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1709643862879 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModificationDate: 1709643862879 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            keyId: "f03c6e25c54bac1b7e22e5508d38b9d5" as types.core.KeyId,
            users: ["john" as types.cloud.UserId],
            managers: ["john" as types.cloud.UserId],
            version: 1 as types.store.StoreVersion,
            lastFileDate: 1709648110994 as types.core.Timestamp,
            files: 1,
        },
    });
    call("listStores", api => api.listStores({
        contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 0,
        list: [
            {
                id: "65e71856bcf6598993a0f19e" as types.store.StoreId,
                contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
                createDate: 1709643862879 as types.core.Timestamp,
                creator: "john" as types.cloud.UserId,
                lastModificationDate: 1709643862879 as types.core.Timestamp,
                lastModifier: "john" as types.cloud.UserId,
                keyId: "f03c6e25c54bac1b7e22e5508d38b9d5" as types.core.KeyId,
                users: ["john" as types.cloud.UserId],
                managers: ["john" as types.cloud.UserId],
                version: 1 as types.store.StoreVersion,
                lastFileDate: 1709648110994 as types.core.Timestamp,
                files: 1,
            },
        ],
    });
    call("deleteStore", api => api.deleteStore({
        storeId: "65e71856bcf6598993a0f19e" as types.store.StoreId,
    })).setResult("OK");
    call("getStoreFile", api => api.getStoreFile({
        storeFileId: "65e728ee6600e98985cdb814" as types.store.StoreFileId,
    })).setResult({
        storeFile: {
            id: "65e728ee6600e98985cdb814" as types.store.StoreFileId,
            version: 1,
            storeId: "65e71856bcf6598993a0f19e" as types.store.StoreId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            created: 1709648110994 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModifier: "john" as types.cloud.UserId,
            lastModificationDate: 1709648110994 as types.core.Timestamp,
            size: 64 as types.core.SizeInBytes,
            keyId: "f03c6e25c54bac1b7e22e5508d38b9d5" as types.core.KeyId,
        },
    });
    call("listStoreFiles", api => api.listStoreFiles({
        storeId: "65e71856bcf6598993a0f19e" as types.store.StoreId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [
            {
                id: "65e728ee6600e98985cdb814" as types.store.StoreFileId,
                version: 1,
                storeId: "65e71856bcf6598993a0f19e" as types.store.StoreId,
                contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
                created: 1709648110994 as types.core.Timestamp,
                creator: "john" as types.cloud.UserId,
                lastModifier: "john" as types.cloud.UserId,
                lastModificationDate: 1709648110994 as types.core.Timestamp,
                size: 64 as types.core.SizeInBytes,
                keyId: "f03c6e25c54bac1b7e22e5508d38b9d5" as types.core.KeyId,
            },
        ],
    });
    call("deleteStoreFile", api => api.deleteStoreFile({
        storeFileId: "65ad8f6c2e4f4f1adb40bf81" as types.store.StoreFileId,
    })).setResult("OK");
    call("deleteManyStores", api => api.deleteManyStores({
        storeIds: ["65ad8f6c2e4f4f1adb40bf81"] as types.store.StoreId[],
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.store.StoreId,
                status: "OK",
            },
        ],
    });
    call("deleteManyStoreFiles", api => api.deleteManyStoreFiles({
        fileIds: ["65ad8f6c2e4f4f1adb40bf81"] as types.store.StoreFileId[],
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.store.StoreFileId,
                status: "OK",
            },
        ],
    });
    call("deleteStoreFilesOlderThan", api => api.deleteStoreFilesOlderThan({
        storeId: "66477724276e411b86fe6d73" as types.store.StoreId,
        timestamp: 1715959588042 as types.core.Timestamp,
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.store.StoreFileId,
                status: "OK",
            },
        ],
    });
});
