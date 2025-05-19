/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as db from "../../db/Model";
import { IWorker2Service } from "../../cluster/common/Worker2Service";
import { ConfigService } from "../config/ConfigService";
import { JobService } from "../job/JobService";
import { WebSocketEx, WebSocketSession } from "../../CommonTypes";
import { WebSocketInnerManager } from "./WebSocketInnerManager";
import { AppException } from "../../api/AppException";
import { Base64 } from "../../utils/Base64";
import { Session } from "../../api/session/Session";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { Callbacks } from "../event/Callbacks";
import { Crypto } from "../../utils/crypto/Crypto";
import { Hex } from "../../utils/Hex";
import { ChannelScheme } from "../../types/cloud";
import { RepositoryFactory } from "../../db/RepositoryFactory";

export interface TargetChannel {
    contextId: types.context.ContextId;
    containerId?: string;
    itemId?: string;
    channel: types.core.WsChannelName
}

export interface WebSocketConnectionManager {
    authorizeWebSocket(session: Session, wsEx: WebSocketEx, addWsChannelId: boolean, key: types.core.Base64): Promise<types.core.WsChannelId>;
    unauthorizeWebSocket(session: Session, wsEx: WebSocketEx): Promise<void>;
    subscribeToChannels(session: Session, wsEx: WebSocketEx, channels: string[]): Promise<types.core.Subscription[]>;
    unsubscribeFromChannels(session: Session, wsEx: WebSocketEx, channels: string[]): Promise<void>;
    subscribeToChannelOld(session: Session, wsEx: WebSocketEx, channel: types.core.WsChannelName): Promise<types.core.SubscriptionId>;
    unsubscribeFromChannelOld(session: Session, wsEx: WebSocketEx, channel: types.core.WsChannelName): Promise<void>;
    hasOpenConnectionWithUsername(username: types.core.Username): Promise<boolean>;
    disconnectWebSocketsBySession(sessionId: types.core.SessionId): void;
    disconnectWebSocketsByUsername(username: types.core.Username): void;
    disconnectWebSocketsBySubidentity(pub: types.core.EccPubKey): void;
    disconnectWebSocketsByDeviceId(deviceId: types.core.DeviceId): void;
    disconnectWebSocketsBySubidentityGroup(groupId: types.user.UsersGroupId): void;
    sendAtChannel<T extends types.core.Event<any, any>>(channel: TargetChannel, clients: types.core.Client[]|null, event: T): void;
}

export class SimpleWebSocketConnectionManager implements WebSocketConnectionManager {
    
    constructor(
        private jobService: JobService,
        private workerService: IWorker2Service,
        private configService: ConfigService,
        private webSocketInnerManager: WebSocketInnerManager,
        private activeUsersMap: ActiveUsersMap,
        private callbacks: Callbacks,
        private host: types.core.Host,
        private repositoryFactory: RepositoryFactory,
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
            id: session.id,
            host: this.configService.values.domain as types.core.Host,
            wsId: wsId,
            wsChannelId: wsChannelId,
            addWsChannelId: addWsChannelId,
            username: session.get("username"),
            subidentity: session.get("subidentity"),
            solution: session.get("solution"),
            proxy: session.get("proxy"),
            rights: session.get("rights"),
            type: session.get("type"),
            deviceId: properties ? properties.deviceId : null,
            encryptionKey: Base64.toBuf(key),
            channels: [],
            instanceHost: this.host,
        });
        await this.activeUsersMap.setUserAsActive({host: this.host as types.core.Host, userPubkey: session.get("username") as unknown as types.core.EccPubKey, solutionId: session.get("solution")});
        this.callbacks.triggerZ("webSocketNewUserAuthorized", [session.get("username"), session.get("solution")]);
        return wsChannelId;
    }
    
    async unauthorizeWebSocket(session: Session, wsEx: WebSocketEx) {
        this.webSocketInnerManager.removeSessionByWsId(wsEx, session.getWsId());
    }
    
    async subscribeToChannels(session: Session, wsEx: WebSocketEx, channels: types.core.WsChannelName[]): Promise<types.core.Subscription[]> {
        const subscriptionsIds: types.core.Subscription[] = [];
        for (const channel of channels) {
            const subscriptionId = await this.subscribeToChannel(session, wsEx, channel, {version: 2});
            subscriptionsIds.push({subscriptionId: subscriptionId, channel});
        }
        return subscriptionsIds;
    }
    
    async subscribeToChannelOld(session: Session, wsEx: WebSocketEx, oldChannel: types.core.WsChannelName): Promise<types.core.SubscriptionId> {
        const channel = this.parseOldChannel(oldChannel);
        if (!channel) {
            throw new AppException("INVALID_PARAMS", "invalid channel construction");
        }
        return await this.subscribeToChannel(session, wsEx,  channel, {version: 1});
    }
    
    async unsubscribeFromChannelOld(session: Session, wsEx: WebSocketEx, oldChannel: types.core.WsChannelName): Promise<void> {
        const channel = this.parseOldChannel(oldChannel);
        if (!channel) {
            throw new AppException("INVALID_PARAMS", "invalid channel construction");
        }
        this.webSocketInnerManager.unsubscribeFromChannelsByOrgChannel(wsEx, session.getWsId(), channel);
    }
    
    private convertChannelToObject(channel: types.core.WsChannelName, version: number): types.cloud.ChannelScheme {
        const [path, scope] = channel.split("|");
        const scopeParts = scope ? scope.split("=") : ["none", "<none>"];
        if (scopeParts.length !== 2) {
            throw new AppException("INVALID_PARAMS");
        }
        const [limitedBy, id] = scopeParts;
        if (limitedBy !== "itemId" && limitedBy !== "containerId" && limitedBy !== "contextId" && limitedBy !== "none") {
            throw new AppException("INVALID_PARAMS", `invalid: ${scope}`);
        }
        const channelScheme: types.cloud.ChannelScheme = {
            subscriptionId: this.generateSubscriptionId(),
            orgChannel: channel,
            path: path,
            limitedBy,
            objectId: id,
            version,
        };
        return channelScheme;
    }
    
    async subscribeToChannel(session: Session, wsEx: WebSocketEx, channelModel: types.core.WsChannelName, options: {version: number}) {
        const channel = this.convertChannelToObject(channelModel, options.version);
        this.webSocketInnerManager.subscribeToChannel(wsEx, session.getWsId(), channel);
        await this.sendAwaitingUserNotifications(channel, session.get("username") as unknown as types.core.EccPubKey);
        return channel.subscriptionId;
    }
    
    async unsubscribeFromChannels(session: Session, wsEx: WebSocketEx, subscriptionIds: types.core.SubscriptionId[]) {
        this.webSocketInnerManager.unsubscribeFromChannels(wsEx, session.getWsId(), subscriptionIds);
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
    
    sendAtChannel<T extends types.core.Event<any, any>>(channel: TargetChannel, clients: types.core.Client[]|null, event: T) {
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
    
    private parseOldChannel(channel: types.core.WsChannelName): types.core.WsChannelName|null {
        const parts = channel.split("/");
        if (parts.length === 2) {
            return null;
        }
        if (parts.length === 1) {
            return parts[0] as types.core.WsChannelName;
        }
        
        const tool = parts[0];
        const id = parts[1];
        const channelName = parts.slice(2).join("/");
        return `${tool}/${channelName !== "messages" && channelName !== "files" && channelName !== "entries" ? "custom/" : ""}${channelName}|${tool === "context" ? "contextId" : "containerId"}=${id}` as types.core.WsChannelName;
    }
    
    private generateSubscriptionId() {
        return Hex.from(Crypto.randomBytes(12)) as unknown as types.core.SubscriptionId;
    }
    
    private async sendAwaitingUserNotifications(channel: ChannelScheme, userPubKey: types.core.EccPubKey) {
        const notifications = await this.popRemainingUserNotifiactions(channel, userPubKey);
        for (const notifiaction of notifications) {
            this.sendAtChannel(notifiaction.channel, [notifiaction.userPubKey], notifiaction.event);
        }
    }
    
    private async popRemainingUserNotifiactions(channel: ChannelScheme, userPubKey: types.core.EccPubKey) {
        return await this.repositoryFactory.withTransaction(async session => {
            const notifications = await this.repositoryFactory.createNotificationRepository(session).getAwaitingUserNotifications(channel, userPubKey);
            await this.repositoryFactory.createNotificationRepository().deleteMany(notifications.map(notification => notification._id as unknown as db.notification.NotificationId));
            return notifications;
        });
    }
}
