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
import { BaseApiClient } from "../../BaseApiClient";

export class StoreApiClient extends BaseApiClient implements storeApi.IStoreApi {
    
    storeCreate(model: storeApi.StoreCreateModel): Promise<storeApi.StoreCreateResult> {
        return this.request("store.storeCreate", model);
    }
    
    storeUpdate(model: storeApi.StoreUpdateModel): Promise<types.core.OK> {
        return this.request("store.storeUpdate", model);
    }
    
    storeDelete(model: storeApi.StoreDeleteModel): Promise<types.core.OK> {
        return this.request("store.storeDelete", model);
    }
    
    storeGet(model: storeApi.StoreGetModel): Promise<storeApi.StoreGetResult> {
        return this.request("store.storeGet", model);
    }

    storeListAll(model: storeApi.StoreListAllModel): Promise<storeApi.StoreListAllResult> {
        return this.request("store.storeListAll", model);
    }
    
    storeList(model: storeApi.StoreListModel): Promise<storeApi.StoreListResult> {
        return this.request("store.storeList", model);
    }
    
    storeFileGet(model: storeApi.StoreFileGetModel): Promise<storeApi.StoreFileGetResult> {
        return this.request("store.storeFileGet", model);
    }
    
    storeFileGetMany(model: storeApi.StoreFileGetManyModel): Promise<storeApi.StoreFileGetManyResult> {
        return this.request("store.storeFileGetMany", model);
    }
    
    storeFileList(model: storeApi.StoreFileListModel): Promise<storeApi.StoreFileListResult> {
        return this.request("store.storeFileList", model);
    }

    storeFileListMy(model: storeApi.StoreFileListMyModel): Promise<storeApi.StoreFileListMyResult> {
        return this.request("store.storeFileListMy", model);
    }
    
    storeFileCreate(model: storeApi.StoreFileCreateModel): Promise<storeApi.StoreFileCreateResult> {
        return this.request("store.storeFileCreate", model);
    }
    
    storeFileRead(model: storeApi.StoreFileReadModel): Promise<storeApi.StoreFileReadResult> {
        return this.request("store.storeFileRead", model);
    }
    
    storeFileWrite(model: storeApi.StoreFileWriteModel): Promise<types.core.OK> {
        return this.request("store.storeFileWrite", model);
    }
    
    storeFileUpdate(model: storeApi.StoreFileUpdateModel): Promise<types.core.OK> {
        return this.request("store.storeFileUpdate", model);
    }
    
    storeFileDelete(model: storeApi.StoreFileDeleteModel): Promise<types.core.OK> {
        return this.request("store.storeFileDelete", model);
    }

    storeDeleteMany(model: storeApi.StoreDeleteManyModel): Promise<storeApi.StoreDeleteManyResult> {
        return this.request("store.storeDeleteMany", model);
    }

    storeFileDeleteMany(model: storeApi.StoreFileDeleteManyModel): Promise<storeApi.StoreFileDeleteManyResult> {
        return this.request("store.storeFileDeleteMany", model);
    }

    storeFileDeleteOlderThan(model: storeApi.StoreFileDeleteOlderThanModel): Promise<storeApi.StoreFileDeleteOlderThanResult> {
        return this.request("store.storeFileDeleteOlderThan", model);
    }
}
