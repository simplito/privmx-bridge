/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { LockService } from "../../cluster/master/ipcServices/LockService";

export class LockHelper {
    constructor(
        private lockService: LockService,
    ) {}
    
    async withLock<T>(lockName: string, func: () => Promise<T>) {
        await this.lockService.lock({lockName});
        try {
            const result = await func();
            return result;
        }
        finally {
            await this.lockService.unlock({lockName});
        }
    }
}
