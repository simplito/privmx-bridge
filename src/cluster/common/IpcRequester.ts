/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type * as Cluster from "cluster";
import { IpcChannelMessage, IpcRequest } from "../common/Ipc";
import { DeferredMap } from "./DeferredMap";

export class IpcRequester {
    
    constructor(
        private map: DeferredMap,
    ) {
    }
    
    request<T>(worker: Cluster.Worker, method: string, params: unknown): Promise<T> {
        const {id, defer} = this.map.create<T>();
        const request: IpcRequest = {id: id, method, params};
        const channelRequest: IpcChannelMessage = {channel: "request", data: request};
        worker.send(channelRequest);
        return defer.promise;
    }
}
