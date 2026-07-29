/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as express from "express";
import { IOC } from "../service/ioc/IOC";
import { RequestScopeIOC } from "../service/ioc/RequestScopeIOC";
import { RequestLogger } from "../service/log/RequestLogger";
import { ServerStatsService } from "../service/misc/ServerStatsService";
import { RequestContext } from "./RequestContext";
import * as types from "../types";
import { LoggerFactory } from "../service/log/LoggerFactory";
import { WebSocketEx } from "../CommonTypes";
import { MetricsContainer } from "../cluster/master/ipcServices/MetricsContainer";
import { Config } from "../cluster/common/ConfigUtils";

export interface WebSocketInfo {
    webSocket: WebSocketEx;
    ip: types.core.IPAddress;
}

export class RequestContextFactory {
    
    constructor(
        private serverStatsService: ServerStatsService,
        private ioc: IOC,
        private loggerFactory: LoggerFactory,
        private metricsContainer: MetricsContainer,
        private config: Config,
    ) {
    }
    
    createForRequest(requestType: string, request: express.Request, response: express.Response) {
        const requestLogger = new RequestLogger(requestType, this.serverStatsService, this.loggerFactory.createLogger(RequestLogger, this.ioc.getInstanceHost()), this.metricsContainer, this.config);
        if (Buffer.isBuffer(request.body)) {
            requestLogger.setRequestSize(request.body.length);
        }
        const ioc = new RequestScopeIOC(this.ioc, request, response, null, requestLogger);
        (request as any).ioc = ioc;
        (request as any).requestLogger = requestLogger;
        ioc.getRequestInfoHolder().setIP(this.ioc.getClientIpService().getClientIp(request));
        return new RequestContext(ioc);
    }
    
    createForWebSocket(requestType: string, webSocketInfo: WebSocketInfo) {
        const requestLogger = new RequestLogger(requestType, this.serverStatsService, this.loggerFactory.createLogger(RequestLogger, this.ioc.getInstanceHost()), this.metricsContainer, this.config);
        const ioc = new RequestScopeIOC(this.ioc, null, null, webSocketInfo.webSocket, requestLogger);
        ioc.getRequestInfoHolder().setIP(webSocketInfo.ip);
        return new RequestContext(ioc);
    }
}