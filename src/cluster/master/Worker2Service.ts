/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { IWorker2Service } from "../common/Worker2Service";
import { IpcRequester } from "../common/IpcRequester";
import { WorkersHolder } from "./WorkersHolder";
import { ApiMethod } from "../../api/Decorators";
import { PlainApiEvent } from "../../api/plain/Types";

export class Worker2Service implements IWorker2Service {
    
    constructor(
        private ipcRequester: IpcRequester,
        private workersHolder: WorkersHolder,
    ) {
    }
    
    private request<T = unknown>(method: string, params: unknown) {
        return Promise.all(this.workersHolder.getWorkers().map(async worker => {
            return {worker, result: await this.ipcRequester.request<T>(worker, method, params)};
        }));
    }

    @ApiMethod({})
    async sendWebsocketNotificationToPlainUsers(model: { channel: string; solution: types.cloud.SolutionId; event: PlainApiEvent}): Promise<void> {
        await this.request("sendWebsocketNotificationToPlainUsers", model);
    }
    
    @ApiMethod({})
    async sendWebsocketNotification<T = unknown>(model: { channel: string, host: types.core.Host; clients: types.core.Client[]; event: T; }): Promise<void> {
        await this.request("sendWebsocketNotification", model);
    }
    
    @ApiMethod({})
    async hasOpenConnectionWithUsername(model: { host: types.core.Host; username: types.core.Username; }): Promise<boolean> {
        const res = await this.request<boolean>("hasOpenConnectionWithUsername", model);
        return res.some(x => x.result);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsBySession(model: { host: types.core.Host; sessionId: types.core.SessionId; }): Promise<void> {
        await this.request("disconnectWebSocketsBySession", model);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsByUsername(model: { host: types.core.Host; username: types.core.Username; }): Promise<void> {
        await this.request("disconnectWebSocketsByUsername", model);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsBySubidentity(model: { host: types.core.Host; pub: types.core.EccPubKey; }): Promise<void> {
        await this.request("disconnectWebSocketsBySubidentity", model);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsByDeviceId(model: { host: types.core.Host; deviceId: types.core.DeviceId; }): Promise<void> {
        await this.request("disconnectWebSocketsByDeviceId", model);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsBySubidentityGroup(model: { host: types.core.Host; groupId: types.user.UsersGroupId; }): Promise<void> {
        await this.request("disconnectWebSocketsBySubidentityGroup", model);
    }
}
