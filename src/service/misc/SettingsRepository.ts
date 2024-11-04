/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as db from "../../db/Model";

export class SettingsRepository {
    
    static readonly COLLECTION_NAME = "settings";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<db.setting.SettingId, db.setting.SettingsEntry>,
    ) {
    }
    
    async get(id: db.setting.SettingId) {
        return this.repository.get(id);
    }
    
    async getOrDefault(id: db.setting.SettingId, entry: db.setting.SettingsEntry) {
        return this.repository.getOrDefault(id, entry);
    }
    
    async getMulti(ids: db.setting.SettingId[]) {
        return this.repository.getMulti(ids);
    }
    
    async exists(id: db.setting.SettingId) {
        return this.repository.exists(id);
    }
    
    async insert(entry: db.setting.SettingsEntry) {
        await this.repository.insert(entry);
    }
    
    async update(entry: db.setting.SettingsEntry) {
        await this.repository.update(entry);
    }
    
    async delete(id: db.setting.SettingId) {
        await this.repository.delete(id);
    }
}
