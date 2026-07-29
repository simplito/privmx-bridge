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
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { BaseApi } from "../../BaseApi";
import { StoreApiValidator } from "./StoreApiValidator";
import { StoreService } from "../../../service/cloud/StoreService";
import { StoreConverter } from "./StoreConverter";
import { RequestLogger } from "../../../service/log/RequestLogger";

export class StoreApi extends BaseApi implements storeApi.IStoreApi {
    
    constructor(
        storeApiValidator: StoreApiValidator,
        private sessionService: SessionService,
        private storeService: StoreService,
        private storeConverter: StoreConverter,
        private requestLogger: RequestLogger,
    ) {
        super(storeApiValidator);
    }
    
    @ApiMethod({})
    async storeCreate(model: storeApi.StoreCreateModel): Promise<storeApi.StoreCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const store = await this.storeService.createStore(cloudUser, model.resourceId || null, model.contextId, model.type, model.users, model.managers, model.data, model.keyId, model.keys, model.policy || {});
        this.requestLogger.setContextId(store.contextId);
        return {storeId: store.id};
    }
    
    @ApiMethod({})
    async storeUpdate(model: storeApi.StoreUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const store = await this.storeService.updateStore(cloudUser, model.id, model.users, model.managers, model.data, model.keyId, model.keys, model.version, model.force, model.policy, model.resourceId || null);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async storeDelete(model: storeApi.StoreDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const store = await this.storeService.deleteStore(cloudUser, model.storeId);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async storeDeleteMany(model: storeApi.StoreDeleteManyModel): Promise<storeApi.StoreDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.storeService.deleteManyStores(cloudUser, model.storeIds);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async storeGet(model: storeApi.StoreGetModel): Promise<storeApi.StoreGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const store = await this.storeService.getStore(cloudUser, model.storeId, model.type);
        this.requestLogger.setContextId(store.contextId);
        return {store: this.storeConverter.convertStore(cloudUser.getUser(store.contextId), store)};
    }
    
    @ApiMethod({})
    async storeList(model: storeApi.StoreListModel): Promise<storeApi.StoreListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, stores} = await this.storeService.getMyStores(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate", model.scope || "MEMBER");
        this.requestLogger.setContextId(model.contextId);
        return {stores: stores.list.map(x => this.storeConverter.convertStore(user.userId, x)), count: stores.count};
    }
    
    @ApiMethod({})
    async storeListAll(model: storeApi.StoreListAllModel): Promise<storeApi.StoreListAllResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, stores} = await this.storeService.getAllStores(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {stores: stores.list.map(x => this.storeConverter.convertStore(user.userId, x)), count: stores.count};
    }
    
    @ApiMethod({})
    async storeFileGet(model: storeApi.StoreFileGetModel): Promise<storeApi.StoreFileGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store, file} = await this.storeService.getStoreFile(cloudUser, model.fileId);
        this.requestLogger.setContextId(store.contextId);
        return {store: this.storeConverter.convertStore(cloudUser.getUser(store.contextId), store), file: this.storeConverter.convertFile(store, file)};
    }
    
    @ApiMethod({})
    async storeFileGetMany(model: storeApi.StoreFileGetManyModel): Promise<storeApi.StoreFileGetManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store, files} = await this.storeService.getStoreFileMany(cloudUser, model.storeId, model.fileIds, model.failOnError);
        this.requestLogger.setContextId(store.contextId);
        return {store: this.storeConverter.convertStore(cloudUser.getUser(store.contextId), store), files: files.map(x => "error" in x ? x : this.storeConverter.convertFile(store, x))};
    }
    
    @ApiMethod({})
    async storeFileList(model: storeApi.StoreFileListModel): Promise<storeApi.StoreFileListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store, files} = await this.storeService.getStoreFiles(cloudUser, model.storeId, model, model.sortBy);
        this.requestLogger.setContextId(store.contextId);
        return {
            store: this.storeConverter.convertStore(cloudUser.getUser(store.contextId), store),
            files: files.list.map(x => this.storeConverter.convertFile(store, x)),
            count: files.count,
        };
    }
    
    @ApiMethod({})
    async storeFileListMy(model: storeApi.StoreFileListMyModel): Promise<storeApi.StoreFileListMyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store, files} = await this.storeService.getMyStoreFiles(cloudUser, model.storeId, model);
        this.requestLogger.setContextId(store.contextId);
        return {
            store: this.storeConverter.convertStore(cloudUser.getUser(store.contextId), store),
            files: files.list.map(x => this.storeConverter.convertFile(store, x)),
            count: files.count,
        };
    }
    
    @ApiMethod({})
    async storeFileCreate(model: storeApi.StoreFileCreateModel): Promise<storeApi.StoreFileCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store, file} = await this.storeService.createStoreFile(cloudUser, model);
        this.requestLogger.setContextId(store.contextId);
        return {fileId: file.id};
    }
    
    @ApiMethod({})
    async storeFileRead(model: storeApi.StoreFileReadModel): Promise<storeApi.StoreFileReadResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store, data} = await this.storeService.readStoreFile(cloudUser, model.fileId, model.thumb, model.version, model.range);
        this.requestLogger.setContextId(store.contextId);
        return {data: data};
    }
    
    @ApiMethod({})
    async storeFileWrite(model: storeApi.StoreFileWriteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store} = "requestId" in model ?
            await this.storeService.writeStoreFile(cloudUser, model) :
            await this.storeService.randomWrite(cloudUser, model);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async storeFileUpdate(model: storeApi.StoreFileUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store} = await this.storeService.updateStoreFile(cloudUser, model);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async storeFileDelete(model: storeApi.StoreFileDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {store} = await this.storeService.deleteStoreFile(cloudUser, model.fileId);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async storeFileDeleteMany(model: storeApi.StoreFileDeleteManyModel): Promise<storeApi.StoreFileDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.storeService.deleteManyStoreFiles(cloudUser, model.storeIds);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async storeFileDeleteOlderThan(model: storeApi.StoreFileDeleteOlderThanModel): Promise<storeApi.StoreFileDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.storeService.deleteFilesOlderThan(cloudUser, model.storeId, model.timestamp);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async storeSendCustomEvent(model: storeApi.StoreSendCustomEventModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const store = await this.storeService.sendCustomNotification(cloudUser, model.storeId, model.keyId, model.data, model.channel, model.users);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
}
