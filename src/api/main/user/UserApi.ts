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
        private webSocket: WebSocket,
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
        if (this.webSocket == null) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        const wsChannelId = await this.webSocketConnectionManager.authorizeWebSocket(
            this.getSession(), this.webSocket as WebSocketEx, !!model.addWsChannelId, model.key);
        return {wsChannelId: wsChannelId};
    }
    
    @ApiMethod({})
    async unauthorizeWebSocket(): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (this.webSocket == null) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        await this.webSocketConnectionManager.unauthorizeWebSocket(this.getSession(), this.webSocket as WebSocketEx);
        return "OK";
    }
    
    @ApiMethod({})
    async subscribeToChannel(model: {channel: string}): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (this.webSocket == null) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        await this.webSocketConnectionManager.subscribeToChannel(this.getSession(), this.webSocket as WebSocketEx, model.channel);
        return "OK";
    }
    
    @ApiMethod({})
    async unsubscribeFromChannel(model: {channel: string}): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        if (this.webSocket == null) {
            throw new AppException("WEBSOCKET_REQUIRED");
        }
        await this.webSocketConnectionManager.unsubscribeFromChannel(this.getSession(), this.webSocket as WebSocketEx, model.channel);
        return "OK";
    }
    
    @ApiMethod({})
    async logout(): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.SESSION_ESTABLISHED);
        const session = this.sessionService.getSession();
        await this.repositoryFactory.withTransaction(async tr => {
            await this.sessionCleaner.destroySession(tr, session.id);
        });
        return "OK";
    }
}