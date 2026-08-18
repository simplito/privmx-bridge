/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import { ApiMethod } from "../../../api/Decorators";
import { IpcService } from "../Decorators";
import { LockStore } from "./lock/LockStore";
import { InMemoryLockStore } from "./lock/InMemoryLockStore";
import { LockLevel, LockResult, UnlockLevel, WriteableLockLevel } from "./lock/LockTypes";

export { LockLevel, LockResult, UnlockLevel, WriteableLockLevel };

/**
 * Master-process IPC service exposing the resource-lock protocol to workers.
 *
 * This service is a singleton shared across every tenant served by the node, so
 * the tenant `host` is mixed into the storage key here. Keeping every distinct
 * `host` in its own key space is what isolates tenants from each other — a caller
 * can only ever touch locks under its own host. `host` is supplied server-side by
 * the worker's per-host IOC, never by the client.
 *
 * All state lives in the injected {@link LockStore}; swapping it for a distributed
 * (e.g. Redis) implementation is the intended path to sharing locks across nodes.
 */
@IpcService
export class CloudLockService {
    
    constructor(
        private readonly store: LockStore = new InMemoryLockStore(),
    ) {}
    
    @ApiMethod({})
    async resourceLock(model: {host: types.core.Host, resourceId: string, uuid: string, lockLevel: WriteableLockLevel}): Promise<LockResult> {
        return this.store.lock(this.buildKey(model.host, model.resourceId), model.uuid, model.lockLevel);
    }
    
    @ApiMethod({})
    async resourceUnlock(model: {host: types.core.Host, resourceId: string, uuid: string, lockLevel: UnlockLevel}): Promise<LockResult> {
        return this.store.unlock(this.buildKey(model.host, model.resourceId), model.uuid, model.lockLevel);
    }
    
    @ApiMethod({})
    async resourceCheckReservedLock(model: {host: types.core.Host, resourceId: string, uuid: string}): Promise<{reserved: boolean}> {
        return this.store.checkReservedLock(this.buildKey(model.host, model.resourceId), model.uuid);
    }
    
    /**
     * Builds the tenant-scoped storage key. `resourceId` is validated to contain
     * no `:` (see LockApiValidator), so the mapping (host, resourceId) -> key is
     * unambiguous regardless of the host's own contents.
     */
    private buildKey(host: types.core.Host, resourceId: string): string {
        return `${host}:${resourceId}`;
    }
}
