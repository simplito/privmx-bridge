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
import * as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";

export class ApiUserRepository {
    
    static readonly COLLECTION_NAME = "api_user";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.auth.ApiUserId, db.auth.ApiUser>,
    ) {
    }
    
    async get(id: types.auth.ApiUserId) {
        return this.repository.get(id);
    }
    
    async create() {
        const user: db.auth.ApiUser = {
            id: this.repository.generateId() as types.auth.ApiUserId,
            created: DateUtils.now(),
            enabled: true,
        };
        await this.repository.insert(user);
        return user;
    }
    
    async setEnabled(userId: types.auth.ApiUserId, enabled: boolean) {
        await this.repository.collection.updateOne({_id: userId}, {$set: {enabled: enabled}});
    }
    
    async delete(id: types.auth.ApiUserId) {
        await this.repository.delete(id);
    }
}
