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
import { IBrokerClient } from "../common/BrokerClient";
import { IpcRequest, IpcChannelMessage, IpcBatchState } from "../common/Ipc";

export class WorkerIpcRequester {
    
    private ipcRequester: IpcRequester;
    private subscriberBatch: IpcBatchState|undefined = undefined;
    
    constructor(
        map: DeferredMap,
        private worker: Cluster.Worker,
        private brokerClient: IBrokerClient,
    ) {
        this.ipcRequester = new IpcRequester(map);
    }
    
    request<T>(method: string, params: unknown, direct?: boolean): Promise<T> {
        return this.ipcRequester.request(this.worker, method, params, direct);
    }
    
    publishToBroker(method: string, params: unknown): void {
        const request: IpcRequest = {id: -1, method, params};
        const channelRequest: IpcChannelMessage = {channel: "request_void", data: request};
        void this.scheduleSubscribersNotify(channelRequest);
    }
    
    private scheduleSubscribersNotify(channelRequest: IpcChannelMessage) {
        if (!this.subscriberBatch) {
            this.subscriberBatch = {
                queue: [],
                debounceTimer: null,
                maxWaitTimer: null,
            };
        }
        
        this.subscriberBatch.queue.push(channelRequest);
        
        if (this.subscriberBatch.debounceTimer) {
            clearTimeout(this.subscriberBatch.debounceTimer);
        }
        
        this.subscriberBatch.debounceTimer = setTimeout(() => this.flushSub(), 1);
        
        if (!this.subscriberBatch.maxWaitTimer) {
            this.subscriberBatch.maxWaitTimer = setTimeout(() => this.flushSub(), 3);
        }
    }
    
    private flushSub() {
        if (!this.subscriberBatch || this.subscriberBatch.queue.length === 0) {
            return;
        }
        
        const { queue } = this.subscriberBatch;
        
        clearTimeout(this.subscriberBatch.debounceTimer!);
        clearTimeout(this.subscriberBatch.maxWaitTimer!);
        this.subscriberBatch = undefined;
        
        const batchMessage: IpcChannelMessage = {
            channel: "request-batch",
            data: queue,
        };
        
        void this.brokerClient.publish(batchMessage);
    }
}
