/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService } from "../Decorators";
import { ApiMethod } from "../../../api/Decorators";
import { CacheWithTTL } from "../../../utils/CacheWithTTL";
import { DateUtils } from "../../../utils/DateUtils";

/**
 * Cross-worker (IPC) sliding-window rate limiter for group key rotations.
 * Keyed by whatever the caller passes; `GroupService.rateLimitKey` keeps a separate budget per member and
 * per kind of operation, so no member can spend another's. The state lives in the master process so the cap is global
 * across worker processes (an in-worker Map would only cap per worker). Modeled on NonceMap.
 */
@IpcService
export class GroupRotationRateLimiter {
    
    /** Used when the caller passes nothing, which only the tests do. */
    private static readonly DEFAULT_MAX_ROTATIONS = 10;
    
    constructor(
        private cache: CacheWithTTL<number[]>,
        private maxRotationsPerHour: number = GroupRotationRateLimiter.DEFAULT_MAX_ROTATIONS,
    ) {
    }
    
    /**
     * Reserves one unit of `key`'s budget — `limit` an hour, or the configured per-member budget when the caller
     * passes none — and says whether it could. Check and charge are one call in the master, so requests racing
     * each other cannot all pass on the last unit, as they could when this only peeked. A caller that does not
     * end up spending the unit hands it back with `release`.
     */
    @ApiMethod({})
    async reserve(model: {key: string, limit?: number}): Promise<{allowed: boolean}> {
        const window = DateUtils.hours(1);
        const cutoff = DateUtils.now() - window;
        const timestamps = (this.cache.get(model.key) ?? []).filter(t => t > cutoff);
        if (timestamps.length >= (model.limit ?? this.maxRotationsPerHour)) {
            return {allowed: false};
        }
        timestamps.push(DateUtils.now());
        this.cache.set(model.key, timestamps, window);
        return {allowed: true};
    }
    
    /** Hands back one unit `reserve` took and the caller did not spend. */
    @ApiMethod({})
    async release(model: {key: string}): Promise<void> {
        this.cache.get(model.key)?.pop();
    }
    
    deleteExpired() {
        this.cache.deleteExpired();
    }
}
