/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService } from "../../master/Decorators";
import { ApiMethod } from "../../../api/Decorators";
import { Deferred } from "../../../CommonTypes";
import { PromiseUtils } from "../../../utils/PromiseUtils";

@IpcService
export class LockService {
    private deferMap = new Map<string, Deferred<unknown>[] >();
    
    @ApiMethod({})
    async lock(model: {lockName: string}) {
        const deferQueue = this.deferMap.get(model.lockName);
        if (!deferQueue || deferQueue.length === 0) {
            this.createDeferOnLock(model.lockName);
            return true;
        }
        const lastPromiseInQueue = await deferQueue[deferQueue.length - 1].promise;
        this.createDeferOnLock(model.lockName);
        await lastPromiseInQueue;
        return true;
    }
    
    @ApiMethod({})
    async unlock(model: {lockName: string}) {
        const deferQueue = this.deferMap.get(model.lockName);
        if (!deferQueue) {
            throw new Error("Unlock on unexisting lock");
        }
        const defer = deferQueue.shift();
        if (!defer) {
            throw new Error("Unlock on unexisting lock");
        }
        defer.resolve(true);
        return true;
    }
    
    createDeferOnLock<T = unknown>(lockName: string) {
        const defer = PromiseUtils.defer<T>();
        const deferQueue = this.deferMap.get(lockName);
        if (!deferQueue) {
            this.deferMap.set(lockName, [defer as Deferred<unknown>]);
        }
        else {
            deferQueue.push(defer as Deferred<unknown>);
        }
        return defer;
    }
}
