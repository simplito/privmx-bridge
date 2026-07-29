/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { UserApiValidator } from "./UserApiValidator";
import * as types from "../../../types";
import * as userApi from "./UserApiTypes";
import { SessionService } from "../../session/SessionService";
import { AppException } from "../../AppException";
import { Permission } from "../../Permission";
import { ApiMethod } from "../../Decorators";
import * as WebSocket from "ws";
import { WebSocketEx } from "../../../CommonTypes";
import { SessionCleaner } from "../../session/SessionCleaner";
import { BaseApi } from "../../BaseApi";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { WebSocketConnectionManager } from "../../../service/ws/WebSocketConnectionManager";

export class UserApi extends BaseApi implements userApi.IUserApi {
    
    constructor(
        userApiValidator: UserApiValidator,
        private sessionService: SessionService,
        private webSocket: WebSocket|null,
        private sessionCleaner: SessionCleaner,
        private webSocketConnectionManager: WebSocketConnectionManager,
        private repositoryFactory: RepositoryFactory,
    ) {
        super(userApiValidator);
    }
    
    private getSession() {
        return this.sessionService.getSessionUser();
    }
    
    @ApiMethod({})
    async ping(): Promise<"pong"> {
        return "pong";
    }
    
    @ApiMethod({})
    async authorizeWebSocket(model: {key: types.core.Base64, addWsChannelId: boolean}): Promise<{wsChannelId: types.core.WsChannelId}> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (!this.webSocket) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        const wsChannelId = await this.webSocketConnectionManager.authorizeWebSocket(
            this.getSession(), this.webSocket as WebSocketEx, !!model.addWsChannelId, model.key);
        return {wsChannelId: wsChannelId};
    }
    
    @ApiMethod({})
    async unauthorizeWebSocket(): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (!this.webSocket) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        await this.webSocketConnectionManager.unauthorizeWebSocket(this.getSession(), this.webSocket as WebSocketEx);
        return "OK";
    }
    
    @ApiMethod({})
    async subscribeToChannel(model: {channel: types.core.WsChannelName}): Promise<userApi.SubscribeToChannelResult> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (!this.webSocket) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        const subscriptionId = await this.webSocketConnectionManager.subscribeToChannelOld(this.getSession(), this.webSocket as WebSocketEx, model.channel);
        return {subscriptionId};
    }
    
    @ApiMethod({})
    async unsubscribeFromChannel(model: {channel: types.core.WsChannelName}): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (!this.webSocket) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        await this.webSocketConnectionManager.unsubscribeFromChannelOld(this.getSession(), this.webSocket as WebSocketEx, model.channel);
        return "OK";
    }
    
    @ApiMethod({})
    async subscribeToChannels(model: userApi.SubscribeToChannelsModel): Promise<userApi.SubscribeToChannelsResult> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (!this.webSocket) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        const subscriptionsIds = await this.webSocketConnectionManager.subscribeToChannels(this.getSession(), this.webSocket as WebSocketEx, model.channels);
        return {subscriptions: subscriptionsIds};
    }
    
    @ApiMethod({})
    async unsubscribeFromChannels(model: userApi.UnsubscribeFromChannelsModel): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (!this.webSocket) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        await this.webSocketConnectionManager.unsubscribeFromChannels(this.getSession(), this.webSocket as WebSocketEx, model.subscriptionsIds);
        return "OK";
    }
    
    @ApiMethod({})
    async logout(): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.SESSION_ESTABLISHED);
        const session = this.sessionService.getSession();
        if (session) {
            await this.repositoryFactory.withTransaction(async tr => {
                await this.sessionCleaner.destroySession(tr, session.id);
            });
        }
        return "OK";
    }
}
