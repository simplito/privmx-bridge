/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type * as Cluster from "cluster";
import { DeferredMap } from "../common/DeferredMap";
import { IpcRequester } from "../common/IpcRequester";

export class WorkerIpcRequester {
    
    private ipcRequester: IpcRequester;
    
    constructor(
        map: DeferredMap,
        private worker: Cluster.Worker,
    ) {
        this.ipcRequester = new IpcRequester(map);
    }
    
    request<T>(method: string, params: unknown): Promise<T> {
        return this.ipcRequester.request(this.worker, method, params);
    }
}
