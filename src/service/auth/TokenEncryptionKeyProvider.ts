/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as db from "../../db/Model";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { DateUtils } from "../../utils/DateUtils";
import { ConfigService } from "../config/ConfigService";

export class TokenEncryptionKeyProvider {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private configService: ConfigService,
    ) {
    }
    
    async getCurrentKey() {
        const repository = this.repositoryFactory.createTokenEncryptionKeyRepository();
        const latestKey = await repository.getLatestKey();
        if (latestKey && latestKey.usageExpiryDate > DateUtils.now()) {
            return latestKey;
        }
        const newKey = await repository.create(this.configService.values.token.cipherKeyTTL, this.configService.values.token.refreshTokenLifetime);
        return newKey;
    }
    
    async getKey(id: db.auth.TokenEncryptionKeyId) {
        const cipherKey = await this.repositoryFactory.createTokenEncryptionKeyRepository().get(id);
        if (cipherKey && cipherKey.expiryDate > DateUtils.now()) {
            return cipherKey;
        }
        return null;
    }
}
