/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { WorkerIpcRequester } from "./WorkerIpcRequester";
import { IWorker2Service } from "../common/Worker2Service";
import * as types from "../../types";
import { PlainApiEvent } from "../../api/plain/Types";

export class Worker2ServiceClient implements IWorker2Service {
    
    constructor(
        private ipcRequester: WorkerIpcRequester
    ) {
    }

    sendWebsocketNotificationToPlainUsers(model: {solution: types.cloud.SolutionId; event: PlainApiEvent}): Promise<void> {
        return this.ipcRequester.request("sendWebsocketNotificationToPlainUsers", model);
    }
    
    sendWebsocketNotification<T extends types.core.Event<any, any>>(model: { channel: string, host: types.core.Host; clients: types.core.Client[]|null; event: T; }): Promise<void> {
        return this.ipcRequester.request("sendWebsocketNotification", model);
    }
    
    hasOpenConnectionWithUsername(model: { host: types.core.Host; username: types.core.Username; }): Promise<boolean> {
        return this.ipcRequester.request("hasOpenConnectionWithUsername", model);
    }
    
    disconnectWebSocketsBySession(model: { host: types.core.Host; sessionId: types.core.SessionId; }): Promise<void> {
        return this.ipcRequester.request("disconnectWebSocketsBySession", model);
    }
    
    disconnectWebSocketsByUsername(model: { host: types.core.Host; username: types.core.Username; }): Promise<void> {
        return this.ipcRequester.request("disconnectWebSocketsByUsername", model);
    }
    
    disconnectWebSocketsBySubidentity(model: { host: types.core.Host; pub: types.core.EccPubKey; }): Promise<void> {
        return this.ipcRequester.request("disconnectWebSocketsBySubidentity", model);
    }
    
    disconnectWebSocketsByDeviceId(model: { host: types.core.Host; deviceId: types.core.DeviceId; }): Promise<void> {
        return this.ipcRequester.request("disconnectWebSocketsByDeviceId", model);
    }
    
    disconnectWebSocketsBySubidentityGroup(model: { host: types.core.Host; groupId: types.user.UsersGroupId; }): Promise<void> {
        return this.ipcRequester.request("disconnectWebSocketsBySubidentityGroup", model);
    }
}
