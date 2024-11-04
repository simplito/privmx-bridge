import * as types from "../../types";
import { PsonHelperEx } from "../../utils/PsonHelperEx";
import { Subidentity } from "../login/UserLoginService";
import { AppException } from "../../api/AppException";
import { ExternalCommunicationService } from "../../cluster/worker/ExternalCommunicationService";

export class ExternalWebSocketService {
    
    private psonHelper = new PsonHelperEx([]);
    
    constructor(
        private externalCommunicationService: ExternalCommunicationService,
    ) {
    }
    
    async authorizeWebSocket(model: {
        connectionId: string;
        sessionId: types.core.SessionId;
        host: types.core.Host;
        wsId: types.core.WsId;
        addWsChannelId: boolean;
        username: types.core.Username;
        subidentity: Subidentity;
        proxy: types.core.Host;
        rights: types.user.UserRightsMap;
        type: types.user.SessionUserType;
        deviceId: types.core.DeviceId;
        encryptionKey: types.core.Base64;
    }): Promise<types.core.WsChannelId> {
        return this.request("authorizeWebSocket", model);
    }
    
    async unauthorizeWebSocket(model: {host: types.core.Host, connectionId: string, wsId: types.core.WsId}) {
        return this.request("unauthorizeWebSocket", model);
    }
    
    async subscribeToChannel(model: {host: types.core.Host, connectionId: string, wsId: types.core.WsId, channel: string}) {
        return this.request("subscribeToChannel", model);
    }
    
    async unsubscribeFromChannel(model: {host: types.core.Host, connectionId: string, wsId: types.core.WsId, channel: string}) {
        return this.request("unsubscribeFromChannel", model);
    }
    
    async sendNotification<T extends types.core.Event<any, any>>(model: {channel: string, host: types.core.Host, clients: types.core.Client[], event: T}): Promise<void> {
        return this.request("sendNotification", {...model, event: this.serializeEvent(model.event).toString("base64")});
    }
    
    async hasOpenConnectionWithUsername(model: {host: types.core.Host, username: types.core.Username}): Promise<boolean> {
        return this.request("hasOpenConnectionWithUsername", model);
    }
    
    async disconnectWebSocketsBySession(model: {host: types.core.Host, sessionId: types.core.SessionId}): Promise<void> {
        return this.request("disconnectWebSocketsBySession", model);
    }
    
    async disconnectWebSocketsByUsername(model: {host: types.core.Host, username: types.core.Username}): Promise<void> {
        return this.request("disconnectWebSocketsByUsername", model);
    }
    
    async disconnectWebSocketsBySubidentity(model: {host: types.core.Host, pub: types.core.EccPubKey}): Promise<void> {
        return this.request("disconnectWebSocketsBySubidentity", model);
    }
    
    async disconnectWebSocketsByDeviceId(model: {host: types.core.Host, deviceId: types.core.DeviceId}): Promise<void> {
        return this.request("disconnectWebSocketsByDeviceId", model);
    }
    
    async disconnectWebSocketsBySubidentityGroup(model: {host: types.core.Host, groupId: types.user.UsersGroupId}): Promise<void> {
        return this.request("disconnectWebSocketsBySubidentityGroup", model);
    }
    
    private async request<T>(method: string, params: unknown) {
        try {
            const res = <T>await this.externalCommunicationService.send(method, params);
            return res;
        }
        catch (e) {
            if (this.isExternalWebsocketErrorWithCode(e, 0x0073)) {
                throw new AppException("WEBSOCKET_ALREADY_AUTHORIZED");
            }
            if (this.isExternalWebsocketErrorWithCode(e, 0x0085)) {
                throw new AppException("EXCEEDED_LIMIT_OF_WEBSOCKET_CHANNELS");
            }
            if (this.isExternalWebsocketErrorWithCode(e, 0x0086)) {
                throw new AppException("ADD_WS_CHANNEL_ID_REQUIRED_ON_MULTI_CHANNEL_WEBSOCKET");
            }
            if (this.isExternalWebsocketErrorWithCode(e, 0x0087)) {
                throw new AppException("CANNOT_ADD_CHANNEL_TO_SINGLE_CHANNEL_WEBSOCKET");
            }
            throw e;
        }
    }
    
    private isExternalWebsocketErrorWithCode(e: unknown, code: number) {
        return (typeof e === "object" && e !== null && "code" in e && e.code === code);
    }

    private serializeEvent(event: any) {
        return this.psonHelper.pson_encode(event);
    }
}
