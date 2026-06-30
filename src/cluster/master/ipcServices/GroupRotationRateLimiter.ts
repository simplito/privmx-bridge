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
 * Cross-worker (IPC) sliding-window rate limiter for group key rotations (Phase 2, BR-4).
 * Keyed per group (the caller passes the groupId): BR-4 bounds epoch churn, which is a per-group cost
 * regardless of which manager triggers it. The state lives in the master process so the cap is global
 * across worker processes (an in-worker Map would only cap per worker). Modeled on NonceMap.
 */
@IpcService
export class GroupRotationRateLimiter {
    
    private static readonly MAX_ROTATIONS = 10;
    
    constructor(
        private cache: CacheWithTTL<number[]>,
    ) {
    }
    
    /**
     * Peek: returns whether a rotation for `key` is currently allowed within the window.
     * Does NOT consume quota — quota is consumed by `record` only after a rotation actually commits,
     * so lost CAS races / version mismatches do not burn the caller's budget.
     */
    @ApiMethod({})
    async check(model: {key: string}): Promise<{allowed: boolean}> {
        const cutoff = DateUtils.now() - DateUtils.hours(1);
        const timestamps = (this.cache.get(model.key) ?? []).filter(t => t > cutoff);
        return {allowed: timestamps.length < GroupRotationRateLimiter.MAX_ROTATIONS};
    }
    
    /** Commit: records one successful rotation for `key`. Call only after the rotation has committed. */
    @ApiMethod({})
    async record(model: {key: string}): Promise<void> {
        const window = DateUtils.hours(1);
        const cutoff = DateUtils.now() - window;
        const timestamps = (this.cache.get(model.key) ?? []).filter(t => t > cutoff);
        timestamps.push(DateUtils.now());
        this.cache.set(model.key, timestamps, window);
    }
    
    deleteExpired() {
        this.cache.deleteExpired();
    }
}
