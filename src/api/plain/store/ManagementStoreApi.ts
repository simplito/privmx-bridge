/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementBaseApi } from "../../../api/ManagementBaseApi";
import * as managementStoreApi from "./ManagementStoreApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { ManagementStoreApiValidator } from "./ManagementStoreApiValidator";
import { StoreService } from "../../../service/cloud/StoreService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import * as types from "../../../types";
import { ManagementStoreConverter } from "./ManagementStoreConverter";

export class ManagementStoreApi extends ManagementBaseApi implements managementStoreApi.IStoreApi {
    
    constructor(
        managementStoreApiValidator: ManagementStoreApiValidator,
        authorizationDetector: AuthorizationDetector,
        authorizationHolder: AuthorizationHolder,
        private storeService: StoreService,
        private managementStoreConverter: ManagementStoreConverter,
    ) {
        super(managementStoreApiValidator, authorizationDetector, authorizationHolder);
    }
    
    @ApiMethod({errorCodes: ["STORE_DOES_NOT_EXIST"] })
    async getStore(model: managementStoreApi.GetStoreModel): Promise<managementStoreApi.GetStoreResult> {
        this.validateScope("store");
        const store = await this.storeService.getStore(this.getPlainUser(), model.storeId, undefined);
        return {store: this.managementStoreConverter.convertStore(store)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listStores(model: managementStoreApi.ListStoresModel): Promise<managementStoreApi.ListStoresResult> {
        this.validateScope("store");
        const {stores} = await this.storeService.getStoresByContext(this.getPlainUser(), model.contextId, model);
        return {count: stores.count, list: stores.list.map(x => this.managementStoreConverter.convertStore(x))};
    }
    
    @ApiMethod({errorCodes: ["STORE_DOES_NOT_EXIST"] })
    async deleteStore(model: managementStoreApi.DeleteStoreModel): Promise<types.core.OK> {
        this.validateScope("store");
        await this.storeService.deleteStore(this.getPlainUser(), model.storeId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["RESOURCES_HAVE_DIFFERENT_CONTEXTS"] })
    async deleteManyStores(model: managementStoreApi.DeleteManyStoresModel): Promise<managementStoreApi.DeleteManyStoresResult> {
        this.validateScope("store");
        const {results} = await this.storeService.deleteManyStores(this.getPlainUser(), model.storeIds);
        return {results};
    }
    
    @ApiMethod({errorCodes: ["STORE_FILE_DOES_NOT_EXIST"] })
    async getStoreFile(model: managementStoreApi.GetStoreFileModel): Promise<managementStoreApi.GetStoreFileResult> {
        this.validateScope("store");
        const {store, file} = await this.storeService.getStoreFile(this.getPlainUser(), model.storeFileId);
        return {storeFile: this.managementStoreConverter.convertStoreFile(store, file)};
    }
    
    @ApiMethod({errorCodes: ["STORE_DOES_NOT_EXIST"] })
    async listStoreFiles(model: managementStoreApi.ListStoreFilesModel): Promise<managementStoreApi.ListStoreFilesResult> {
        this.validateScope("store");
        const {store, files} = await this.storeService.getStoreFiles2(this.getPlainUser(), model.storeId, model);
        return {count: files.count, list: files.list.map(x => this.managementStoreConverter.convertStoreFile(store, x))};
    }
    
    @ApiMethod({errorCodes: ["STORE_FILE_DOES_NOT_EXIST"] })
    async deleteStoreFile(model: managementStoreApi.DeleteStoreFileModel): Promise<types.core.OK> {
        this.validateScope("store");
        await this.storeService.deleteStoreFile(this.getPlainUser(), model.storeFileId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["FILES_BELONGS_TO_DIFFERENT_STORES"] })
    async deleteManyStoreFiles(model: managementStoreApi.DeleteManyStoreFilesModel): Promise<managementStoreApi.DeleteManyStoreFilesResult> {
        this.validateScope("store");
        const {results} = await this.storeService.deleteManyStoreFiles(this.getPlainUser(), model.fileIds);
        return {results};
    }
    
    @ApiMethod({errorCodes: ["STORE_DOES_NOT_EXIST"] })
    async deleteStoreFilesOlderThan(model: managementStoreApi.DeleteStoreFilesOlderThanModel): Promise<managementStoreApi.DeleteStoreFilesOlderThanResult> {
        this.validateScope("store");
        const {results} = await this.storeService.deleteFilesOlderThan(this.getPlainUser(), model.storeId, model.timestamp);
        return {results};
    }
}
