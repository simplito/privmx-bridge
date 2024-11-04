/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService } from "../Decorators";
import * as types from "../../../types";
import { ApiMethod } from "../../../api/Decorators";
import { CacheWithTTL } from "../../../utils/CacheWithTTL";

@IpcService
export class NonceMap {
    
    constructor(
        private cacheWithTTL: CacheWithTTL<true>,
    ) {
    }
    
    @ApiMethod({})
    async isValidNonce(model: {nonce: string, ttl: types.core.Timespan}) {
        const entry = this.cacheWithTTL.get(model.nonce);
        if (!entry) {
            this.cacheWithTTL.set(model.nonce, true, model.ttl);
        }
        return !entry;
    }
    
    deleteExpired() {
        this.cacheWithTTL.deleteExpired();
    }
}
