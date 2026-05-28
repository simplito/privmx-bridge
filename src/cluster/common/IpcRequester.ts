/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type * as Cluster from "cluster";
import { IpcBatchState, IpcChannelMessage, IpcRequest } from "../common/Ipc";
import { DeferredMap } from "./DeferredMap";
import { Utils } from "../../utils/Utils";

declare module "cluster" {
    interface Worker {
        ipcBatch?: IpcBatchState;
    }
}

export class IpcRequester {
    
    subscriberBatch: IpcBatchState|undefined = undefined;
    readonly id: string;
    constructor(
        private map: DeferredMap,
    ) {
        this.id = Utils.getThisWorkerId();
    }
    
    request<T>(worker: Cluster.Worker, method: string, params: unknown, direct?: boolean): Promise<T> {
        const {id, defer} = this.map.create<T>();
        const request: IpcRequest = {id: id, method, params};
        const channelRequest: IpcChannelMessage = {channel: "request", data: request};
        if (direct) {
            worker.send(channelRequest, undefined, {keepOpen: true});
        }
        else {
            this.scheduleSend(worker, channelRequest);
        }
        return defer.promise;
    }
    
    private scheduleSend(worker: Cluster.Worker, channelRequest: IpcChannelMessage) {
        if (!worker.ipcBatch) {
            worker.ipcBatch = {
                queue: [],
                debounceTimer: null,
                maxWaitTimer: null,
            };
        }
        
        worker.ipcBatch.queue.push(channelRequest);
        
        if (worker.ipcBatch.debounceTimer) {
            clearTimeout(worker.ipcBatch.debounceTimer);
        }
        
        worker.ipcBatch.debounceTimer = setTimeout(() => this.flush(worker), 5);
        
        if (!worker.ipcBatch.maxWaitTimer) {
            worker.ipcBatch.maxWaitTimer = setTimeout(() => this.flush(worker), 10);
        }
    }
    
    private flush(worker: Cluster.Worker) {
        if (!worker.ipcBatch || worker.ipcBatch.queue.length === 0) {
            return;
        }
        
        const { queue } = worker.ipcBatch;
        
        clearTimeout(worker.ipcBatch.debounceTimer!);
        clearTimeout(worker.ipcBatch.maxWaitTimer!);
        worker.ipcBatch = undefined;
        
        const batchMessage: IpcChannelMessage = {
            channel: "request-batch",
            data: queue,
        };
        
        worker.send(batchMessage, undefined, {keepOpen: true});
    }
}