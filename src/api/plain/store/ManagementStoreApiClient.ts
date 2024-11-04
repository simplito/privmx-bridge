/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Requester } from "../../../CommonTypes";
import * as types from "../../../types";
import * as storeApi from "./ManagementStoreApiTypes";

export class ManagementStoreApiClient implements storeApi.IStoreApi {
    
    constructor(
        private requester: Requester,
    ) {}

    async getStore(model: storeApi.GetStoreModel): Promise<storeApi.GetStoreResult> {
        return await this.requester.request("store/getStore", model);
    }

    async listStores(model: storeApi.ListStoresModel): Promise<storeApi.ListStoresResult> {
        return await this.requester.request("store/listStores", model);
    }

    async deleteStore(model: storeApi.DeleteStoreModel): Promise<types.core.OK> {
        return await this.requester.request("store/deleteStore", model);
    }

    async deleteManyStores(model: storeApi.DeleteManyStoresModel): Promise<storeApi.DeleteManyStoresResult> {
        return await this.requester.request("store/deleteManyStores", model);
    }

    async getStoreFile(model: storeApi.GetStoreFileModel): Promise<storeApi.GetStoreFileResult> {
        return await this.requester.request("store/getStoreFile", model);
    }

    async listStoreFiles(model: storeApi.ListStoreFilesModel): Promise<storeApi.ListStoreFilesResult> {
        return await this.requester.request("store/listStoreFiles", model);
    }

    async deleteStoreFile(model: storeApi.DeleteStoreFileModel): Promise<types.core.OK> {
        return await this.requester.request("store/deleteStoreFile", model);
    }

    async deleteManyStoreFiles(model: storeApi.DeleteManyStoreFilesModel): Promise<storeApi.DeleteManyStoreFilesResult> {
        return await this.requester.request("store/deleteManyStoreFiles", model);
    }

    async deleteStoreFilesOlderThan(model: storeApi.DeleteStoreFilesOlderThanModel): Promise<storeApi.DeleteStoreFilesOlderThanResult> {
        return await this.requester.request("store/deleteStoreFilesOlderThan", model);
    }
}