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
import { DateUtils } from "../../utils/DateUtils";
import { Hex } from "../../utils/Hex";
import { Crypto } from "../../utils/crypto/Crypto";
import * as types from "../../types";

export class TokenEncryptionKeyRepository {
    
    static readonly COLLECTION_NAME = "token_encryption_key";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<db.auth.TokenEncryptionKeyId, db.auth.TokenEncryptionKey>,
    ) {
    }
    
    async get(id: db.auth.TokenEncryptionKeyId) {
        return this.repository.get(id);
    }

    async getLatestKey() {
        return (await this.repository.query(q => q.empty()).sort("created", false).limit(1).array())[0];
    }
    
    async create(usageTTL: types.core.Timespan, refreshTokenTTL: types.core.Timespan) {
        const now = DateUtils.now();
        const cipherKey: db.auth.TokenEncryptionKey = {
            id: this.generateId(),
            key: this.generateKey(),
            created: now,
            usageExpiryDate: DateUtils.add(now, usageTTL),
            expiryDate: DateUtils.add(DateUtils.add(now, refreshTokenTTL), usageTTL),
            refreshTokenTTL: refreshTokenTTL,
        };
        await this.repository.insert(cipherKey);
        return cipherKey;
    }

    generateId() {
        return Hex.from(Crypto.randomBytes(16)) as db.auth.TokenEncryptionKeyId;
    }

    generateKey() {
        return Hex.from(Crypto.randomBytes(32)) as types.core.EncryptionKey;
    }
}
