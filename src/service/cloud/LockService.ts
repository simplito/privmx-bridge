/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { CloudLockService } from "../../cluster/master/ipcServices/CloudLockService";
import { LockLevel, LockResult, UnlockLevel, WriteableLockLevel } from "../../cluster/master/ipcServices/lock/LockTypes";

export { LockLevel, LockResult };

/**
 * Per-host facade over the master {@link CloudLockService}. The `host` is fixed at
 * construction time (from the owning IOC) and stamped onto every call, so callers
 * cannot cross tenant boundaries and never pass a host explicitly.
 */
export class LockService {
    
    constructor(
        private ipcService: CloudLockService,
        private host: types.core.Host,
    ) {}
    
    lock(resourceId: string, uuid: string, lockLevel: WriteableLockLevel): Promise<LockResult> {
        return this.ipcService.resourceLock({host: this.host, resourceId, uuid, lockLevel});
    }
    
    unlock(resourceId: string, uuid: string, lockLevel: UnlockLevel): Promise<LockResult> {
        return this.ipcService.resourceUnlock({host: this.host, resourceId, uuid, lockLevel});
    }
    
    checkReservedLock(resourceId: string, uuid: string): Promise<{reserved: boolean}> {
        return this.ipcService.resourceCheckReservedLock({host: this.host, resourceId, uuid});
    }
}
