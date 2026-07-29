/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as db from "../../db/Model";
import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";

export class NonceRepository {
    
    static readonly COLLECTION_NAME = "nonce";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.core.Nonce, db.nonce.NonceEntry>,
    ) {
    }
    
    async insert(entry: db.nonce.NonceEntry) {
        await this.repository.insert(entry);
    }
    
    async exists(id: types.core.Nonce) {
        return this.repository.exists(id);
    }
    
    async deleteOld(timestamp: types.core.Timestamp) {
        await this.repository.deleteMany(q => q.lt("timestamp", timestamp));
    }
    
    async tryInsert(nonce: types.core.Nonce, timestamp: types.core.Timestamp) {
        try {
            await this.repository.insert({id: nonce, timestamp: timestamp});
            return true;
        }
        catch (e) {
            if (this.repository.isMongoDuplicateError(e)) {
                return false;
            }
            throw e;
        }
    }
}
