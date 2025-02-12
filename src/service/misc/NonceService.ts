/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppException } from "../../api/AppException";
import { ConfigService } from "../config/ConfigService";
import { Crypto } from "../../utils/crypto/Crypto";
import { ECUtils } from "../../utils/crypto/ECUtils";
import * as elliptic from "elliptic";
import * as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";
import { Base64 } from "../../utils/Base64";
import { Hex } from "../../utils/Hex";
import { RepositoryFactory } from "../../db/RepositoryFactory";

export class NonceService {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private configService: ConfigService,
    ) {
    }
    
    signWithNonce(data: Buffer, key: elliptic.ec.KeyPair) {
        const nonce = <types.core.Nonce><string>Hex.from(Crypto.randomBytes(16));
        const timestamp = DateUtils.now();
        return {
            nonce: nonce,
            timestamp: timestamp,
            signature: this.signWithNonceCore(data, key, nonce, timestamp),
        };
    }
    
    signWithNonceCore(data: Buffer, key: elliptic.ec.KeyPair, nonce: types.core.Nonce, timestamp: types.core.Timestamp) {
        const message = this.getMessage(data, nonce, timestamp);
        return ECUtils.signToCompactSignature(key, message);
    }
    
    getMessage(data: Buffer, nonce: types.core.Nonce, timestamp: types.core.Timestamp): Buffer {
        return Crypto.sha256(Buffer.concat([data,  Buffer.from(" " + nonce + " " + timestamp, "utf8")]));
    }
    
    validateTimestamp(timestamp: types.core.Timestamp): boolean {
        return timestamp != null && DateUtils.timestampInRange(timestamp, this.configService.values.misc.maxTimestampDifference);
    }
    
    async simpleNonceCheck(nonce: types.core.Nonce, timestamp: types.core.Timestamp) {
        if (!this.validateTimestamp(timestamp)) {
            throw new AppException("INVALID_TIMESTAMP");
        }
        if (nonce == null || nonce.length < 32 || nonce.length > 64 || !(await this.nonceIsUnique(nonce, timestamp))) {
            throw new AppException("INVALID_NONCE");
        }
    }
    
    async nonceCheck(data: Buffer, key: elliptic.ec.KeyPair, nonce: types.core.Nonce, timestamp: types.core.Timestamp, signature: Buffer) {
        await this.simpleNonceCheck(nonce, timestamp);
        const message = this.getMessage(data, nonce, timestamp);
        if (!ECUtils.verifySignature(key, signature, message)) {
            throw new AppException("INVALID_SIGNATURE");
        }
    }
    
    async nonceCheck2(data: Buffer, key: types.core.EccPubKey, nonce: types.core.Nonce, timestamp: types.core.Timestamp, signature: types.core.EccSignature) {
        const eccKey = ECUtils.publicFromBase58DER(key);
        if (!eccKey) {
            throw new AppException("INVALID_SIGNATURE");
        }
        await this.nonceCheck(data, eccKey, nonce, timestamp, Base64.toBuf(signature));
    }
    
    async nonceCheck2P(data: Buffer, key: elliptic.ec.KeyPair, nonce: types.core.Nonce, timestamp: types.core.Timestamp, signature: types.core.EccSignature) {
        await this.nonceCheck(data, key, nonce, timestamp, Base64.toBuf(signature));
    }
    
    async nonceIsUnique(nonce: types.core.Nonce, timestamp: types.core.Timestamp) {
        const repo = this.repositoryFactory.createNonceRepository();
        const inserted = await repo.tryInsert(nonce, timestamp);
        return inserted;
    }
    
    cleanNonceDb() {
        return this.repositoryFactory.withTransaction(async session => {
            const repo = this.repositoryFactory.createNonceRepository(session);
            const theOldestAllowed = DateUtils.nowSub(this.configService.values.misc.maxTimestampDifference);
            return repo.deleteOld(theOldestAllowed);
        });
    }
}
