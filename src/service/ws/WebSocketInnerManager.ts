/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as WebSocket from "ws";
import * as types from "../../types";
import { WebSocketEx, WebSocketSession } from "../../CommonTypes";
import { Crypto } from "../../utils/crypto/Crypto";
import { PsonHelperEx } from "../../utils/PsonHelperEx";
import { PlainApiEvent } from "../../api/plain/Types";

export class WebSocketInnerManager {
    
    private servers: WebSocket.Server[];
    private psonHelper: PsonHelperEx;
    
    constructor() {
        this.servers = [];
        this.psonHelper = new PsonHelperEx([]);
    }
    
    registerServer(server: WebSocket.Server) {
        this.servers.push(server);
    }

    sendToPlainUsers(solution: types.cloud.SolutionId, event: PlainApiEvent) {
        for (const server of this.servers) {
            for (const client of server.clients) {
                const ws = <WebSocketEx>client;
                if (ws.ex.plainUserInfo) {
                    const entry = ws.ex.plainUserInfo.plainApiChannels.get(event.channel as types.core.WsChannelName);
                    if (entry && (entry.has(solution) || entry.has("*" as types.cloud.SolutionId))) {
                        ws.send(JSON.stringify(event));
                    }
                }
            }
        }
    }
    
    send<T extends types.core.Event<any, any>>(host: types.core.Host, channel: string, clients: types.core.Client[], event: T) {
        if (clients != null && clients.length == 0) {
            return;
        }
        return this.sendBuffer(host, channel, clients, this.serializeEvent(event));
    }
    
    private sendBuffer(host: types.core.Host, channel: string, clients: types.core.Client[], message: Buffer) {
        for (const server of this.servers) {
            for (const client of server.clients) {
                const ws = <WebSocketEx>client;
                for (const session of ws.ex.sessions) {
                    if (session.host === host && (clients == null || clients.includes(session.username)) && (channel === "" || session.channels.includes(channel))) {
                        this.sendToWsSession(ws, session, message);
                    }
                }
            }
        }
    }
    
    private sendToWsSession(ws: WebSocketEx, session: WebSocketSession, message: Buffer) {
        const prefix = this.preparePrefix(session);
        const cipher = Buffer.concat([prefix, Crypto.aes256CbcHmac256Encrypt(message, session.encryptionKey)]);
        ws.send(cipher);
    }
    
    private serializeEvent(event: any) {
        return this.psonHelper.pson_encode(event);
    }
    
    private preparePrefix(session: WebSocketSession) {
        if (session.addWsChannelId) {
            const prefix = Buffer.alloc(8, 0);
            prefix.writeUInt32BE(session.wsChannelId, 4);
            return prefix;
        }
        return Buffer.alloc(4, 0);
    }
    
    hasOpenConnectionWithUsername(host: types.core.Host, username: types.core.Username): boolean {
        return this.servers.some(server => {
            for (const client of server.clients) {
                const ws = <WebSocketEx>client;
                if (ws.ex.sessions.some(x => x.host === host && x.username == username && x.subidentity == null)) {
                    return true;
                }
            }
            return false;
        });
    }
    
    disconnectWebSocketsBySession(host: types.core.Host, sessionId: types.core.SessionId) {
        return this.disconnectWebSocketsBy(host, session => session.id == sessionId);
    }
    
    disconnectWebSocketsByUsername(host: types.core.Host, username: types.core.Username) {
        return this.disconnectWebSocketsBy(host, session => session.username == username);
    }
    
    disconnectWebSocketsBySubidentity(host: types.core.Host, pub: types.core.EccPubKey) {
        return this.disconnectWebSocketsBy(host, session => session.subidentity && session.subidentity.pub == pub);
    }
    
    disconnectWebSocketsByDeviceId(host: types.core.Host, deviceId: types.core.DeviceId) {
        return this.disconnectWebSocketsBy(host, session => session.deviceId == deviceId);
    }
    
    disconnectWebSocketsBySubidentityGroup(host: types.core.Host, groupId: types.user.UsersGroupId) {
        return this.disconnectWebSocketsBy(host, session => session.subidentity && session.subidentity.acl && session.subidentity.acl.group == groupId);
    }
    
    disconnectWebSocketsBy(host: types.core.Host, func: (session: WebSocketSession) => boolean) {
        const usersToCheck = new Set<types.core.Username>();
        for (const server of this.servers) {
            for (const client of server.clients) {
                const ws = <WebSocketEx>client;
                ws.ex.sessions = ws.ex.sessions.filter(session => {
                    if (session.host === host && func(session)) {
                        this.sendToWsSession(ws, session, this.serializeEvent({type: "disconnected"}));
                        usersToCheck.add(session.username);
                        return false;
                    }
                    return true;
                });
            }
        }
        for (const username of usersToCheck) {
            this.refreshHasOpenedWebSocketsForUser(host, username);
        }
    }
    
    onClose(wsEx: WebSocketEx) {
        for (const session of wsEx.ex.sessions) {
            this.refreshHasOpenedWebSocketsForUser(session.host, session.username);
        }
    }
    
    addSession(wsEx: WebSocketEx, session: WebSocketSession) {
        wsEx.ex.sessions.push(session);
        this.refreshHasOpenedWebSocketsForUser(session.host, session.username);
    }
    
    removeSessionByWsId(wsEx: WebSocketEx, wsId: types.core.WsId) {
        const index = wsEx.ex.sessions.findIndex(x => x.wsId == wsId);
        if (index != -1) {
            const session = wsEx.ex.sessions[index];
            wsEx.ex.sessions.splice(index, 1);
            this.refreshHasOpenedWebSocketsForUser(session.host, session.username);
        }
    }
    
    subscribeToChannel(wsEx: WebSocketEx, wsId: types.core.WsId, channel: string) {
        const wsSession = wsEx.ex.sessions.find(x => x.wsId == wsId);
        if (wsSession && !wsSession.channels.includes(channel)) {
            wsSession.channels.push(channel);
        }
    }
    
    unsubscribeFromChannel(wsEx: WebSocketEx, wsId: types.core.WsId, channel: string) {
        const wsSession = wsEx.ex.sessions.find(x => x.wsId == wsId);
        if (wsSession && wsSession.channels.includes(channel)) {
            wsSession.channels = wsSession.channels.filter(x => x !== channel);
        }
    }
    
    private refreshHasOpenedWebSocketsForUser(_host: types.core.Host, _username: types.core.Username) {
        // Do nothing
    }
}
