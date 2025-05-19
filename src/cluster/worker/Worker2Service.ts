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
import { ApiMethod } from "../../api/Decorators";
import { WebSocketInnerManager } from "../../service/ws/WebSocketInnerManager";
import { PlainApiEvent } from "../../api/plain/Types";
import { TargetChannel } from "../../service/ws/WebSocketConnectionManager";

export class Worker2Service implements IWorker2Service {
    
    constructor(
        private webSocketInnerManager: WebSocketInnerManager,
    ) {
    }
    
    @ApiMethod({})
    async sendWebsocketNotification<T extends types.core.Event<any, any>>(model: { channel: TargetChannel, host: types.core.Host; clients: types.core.Client[]|null; event: T; }): Promise<void> {
        return this.webSocketInnerManager.send(model.host, model.channel, model.clients, model.event);
    }
    
    @ApiMethod({})
    async sendWebsocketNotificationToPlainUsers(model: {solution: types.cloud.SolutionId, event: PlainApiEvent}): Promise<void> {
        return this.webSocketInnerManager.sendToPlainUsers(model.solution, model.event);
    }
    
    @ApiMethod({})
    async hasOpenConnectionWithUsername(model: { host: types.core.Host; username: types.core.Username; }): Promise<boolean> {
        return this.webSocketInnerManager.hasOpenConnectionWithUsername(model.host, model.username);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsBySession(model: { host: types.core.Host; sessionId: types.core.SessionId; }): Promise<void> {
        return this.webSocketInnerManager.disconnectWebSocketsBySession(model.host, model.sessionId);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsByUsername(model: { host: types.core.Host; username: types.core.Username; }): Promise<void> {
        return this.webSocketInnerManager.disconnectWebSocketsByUsername(model.host, model.username);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsBySubidentity(model: { host: types.core.Host; pub: types.core.EccPubKey; }): Promise<void> {
        return this.webSocketInnerManager.disconnectWebSocketsBySubidentity(model.host, model.pub);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsByDeviceId(model: { host: types.core.Host; deviceId: types.core.DeviceId; }): Promise<void> {
        return this.webSocketInnerManager.disconnectWebSocketsByDeviceId(model.host, model.deviceId);
    }
    
    @ApiMethod({})
    async disconnectWebSocketsBySubidentityGroup(model: { host: types.core.Host; groupId: types.user.UsersGroupId; }): Promise<void> {
        return this.webSocketInnerManager.disconnectWebSocketsBySubidentityGroup(model.host, model.groupId);
    }
}

