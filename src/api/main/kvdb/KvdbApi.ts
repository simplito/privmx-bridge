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
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { BaseApi } from "../../BaseApi";
import { RequestLogger } from "../../../service/log/RequestLogger";
import { KvdbApiValidator } from "./KvdbApiValidator";
import { KvdbService } from "../../../service/cloud/KvdbService";
import { KvdbConverter } from "./KvdbConverter";

export class KvdbApi extends BaseApi implements kvdbApi.IKvdbApi {
    
    constructor(
        kvdbApiValidator: KvdbApiValidator,
        private sessionService: SessionService,
        private kvdbService: KvdbService,
        private kvdbConverter: KvdbConverter,
        private requestLogger: RequestLogger,
    ) {
        super(kvdbApiValidator);
    }
    
    @ApiMethod({})
    async kvdbCreate(model: kvdbApi.KvdbCreateModel): Promise<kvdbApi.KvdbCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const kvdb = await this.kvdbService.createKvdb(cloudUser, model.resourceId, model.contextId, model.type, model.users, model.managers, model.data, model.keyId, model.keys, model.policy || {});
        this.requestLogger.setContextId(kvdb.contextId);
        return {kvdbId: kvdb.id};
    }
    
    @ApiMethod({})
    async kvdbUpdate(model: kvdbApi.KvdbUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const kvdb = await this.kvdbService.updateKvdb(cloudUser, model.id, model.users, model.managers, model.data, model.keyId, model.keys, model.version, model.force, model.policy, model.resourceId);
        this.requestLogger.setContextId(kvdb.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async kvdbDelete(model: kvdbApi.KvdbDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const kvdb = await this.kvdbService.deleteKvdb(cloudUser, model.kvdbId);
        this.requestLogger.setContextId(kvdb.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async kvdbDeleteMany(model: kvdbApi.KvdbDeleteManyModel): Promise<kvdbApi.KvdbDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.kvdbService.deleteManyKvdbs(cloudUser, model.kvdbIds);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async kvdbGet(model: kvdbApi.KvdbGetModel): Promise<kvdbApi.KvdbGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const kvdb = await this.kvdbService.getKvdb(cloudUser, model.kvdbId, model.type);
        this.requestLogger.setContextId(kvdb.contextId);
        return {kvdb: this.kvdbConverter.convertKvdb(cloudUser.getUser(kvdb.contextId), kvdb)};
    }
    
    @ApiMethod({})
    async kvdbList(model: kvdbApi.KvdbListModel): Promise<kvdbApi.KvdbListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, kvdbs} = await this.kvdbService.getMyKvdbs(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate", model.scope || "MEMBER");
        this.requestLogger.setContextId(model.contextId);
        return {kvdbs: kvdbs.list.map(x => this.kvdbConverter.convertKvdb(user.userId, x)), count: kvdbs.count};
    }
    
    @ApiMethod({})
    async kvdbListAll(model: kvdbApi.KvdbListAllModel): Promise<kvdbApi.KvdbListAllResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, kvdbs} = await this.kvdbService.getAllKvdbs(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {kvdbs: kvdbs.list.map(x => this.kvdbConverter.convertKvdb(user.userId, x)), count: kvdbs.count};
    }
    
    @ApiMethod({})
    async kvdbEntrySet(model: kvdbApi.KvdbEntrySetModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {kvdb} = await this.kvdbService.setItem(cloudUser, model.kvdbId, model.kvdbEntryKey, model.kvdbEntryValue, model.keyId, model.version ? model.version : 0 as types.kvdb.KvdbEntryVersion, model.force);
        this.requestLogger.setContextId(kvdb.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async kvdbEntryGet(model: kvdbApi.KvdbEntryGetModel): Promise<kvdbApi.KvdbEntryGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {kvdb, item} = await this.kvdbService.getKvdbEntry(cloudUser, model.kvdbId, model.kvdbEntryKey);
        this.requestLogger.setContextId(kvdb.contextId);
        return {kvdbEntry: this.kvdbConverter.convertKvdbEntry(kvdb, item)};
    }
    
    @ApiMethod({})
    async kvdbEntryDelete(model: kvdbApi.KvdbEntryDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {kvdb} = await this.kvdbService.deleteItem(cloudUser, model.kvdbId, model.kvdbEntryKey);
        this.requestLogger.setContextId(kvdb.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async kvdbListKeys(model: kvdbApi.KvdbListKeysModel): Promise<kvdbApi.KvdbListKeysResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {kvdb, items} = await this.kvdbService.getKvdbEntriesKeys(cloudUser, model.kvdbId, model);
        this.requestLogger.setContextId(kvdb.contextId);
        return {
            kvdb: this.kvdbConverter.convertKvdb(cloudUser.getUser(kvdb.contextId), kvdb),
            kvdbEntryKeys: this.kvdbConverter.convertKvdbEntriesToKeys(items.list),
            count: items.count,
        };
    }
    
    @ApiMethod({})
    async kvdbListEntries(model: kvdbApi.KvdbListEntriesModel): Promise<kvdbApi.KvdbListItemsResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {kvdb, items} = await this.kvdbService.getKvdbEntries(cloudUser, model.kvdbId, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(kvdb.contextId);
        return {
            kvdb: this.kvdbConverter.convertKvdb(cloudUser.getUser(kvdb.contextId), kvdb),
            kvdbEntries: items.list.map(item => this.kvdbConverter.convertKvdbEntry(kvdb, item)),
            count: items.count,
        };
    }
    
    @ApiMethod({})
    async kvdbEntryDeleteMany(model: kvdbApi.KvdbEntryDeleteManyModel): Promise<kvdbApi.KvdbEntryDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.kvdbService.deleteManyItems(cloudUser, model.kvdbId, model.kvdbEntryKeys);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
}

