/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { IWorker2Service } from "../../cluster/common/Worker2Service";
import { ConfigService } from "../config/ConfigService";
import { JobService } from "../job/JobService";
import { WebSocketEx, WebSocketSession } from "../../CommonTypes";
import { WebSocketInnerManager } from "./WebSocketInnerManager";
import { AppException } from "../../api/AppException";
import { Base64 } from "../../utils/Base64";
import { Session } from "../../api/session/Session";

export interface WebSocketConnectionManager {
    authorizeWebSocket(session: Session, wsEx: WebSocketEx, addWsChannelId: boolean, key: types.core.Base64): Promise<types.core.WsChannelId>;
    unauthorizeWebSocket(session: Session, wsEx: WebSocketEx): Promise<void>;
    subscribeToChannel(session: Session, wsEx: WebSocketEx, channel: string): Promise<void>;
    unsubscribeFromChannel(session: Session, wsEx: WebSocketEx, channel: string): Promise<void>;
    hasOpenConnectionWithUsername(username: types.core.Username): Promise<boolean>;
    disconnectWebSocketsBySession(sessionId: types.core.SessionId): void;
    disconnectWebSocketsByUsername(username: types.core.Username): void;
    disconnectWebSocketsBySubidentity(pub: types.core.EccPubKey): void;
    disconnectWebSocketsByDeviceId(deviceId: types.core.DeviceId): void;
    disconnectWebSocketsBySubidentityGroup(groupId: types.user.UsersGroupId): void;
    sendAtChannel<T extends types.core.Event<any, any>>(channel: string, clients: types.core.Client[], event: T): void;
}

export class SimpleWebSocketConnectionManager implements WebSocketConnectionManager {
    
    constructor(
        private jobService: JobService,
        private workerService: IWorker2Service,
        private configService: ConfigService,
        private webSocketInnerManager: WebSocketInnerManager,
    ) {
    }
    
    async authorizeWebSocket(session: Session, wsEx: WebSocketEx, addWsChannelId: boolean, key: types.core.Base64) {
        const wsId = session.getWsId();
        const properties = session.get("properties");
        if (wsEx.ex.sessions.some(x => x.wsId == wsId)) {
            throw new AppException("WEBSOCKET_ALREADY_AUTHORIZED");
        }
        if (wsEx.ex.sessions.length > 1024) {
            throw new AppException("EXCEEDED_LIMIT_OF_WEBSOCKET_CHANNELS");
        }
        if (wsEx.ex.sessions.length > 0 && !addWsChannelId) {
            throw new AppException("ADD_WS_CHANNEL_ID_REQUIRED_ON_MULTI_CHANNEL_WEBSOCKET");
        }
        if (wsEx.ex.sessions.some(x => !x.addWsChannelId)) {
            throw new AppException("CANNOT_ADD_CHANNEL_TO_SINGLE_CHANNEL_WEBSOCKET");
        }
        const wsChannelId = this.generateWsChannelId(wsEx.ex.sessions);
        this.webSocketInnerManager.addSession(wsEx, {
            id: session.getId(),
            host: this.configService.values.domain as types.core.Host,
            wsId: wsId,
            wsChannelId: wsChannelId,
            addWsChannelId: addWsChannelId,
            username: session.get("username"),
            subidentity: session.get("subidentity"),
            proxy: session.get("proxy"),
            rights: session.get("rights"),
            type: session.get("type"),
            deviceId: properties ? properties.deviceId : null,
            encryptionKey: Base64.toBuf(key),
            channels: [],
        });
        return wsChannelId;
    }
    
    async unauthorizeWebSocket(session: Session, wsEx: WebSocketEx) {
        this.webSocketInnerManager.removeSessionByWsId(wsEx, session.getWsId());
    }
    
    async subscribeToChannel(session: Session, wsEx: WebSocketEx, channel: string) {
        this.webSocketInnerManager.subscribeToChannel(wsEx, session.getWsId(), channel);
    }
    
    async unsubscribeFromChannel(session: Session, wsEx: WebSocketEx, channel: string) {
        this.webSocketInnerManager.unsubscribeFromChannel(wsEx, session.getWsId(), channel);
    }
    
    hasOpenConnectionWithUsername(username: types.core.Username) {
        return this.workerService.hasOpenConnectionWithUsername({host: this.getHost(), username});
    }
    
    disconnectWebSocketsBySession(sessionId: types.core.SessionId) {
        this.jobService.addJob(() => {
            return this.workerService.disconnectWebSocketsBySession({host: this.getHost(), sessionId});
        }, "disconnectWebSocketsBySession");
    }
    
    disconnectWebSocketsByUsername(username: types.core.Username) {
        this.jobService.addJob(() => {
            return this.workerService.disconnectWebSocketsByUsername({host: this.getHost(), username});
        }, "disconnectWebSocketsByUsername");
    }
    
    disconnectWebSocketsBySubidentity(pub: types.core.EccPubKey) {
        this.jobService.addJob(() => {
            return this.workerService.disconnectWebSocketsBySubidentity({host: this.getHost(), pub});
        }, "disconnectWebSocketsBySubidentity");
    }
    
    disconnectWebSocketsByDeviceId(deviceId: types.core.DeviceId) {
        this.jobService.addJob(() => {
            return this.workerService.disconnectWebSocketsByDeviceId({host: this.getHost(), deviceId});
        }, "disconnectWebSocketsByDeviceId");
    }
    
    disconnectWebSocketsBySubidentityGroup(groupId: types.user.UsersGroupId) {
        this.jobService.addJob(() => {
            return this.workerService.disconnectWebSocketsBySubidentityGroup({host: this.getHost(), groupId});
        }, "disconnectWebSocketsBySubidentityGroup");
    }
    
    sendAtChannel<T extends types.core.Event<any, any>>(channel: string, clients: types.core.Client[], event: T) {
        this.jobService.addJob(async () => {
            await this.workerService.sendWebsocketNotification({channel: channel, host: this.getHost(), clients, event});
        }, "Error during sending websocket notification");
    }
    
    private getHost() {
        return this.configService.values.domain as types.core.Host;
    }
    
    private generateWsChannelId(sessions: WebSocketSession[]) {
        while (true) {
            const wsChannelId = <types.core.WsChannelId>Math.floor(Math.random() * 0x7fffffff);
            if (!sessions.some(x => x.wsChannelId == wsChannelId)) {
                return wsChannelId;
            }
        }
    }
}
