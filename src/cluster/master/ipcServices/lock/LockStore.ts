/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { LockResult, UnlockLevel, WriteableLockLevel } from "./LockTypes";

/**
 * Backend-agnostic storage for the resource-lock state machine.
 *
 * Each method is the atomic unit of the locking protocol: a single call performs
 * the whole read-modify-write for one key and must be indivisible with respect to
 * concurrent callers operating on the same key.
 *
 * - {@link InMemoryLockStore} satisfies this by running on the single-threaded
 *   master process (no `await` splits a method body, so it never interleaves).
 * - A future Redis-backed implementation must satisfy it by expressing each method
 *   as a single Lua script (or a WATCH/MULTI retry loop) and by taking the current
 *   time from the Redis server (`TIME`) rather than a local clock, so that lease
 *   timeouts stay consistent across bridge nodes.
 *
 * `key` is an already-namespaced, opaque identifier (see CloudLockService, which
 * prefixes it with the tenant host). Implementations must treat it as opaque and
 * never share state across distinct keys.
 */
export interface LockStore {
    /**
     * Acquire or upgrade the lock held by `uuid` on `key` to at least `level`.
     * Re-requesting a level already held renews its lease (acts as a heartbeat).
     */
    lock(key: string, uuid: string, level: WriteableLockLevel): Promise<LockResult>;
    
    /**
     * Release, or downgrade to `shared`, the lock held by `uuid` on `key`.
     * Never acquires a stronger lock than currently held.
     */
    unlock(key: string, uuid: string, level: UnlockLevel): Promise<LockResult>;
    
    /**
     * Report whether some other holder currently keeps `key` at `reserved` or above.
     */
    checkReservedLock(key: string, uuid: string): Promise<{reserved: boolean}>;
}
