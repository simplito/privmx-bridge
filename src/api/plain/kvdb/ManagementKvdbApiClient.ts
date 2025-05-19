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
import * as kvdbApi from "./ManagementKvdbApiTypes";

export class ManagementKvdbApiClient implements kvdbApi.IKvdbApi {
    
    constructor(
        private requester: Requester,
    ) {}
    
    async getKvdb(model: kvdbApi.GetKvdbModel): Promise<kvdbApi.GetKvdbResult> {
        return await this.requester.request("kvdb/getKvdb", model);
    }
    
    async listKvdbs(model: kvdbApi.ListKvdbsModel): Promise<kvdbApi.ListKvdbsResult> {
        return await this.requester.request("kvdb/listKvdbs", model);
    }
    
    async deleteKvdb(model: kvdbApi.DeleteKvdbModel): Promise<types.core.OK> {
        return await this.requester.request("kvdb/deleteKvdb", model);
    }
    
    async deleteManyKvdbs(model: kvdbApi.DeleteManyKvdbsModel): Promise<kvdbApi.DeleteManyKvdbsResult> {
        return await this.requester.request("kvdb/deleteManyKvdbs", model);
    }
    
    async getKvdbEntry(model: kvdbApi.GetKvdbEntryModel): Promise<kvdbApi.GetKvdbEntryResult> {
        return await this.requester.request("kvdb/getKvdbEntry", model);
    }
    
    async deleteKvdbEntry(model: kvdbApi.DeleteKvdbEntryModel): Promise<types.core.OK> {
        return await this.requester.request("kvdb/deleteKvdbEntry", model);
    }
    
    async deleteManyKvdbEntries(model: kvdbApi.DeleteManyKvdbEntriesModel): Promise<kvdbApi.DeleteManyKvdbEntriesResult> {
        return await this.requester.request("kvdb/deleteManyKvdbEntries", model);
    }
    
    async listKvdbKeys(model: kvdbApi.ListKvdbKeysModel): Promise<kvdbApi.ListKvdbKeysResult> {
        return await this.requester.request("kvdb/listKvdbKeys", model);
    }
    
    async listKvdbEntries(model: kvdbApi.ListKvdbEntriesModel): Promise<kvdbApi.ListKvdbEntriesResult> {
        return await this.requester.request("kvdb/listKvdbEntries", model);
    }
}
