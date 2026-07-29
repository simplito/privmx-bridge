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
import { BaseApiClient } from "../../BaseApiClient";

export class KvdbApiClient extends BaseApiClient implements kvdbApi.IKvdbApi {
    
    kvdbCreate(model: kvdbApi.KvdbCreateModel): Promise<kvdbApi.KvdbCreateResult> {
        return this.request("kvdb.kvdbCreate", model);
    }
    
    kvdbUpdate(model: kvdbApi.KvdbUpdateModel): Promise<types.core.OK> {
        return this.request("kvdb.kvdbUpdate", model);
    }
    
    kvdbDelete(model: kvdbApi.KvdbDeleteModel): Promise<types.core.OK> {
        return this.request("kvdb.kvdbDelete", model);
    }
    
    kvdbDeleteMany(model: kvdbApi.KvdbDeleteManyModel): Promise<kvdbApi.KvdbDeleteManyResult> {
        return this.request("kvdb.kvdbDeleteMany", model);
    }
    
    kvdbGet(model: kvdbApi.KvdbGetModel): Promise<kvdbApi.KvdbGetResult> {
        return this.request("kvdb.kvdbGet", model);
    }
    
    kvdbList(model: kvdbApi.KvdbListModel): Promise<kvdbApi.KvdbListResult> {
        return this.request("kvdb.kvdbList", model);
    }
    
    kvdbListAll(model: kvdbApi.KvdbListAllModel): Promise<kvdbApi.KvdbListAllResult> {
        return this.request("kvdb.kvdbListAll", model);
    }
    
    kvdbEntryGet(model: kvdbApi.KvdbEntryGetModel): Promise<kvdbApi.KvdbEntryGetResult> {
        return this.request("kvdb.kvdbEntryGet", model);
    }
    
    kvdbEntrySet(model: kvdbApi.KvdbEntrySetModel): Promise<types.core.OK> {
        return this.request("kvdb.kvdbEntrySet", model);
    }
    
    kvdbEntryDelete(model: kvdbApi.KvdbEntryDeleteModel): Promise<types.core.OK> {
        return this.request("kvdb.kvdbEntryDelete", model);
    }
    
    kvdbListKeys(model: kvdbApi.KvdbListKeysModel): Promise<kvdbApi.KvdbListKeysResult> {
        return this.request("kvdb.kvdbListKeys", model);
    }
    
    kvdbListEntries(model: kvdbApi.KvdbListEntriesModel): Promise<kvdbApi.KvdbListItemsResult> {
        return this.request("kvdb.kvdbListEntries", model);
    }
    
    kvdbEntryDeleteMany(model: kvdbApi.KvdbEntryDeleteManyModel): Promise<kvdbApi.KvdbEntryDeleteManyResult> {
        return this.request("kvdb.kvdbEntryDeleteMany", model);
    }
}
