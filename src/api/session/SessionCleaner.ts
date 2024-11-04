/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { SessionStorage } from "./SessionStorage";
import { WebSocketConnectionManager } from "../../service/ws/WebSocketConnectionManager";
import { TicketsDb } from "../tls/TicketsDb";
import * as mongodb from "mongodb";

export class SessionCleaner {
    
    constructor(
        private ticketsDb: TicketsDb,
        private sessionStorage: SessionStorage,
        private webSocketConnectionManager: WebSocketConnectionManager
    ) {
    }
    
    async clearOldSessions(session: mongodb.ClientSession) {
        await this.ticketsDb.cleanTicketsDb(session);
        await this.sessionStorage.cleanOldSessions(session);
    }
    
    async destroySession(session: mongodb.ClientSession, sessionId: types.core.SessionId) {
        await this.sessionStorage.removeSession(session, sessionId);
        await this.ticketsDb.removeTickestBySessions(session, [sessionId]);
        this.webSocketConnectionManager.disconnectWebSocketsBySession(sessionId);
    }
    
    async destroySessionsOfUser(session: mongodb.ClientSession, username: types.core.Username) {
        const sessionIds = await this.sessionStorage.removeSessionsByUser(session, username);
        await this.ticketsDb.removeTickestBySessions(session, sessionIds);
        this.webSocketConnectionManager.disconnectWebSocketsByUsername(username);
    }
    
    async destroySessionsOfSubidentity(session: mongodb.ClientSession, pub: types.core.EccPubKey) {
        const sessionIds = await this.sessionStorage.removeSessionsBySubidentity(session, pub);
        await this.ticketsDb.removeTickestBySessions(session, sessionIds);
        this.webSocketConnectionManager.disconnectWebSocketsBySubidentity(pub);
    }
    
    async destroySessionsOfDevice(session: mongodb.ClientSession, deviceId: types.core.DeviceId) {
        const sessionIds = await this.sessionStorage.removeSessionsByDeviceId(session, deviceId);
        await this.ticketsDb.removeTickestBySessions(session, sessionIds);
        this.webSocketConnectionManager.disconnectWebSocketsByDeviceId(deviceId);
    }
    
    async destroySubidentitySessionsWithGroup(session: mongodb.ClientSession, groupId: types.user.UsersGroupId) {
        const sessionIds = await this.sessionStorage.removeSessionsBySubidentityGroup(session, groupId);
        await this.ticketsDb.removeTickestBySessions(session, sessionIds);
        this.webSocketConnectionManager.disconnectWebSocketsBySubidentityGroup(groupId);
    }
}
