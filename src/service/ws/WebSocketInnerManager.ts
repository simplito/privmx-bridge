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
import { TargetChannel } from "./WebSocketConnectionManager";
import { Config } from "../../cluster/common/ConfigUtils";
import { AppException } from "../../api/AppException";
import { EncoderHelper, EncoderType } from "../../utils/Encoder";
import { DateUtils } from "../../utils/DateUtils";
import { Logger } from "../log/Logger";

export class WebSocketInnerManager {
    
    private servers: WebSocket.Server[];
    private encoderHelper: EncoderHelper;
    private userLookUpMap: Map<types.core.Username, WebSocketEx[]> = new Map();
    private plainUsersMap: Map<string, WebSocketEx> = new Map();
    
    constructor(
        private config: Config,
        private logger: Logger,
    ) {
        this.servers = [];
        this.encoderHelper = new EncoderHelper(new PsonHelperEx([]));
    }
    
    registerServer(server: WebSocket.Server) {
        this.servers.push(server);
    }
    
    sendToPlainUsers(solution: types.cloud.SolutionId, event: PlainApiEvent) {
        for (const client of this.plainUsersMap.values()) {
            const ws = <WebSocketEx>client;
            if (ws.ex.plainUserInfo) {
                const entry = ws.ex.plainUserInfo.plainApiChannels.get(event.channel as types.core.WsChannelName);
                if (entry && (entry.has(solution) || entry.has("*" as types.cloud.SolutionId))) {
                    ws.send(JSON.stringify(event));
                }
            }
        }
    }
    
    send<T extends types.core.Event<any, any>>(host: types.core.Host, channel: TargetChannel, clients: types.core.Client[]|null, event: T) {
        if (clients !== null && clients.length == 0) {
            return;
        }
        if (clients === null) {
            this.broadcastEvent(host, channel, event);
            return;
        }
        for (const client of clients) {
            const sockets = this.userLookUpMap.get(client as types.core.Username) || [];
            for (const socket of sockets) {
                if (socket.readyState !== socket.OPEN) {
                    continue;
                }
                for (const session of socket.ex.sessions) {
                    if (session.host !== host || session.username !== client) {
                        continue;
                    }
                    const {matchingSubscriptions, options} = this.getMatchingsubscriptionsAndOptions(channel, session.channels);
                    if (matchingSubscriptions.length !== 0) {
                        const sessionEventCopy = this.createShallowEventCopy(event, options.version !== 1);
                        sessionEventCopy.subscriptions = matchingSubscriptions;
                        sessionEventCopy.version = options.version;
                        this.sendToWsSession(socket, session, sessionEventCopy);
                    }
                }
            }
        }
    }
    
    private broadcastEvent<T extends types.core.Event<any, any>>(host: types.core.Host, channel: TargetChannel, event: T) {
        for (const server of this.servers) {
            for (const client of server.clients) {
                const ws = <WebSocketEx>client;
                for (const session of ws.ex.sessions) {
                    if (session.host !== host) {
                        continue;
                    }
                    const {matchingSubscriptions, options} = this.getMatchingsubscriptionsAndOptions(channel, session.channels);
                    if (matchingSubscriptions.length !== 0) {
                        const sessionEventCopy = this.createShallowEventCopy(event, options.version !== 1);
                        sessionEventCopy.subscriptions = matchingSubscriptions;
                        sessionEventCopy.version = options.version;
                        this.sendToWsSession(ws, session, sessionEventCopy);
                    }
                }
            }
        }
    }
    
    private getMatchingsubscriptionsAndOptions(targetChannel: TargetChannel, userChannels: types.cloud.ChannelScheme[]) {
        const matchingSubscriptions = [];
        const options = {
            version: 2,
        };
        for (const userChannel of userChannels) {
            if (userChannel.version < options.version) {
                options.version = userChannel.version;
            }
            if (userChannel.limitedBy === "containerId" && targetChannel.containerId && (userChannel.objectId !== targetChannel.containerId)) {
                continue;
            }
            if (userChannel.limitedBy === "contextId" && (userChannel.objectId !== targetChannel.contextId)) {
                continue;
            }
            if (userChannel.limitedBy === "itemId" && targetChannel.itemId && (userChannel.objectId !== targetChannel.itemId)) {
                continue;
            }
            if (userChannel.containerType && userChannel.containerType !== targetChannel.containerType) {
                continue;
            }
            if (!this.isPathPrefix(userChannel.path, targetChannel.channel)) {
                continue;
            }
            matchingSubscriptions.push(userChannel.subscriptionId);
        }
        return {matchingSubscriptions, options};
    }
    
    private isPathPrefix(parent: string, child: string): boolean {
        return child.startsWith(parent);
    }
    
    prepareEvent(session: WebSocketSession, message: Buffer, plain?: boolean) {
        const prefix = this.preparePrefix(session);
        const cipher = Buffer.concat([prefix, plain ? message : Crypto.aes256CbcHmac256Encrypt(message, session.encryptionKey)]);
        return cipher;
    }
    
    private sendToWsSession<T extends types.core.Event<any, any>>(ws: WebSocketEx, session: WebSocketSession, event: T) {
        if (session.encoder === EncoderType.PSON) {
            const serializedPayload = this.serializeEvent(session.encoder, event);
            const preparedEvent = this.prepareEvent(session, serializedPayload, session.plainCommunication);
            ws.send(preparedEvent);
            return;
        }
        session.eventBucket.push(event);
        
        const INITIAL_DELAY = 20;
        const MAX_DELAY = 100;
        
        const flushBatch = () => {
            for (const virtualSession of ws.ex.sessions) {
                if (virtualSession.eventBucket.length > 0 && ws.readyState === ws.OPEN) {
                    const serializedBatch = this.serializeEvent(EncoderType.MSGPACK, virtualSession.eventBucket);
                    const preparedBatch = this.prepareEvent(virtualSession, serializedBatch, virtualSession.plainCommunication);
                    virtualSession.eventBucket = [];
                    ws.send(preparedBatch);
                }
                else {
                    virtualSession.eventBucket = [];
                }
            }
            ws.ex.flushTimer = undefined;
            ws.ex.batchStartTime = undefined;
        };
        
        if (!ws.ex.flushTimer) {
            ws.ex.batchStartTime = DateUtils.now();
            ws.ex.flushTimer = setTimeout(flushBatch, INITIAL_DELAY);
        }
        else {
            clearTimeout(ws.ex.flushTimer);
            const elapsedTime = DateUtils.now() - (ws.ex.batchStartTime ?? DateUtils.now());
            const remainingTimeInWindow = MAX_DELAY - elapsedTime;
            const newDelay = Math.max(0, Math.min(INITIAL_DELAY, remainingTimeInWindow));
            ws.ex.flushTimer = setTimeout(flushBatch, newDelay);
        }
    }
    
    private serializeEvent(encoder: EncoderType, event: any) {
        return this.encoderHelper.getEncoder(encoder).encode(event);
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
    
    async disconnectWebSocketsBy(host: types.core.Host, func: (session: WebSocketSession) => boolean) {
        const usersToCheck = new Set<types.core.Username>();
        for (const server of this.servers) {
            for (const client of server.clients) {
                const ws = <WebSocketEx>client;
                ws.ex.sessions = ws.ex.sessions.filter(session => {
                    if (session.host === host && func(session)) {
                        this.sendToWsSession(ws, session, {type: "disconnected", data: {}});
                        usersToCheck.add(session.username);
                        void (async () => {
                            const hostContext = await ws.ex.contextFactory(session.instanceHost);
                            void hostContext.getUserStatusManager().decrementUserActiveSessions(session.instanceHost, session.username as unknown as types.core.EccPubKey, session.solution);
                        })();
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
    
    async onClose(wsEx: WebSocketEx) {
        if (wsEx.ex.plainUserInfo) {
            this.removeFromPlainUsers(wsEx);
        }
        this.popSocketFromUserLookUpMap(wsEx);
        for (const session of wsEx.ex.sessions) {
            this.refreshHasOpenedWebSocketsForUser(session.host, session.username);
            const hostContextIOC = await wsEx.ex.contextFactory(session.instanceHost);
            const statusManager = hostContextIOC.getUserStatusManager();
            await statusManager.decrementUserActiveSessions(session.instanceHost, session.username as unknown as types.core.EccPubKey, session.solution);
        }
    }
    
    addSession(wsEx: WebSocketEx, session: WebSocketSession) {
        wsEx.ex.sessions.push(session);
        this.pushToUserLookUpMap(wsEx, session.username);
        this.refreshHasOpenedWebSocketsForUser(session.host, session.username);
    }
    
    pushToUserLookUpMap(wsEx: WebSocketEx, username: types.core.Username) {
        const entry = this.userLookUpMap.get(username);
        if (!entry) {
            this.userLookUpMap.set(username, [wsEx]);
            return;
        }
        entry.push(wsEx);
    }
    
    popSocketFromUserLookUpMap(wsEx: WebSocketEx) {
        for (const session of wsEx.ex.sessions) {
            const entry = this.userLookUpMap.get(session.username);
            if (entry) {
                this.userLookUpMap.set(session.username, entry.filter(socket => socket !== wsEx));
            }
        }
    }
    
    popUserFromUserLookUpMap(wsEx: WebSocketEx, username: types.core.Username) {
        const entry = this.userLookUpMap.get(username);
        if (!entry) {
            return;
        }
        const foundSocket = entry.find(socket => socket === wsEx);
        if (!foundSocket) {
            return;
        }
        foundSocket.ex.sessions = foundSocket.ex.sessions.filter((s) => s.username !== username);
    }
    
    async removeSessionByWsId(wsEx: WebSocketEx, wsId: types.core.WsId) {
        const index = wsEx.ex.sessions.findIndex(x => x.wsId === wsId);
        if (index != -1) {
            const session = wsEx.ex.sessions[index];
            wsEx.ex.sessions.splice(index, 1);
            const hostContext = await wsEx.ex.contextFactory(session.host);
            await hostContext.getUserStatusManager().decrementUserActiveSessions(session.instanceHost, session.username as unknown as types.core.EccPubKey, session.solution);
            this.refreshHasOpenedWebSocketsForUser(session.host, session.username);
        }
    }
    
    subscribeToChannel(wsEx: WebSocketEx, wsId: types.core.WsId, channel: types.cloud.ChannelScheme) {
        const wsSession = wsEx.ex.sessions.find(x => x.wsId == wsId);
        if (!wsSession) {
            throw new AppException("WS_SESSION_DOES_NOT_EXISTS");
        }
        if (wsSession.channels.length >= this.config.maximumChannelsPerSession) {
            throw new AppException("TOO_MANY_CHANNELS_IN_SESSION");
        }
        wsSession.channels.push(channel);
    }
    
    unsubscribeFromChannels(wsEx: WebSocketEx, wsId: types.core.WsId, subscriptionIds: types.core.SubscriptionId[]) {
        const wsSession = wsEx.ex.sessions.find(x => x.wsId == wsId);
        if (!wsSession) {
            throw new AppException("WS_SESSION_DOES_NOT_EXISTS");
        }
        const removeSet = new Set(subscriptionIds);
        wsSession.channels =  wsSession.channels.filter(channel => !removeSet.has(channel.subscriptionId));
    }
    
    unsubscribeFromChannelsByOrgChannel(wsEx: WebSocketEx, wsId: types.core.WsId, orginalChannelPath: string) {
        const wsSession = wsEx.ex.sessions.find(x => x.wsId == wsId);
        if (!wsSession) {
            return;
        }
        wsSession.channels =  wsSession.channels.filter(channel => channel.orgChannel !== orginalChannelPath);
    }
    
    addToPlainUsers(wsEx: WebSocketEx) {
        if (!wsEx.ex.plainUserInfo) {
            this.logger.error("Tried to add user socket as plain");
            return;
        }
        const entry = this.plainUsersMap.get(wsEx.ex.plainUserInfo.connectionId);
        if (entry) {
            this.logger.error("Socket is already exists in map");
        }
        this.plainUsersMap.set(wsEx.ex.plainUserInfo.connectionId, wsEx);
    }
    
    removeFromPlainUsers(wsEx: WebSocketEx) {
        if (!wsEx.ex.plainUserInfo) {
            this.logger.error("Socket is not plain");
            return;
        }
        this.plainUsersMap.delete(wsEx.ex.plainUserInfo.connectionId);
    }
    
    private refreshHasOpenedWebSocketsForUser(_host: types.core.Host, _username: types.core.Username) {
        // Do nothing
    }
    
    private createShallowEventCopy<T extends string, D>(event: types.core.Event<T, D>, removeChannel?: boolean) {
        if (removeChannel && "channel" in event) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {channel, ...eventWithoutChannel } = event;
            return eventWithoutChannel;
        }
        return {...event};
    }
}
