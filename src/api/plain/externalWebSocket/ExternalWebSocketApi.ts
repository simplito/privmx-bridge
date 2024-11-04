import { BaseApi } from "../../../api/BaseApi";
import * as externalWebSocketApi from "./ExternalWebSocketApiTypes";
import * as types from "../../../types";
import { ApiMethod } from "../../../api/Decorators";
import { ExternalWebSocketApiValidator } from "./ExternalWebSocketApiValidator";
import { WebSocketEx } from "../../../CommonTypes";
import { RequestScopeIOC } from "../../../service/ioc/RequestScopeIOC";
import { Base64 } from "../../../utils/Base64";
import * as express from "express";
import { AppException } from "../../../api/AppException";
import { Config } from "../../../cluster/common/ConfigUtils";

export class ExternalWebSocketApi extends BaseApi implements externalWebSocketApi.IExternalWebSocketApi {
    
    constructor(
        externalWebSocketApiValidator: ExternalWebSocketApiValidator,
        private request: express.Request,
        private config: Config,
        private ioc: RequestScopeIOC,
    ) {
        super(externalWebSocketApiValidator);
    }
    
    validateAccess() {
        if (!this.config.server.externalWs.enabled || this.request.get("X-Auth-Token") != this.config.server.externalWs.myApiKey) {
            throw new AppException("ACCESS_DENIED");
        }
    }
    
    @ApiMethod({})
    async process(model: externalWebSocketApi.ProcessModel): Promise<externalWebSocketApi.ProcessResult> {
        const buffer = Base64.toBuf(model.data);
        this.ioc.getRequestInfoHolder().setIP(model.ip);
        const websocket = {
            ex: {
                connectionId: model.connectionId,
                isAlive: true,
                sessions: []
            }
        } as unknown as WebSocketEx;
        this.ioc.webSocket = websocket;
        const data = await this.ioc.getServerEndpoint().execute(buffer);
        return {data: Base64.from(data)};
    }
    
    @ApiMethod({})
    async setUsersStatus(_model: externalWebSocketApi.SetUsersStatusModel): Promise<types.core.OK> {
        // do nothing
        return "OK";
    }
}
