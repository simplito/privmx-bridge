/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Deferred } from "../../CommonTypes";
import { PromiseUtils } from "../../utils/PromiseUtils";

export class DeferredMap {
    
    private id: number = 1;
    private deferMap = new Map<number, Deferred<unknown>>();
    
    pop(id: number): Deferred<unknown> {
        const res = this.deferMap.get(id);
        this.deferMap.delete(id);
        return res;
    }
    
    create<T = unknown>() {
        const id = this.id++;
        const defer = PromiseUtils.defer<T>();
        this.deferMap.set(id, defer as Deferred<unknown>);
        return {id, defer};
    }
}
