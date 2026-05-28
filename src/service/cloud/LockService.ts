/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { CloudLockService, LockLevel, LockResult } from "../../cluster/master/ipcServices/CloudLockService";

export { LockLevel, LockResult };

export class LockService {
    
    constructor(
        private ipcService: CloudLockService,
    ) {}
    
    lock(resourceId: string, uuid: string, lockLevel: Exclude<LockLevel, "none">): Promise<LockResult> {
        return this.ipcService.resourceLock({resourceId, uuid, lockLevel});
    }
    
    unlock(resourceId: string, uuid: string, lockLevel: "none" | "shared"): Promise<LockResult> {
        return this.ipcService.resourceUnlock({resourceId, uuid, lockLevel});
    }
    
    checkReservedLock(resourceId: string, uuid: string): Promise<{reserved: boolean}> {
        return this.ipcService.resourceCheckReservedLock({resourceId, uuid});
    }
}
