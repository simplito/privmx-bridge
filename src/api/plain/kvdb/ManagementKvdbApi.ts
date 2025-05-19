/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementBaseApi } from "../../../api/ManagementBaseApi";
import * as managementKvdbApi from "./ManagementKvdbApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { ManagementKvdbApiValidator } from "./ManagementKvdbApiValidator";
import { KvdbService } from "../../../service/cloud/KvdbService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import * as types from "../../../types";
import { ManagementKvdbConverter } from "./ManagementKvdbConverter";

export class ManagementKvdbApi extends ManagementBaseApi implements managementKvdbApi.IKvdbApi {
    
    constructor(
        managementKvdbApiValidator: ManagementKvdbApiValidator,
        authorizationDetector: AuthorizationDetector,
        authorizationHolder: AuthorizationHolder,
        private kvdbService: KvdbService,
        private managementKvdbConverter: ManagementKvdbConverter,
    ) {
        super(managementKvdbApiValidator, authorizationDetector, authorizationHolder);
    }
    
    @ApiMethod({errorCodes: ["KVDB_DOES_NOT_EXIST"] })
    async getKvdb(model: managementKvdbApi.GetKvdbModel): Promise<managementKvdbApi.GetKvdbResult> {
        this.validateScope("kvdb");
        const kvdb = await this.kvdbService.getKvdb(this.getPlainUser(), model.kvdbId, undefined);
        return {kvdb: this.managementKvdbConverter.convertKvdb(kvdb)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listKvdbs(model: managementKvdbApi.ListKvdbsModel): Promise<managementKvdbApi.ListKvdbsResult> {
        const info = await this.kvdbService.getKvdbsByContext(this.getPlainUser(), model.contextId, model);
        return {count: info.count, list: info.list.map(x => this.managementKvdbConverter.convertKvdb(x))};
    }
    
    @ApiMethod({errorCodes: ["KVDB_DOES_NOT_EXIST"] })
    async deleteKvdb(model: managementKvdbApi.DeleteKvdbModel): Promise<types.core.OK> {
        this.validateScope("kvdb");
        await this.kvdbService.deleteKvdb(this.getPlainUser(), model.kvdbId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["RESOURCES_HAVE_DIFFERENT_CONTEXTS"] })
    async deleteManyKvdbs(model: managementKvdbApi.DeleteManyKvdbsModel): Promise<managementKvdbApi.DeleteManyKvdbsResult> {
        this.validateScope("kvdb");
        const {results} = await this.kvdbService.deleteManyKvdbs(this.getPlainUser(), model.kvdbIds);
        return {results};
    }
    
    @ApiMethod({errorCodes: ["KVDB_ENTRY_DOES_NOT_EXIST"] })
    async getKvdbEntry(model: managementKvdbApi.GetKvdbEntryModel): Promise<managementKvdbApi.GetKvdbEntryResult> {
        this.validateScope("kvdb");
        const {kvdb, item} = await this.kvdbService.getKvdbEntry(this.getPlainUser(), model.kvdbId, model.kvdbEntryKey);
        return {kvdbEntry: this.managementKvdbConverter.convertKvdbEntry(kvdb, item)};
    }
    
    @ApiMethod({errorCodes: ["MESSAGES_BELONGS_TO_DIFFERENT_THREADS"] })
    async deleteManyKvdbEntries(model: managementKvdbApi.DeleteManyKvdbEntriesModel): Promise<managementKvdbApi.DeleteManyKvdbEntriesResult> {
        this.validateScope("kvdb");
        const {results} = await this.kvdbService.deleteManyItems(this.getPlainUser(), model.kvdbId, model.kvdbEntryKeys);
        return {results};
    }
    
    @ApiMethod({errorCodes: ["KVDB_ENTRY_DOES_NOT_EXIST"] })
    async deleteKvdbEntry(model: managementKvdbApi.DeleteKvdbEntryModel): Promise<types.core.OK> {
        this.validateScope("kvdb");
        await this.kvdbService.deleteItem(this.getPlainUser(), model.kvdbId, model.kvdbEntryKey);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["KVDB_DOES_NOT_EXIST"] })
    async listKvdbKeys(model: managementKvdbApi.ListKvdbKeysModel): Promise<managementKvdbApi.ListKvdbKeysResult> {
        this.validateScope("kvdb");
        const {kvdb, items} = await this.kvdbService.getKvdbEntriesKeysWithListModel2(this.getPlainUser(), model.kvdbId, model);
        return {
            kvdb: this.managementKvdbConverter.convertKvdb(kvdb),
            list: this.managementKvdbConverter.convertKvdbEntriesToKeys(items.list),
            count: items.count,
        };
    }
    
    @ApiMethod({errorCodes: ["KVDB_DOES_NOT_EXIST"] })
    async listKvdbEntries(model: managementKvdbApi.ListKvdbEntriesModel): Promise<managementKvdbApi.ListKvdbEntriesResult> {
        this.validateScope("kvdb");
        const {kvdb, items} = await this.kvdbService.getKvdbEntriesWithPlainUser(this.getPlainUser(), model.kvdbId, model, model.prefix);
        return {
            kvdb: this.managementKvdbConverter.convertKvdb(kvdb),
            list: items.list.map(item => this.managementKvdbConverter.convertKvdbEntry(kvdb, item)),
            count: items.count,
        };
    }
}
