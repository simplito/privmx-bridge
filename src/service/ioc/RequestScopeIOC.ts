/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { RequestInfoHolder } from "../../api/session/RequestInfoHolder";
import { RequestLogger, MethodInfo } from "../log/RequestLogger";
import { Engine } from "../../api/server/Engine";
import { ApiEndpoint } from "../../api/ApiEndpoint";
import { ServerEndpoint } from "../../api/ServerEndpoint";
import { SessionHolder } from "../../api/session/SessionHolder";
import { KeyLoginService } from "../login/KeyLoginService";
import { SrpLoginService } from "../login/SrpLoginService";
import * as express from "express";
import { IOC } from "./IOC";
import { EcdheLoginService } from "../login/EcdheLoginService";
import { SessionLoginService } from "../login/SessionLoginService";
import { AuthorizationDetector } from "../auth/AuthorizationDetector";
import { AuthorizationHolder } from "../auth/AuthorizationHolder";
import { ApiController } from "../../controller/ApiController";
import { JsonRpcServer } from "../../api/JsonRpcServer";
import { WebSocketEx } from "../../CommonTypes";
import { AuthService } from "../auth/AuthService";
import { MetricsContainer } from "../../cluster/master/ipcServices/MetricsContainer";

export class RequestScopeIOC {
    
    protected engine?: Engine;
    protected apiEndpoint?: ApiEndpoint;
    protected serverEndpoint?: ServerEndpoint;
    protected sessionHolder?: SessionHolder;
    protected keyLoginService?: KeyLoginService;
    protected srpLoginService?: SrpLoginService;
    protected requestInfoHolder?: RequestInfoHolder;
    protected ecdheLoginService?: EcdheLoginService;
    protected sessionLoginService?: SessionLoginService;
    protected authorizationDetector?: AuthorizationDetector;
    protected authorizationHolder?: AuthorizationHolder;
    protected authService?: AuthService;
    protected metricsContainer?: MetricsContainer;
    
    constructor(
        public ioc: IOC,
        public request: express.Request|null,
        public response: express.Response|null,
        public webSocket: WebSocketEx|null,
        public requestLogger: RequestLogger,
    ) {
    }
    
    getRequestLogger() {
        return this.requestLogger;
    }
    
    getRequestInfoHolder() {
        if (this.requestInfoHolder == null) {
            this.requestInfoHolder = new RequestInfoHolder(
                this.ioc.getServerSessionService(),
            );
        }
        return this.requestInfoHolder;
    }
    
    createPlainJsonRpcServer(methodInfo: MethodInfo) {
        const engine = this.getEngine();
        return new JsonRpcServer(
            {execute: async (method, params, token) => {
                const ipAddress = this.getRequestInfoHolder().ip;
                if (ipAddress && !(await this.ioc.getIpRateLimiterClient().canPerformRequest(ipAddress))) {
                    return engine.rawResponse("Too many requests", "text/plain", 429);
                }
                if (token) {
                    this.getAuthorizationDetector().setTokenFromRequestPayload(token);
                }
                return this.ioc.getPlainApiResolver().execute(this, method, params);
            }},
            methodInfo,
            engine,
        );
    }
    
    createApiController() {
        return new ApiController(
            this.ioc.getConfigService(),
        );
    }
    
    getEngine() {
        if (this.engine == null) {
            this.engine = new Engine(this.ioc.getConfigService(), this.request);
        }
        return this.engine;
    }
    
    getApiEndpoint() {
        if (this.apiEndpoint == null) {
            this.apiEndpoint = new ApiEndpoint(
                this.getEngine(),
                this.request,
                this.getServerEndpoint(),
                this.getRequestInfoHolder(),
                this.ioc.getClientIpService(),
                this.ioc.getLoggerFactory().get(ApiEndpoint),
                this.ioc.getIpRateLimiterClient(),
            );
        }
        return this.apiEndpoint;
    }
    
    getSessionHolder() {
        if (this.sessionHolder == null) {
            this.sessionHolder = new SessionHolder(
                this.ioc.getSessionStorage(),
            );
        }
        return this.sessionHolder;
    }
    
    getSrpLoginService() {
        if (this.srpLoginService == null) {
            this.srpLoginService = new SrpLoginService(
                this.getSessionHolder(),
                this.ioc.getUserLoginService(),
                this.ioc.getCallbacks(),
                this.ioc.getSrpConfigService(),
                this.getRequestInfoHolder(),
                this.ioc.getLoginLogService(),
                this.ioc.getMaintenanceService(),
                this.ioc.getLoggerFactory().get(SrpLoginService),
            );
        }
        return this.srpLoginService;
    }
    
    getKeyLoginService() {
        if (this.keyLoginService == null) {
            this.keyLoginService = new KeyLoginService(
                this.getSessionHolder(),
                this.ioc.getUserLoginService(),
                this.ioc.getNonceService(),
                this.ioc.getCallbacks(),
                this.getRequestInfoHolder(),
                this.ioc.getLoggerFactory().get(KeyLoginService),
            );
        }
        return this.keyLoginService;
    }
    
    getEcdheLoginService() {
        if (this.ecdheLoginService == null) {
            this.ecdheLoginService = new EcdheLoginService(
                this.getSessionHolder(),
                this.ioc.getCallbacks(),
                this.ioc.getNonceService(),
                this.ioc.getRepositoryFactory(),
            );
        }
        return this.ecdheLoginService;
    }
    
    getSessionLoginService() {
        if (this.sessionLoginService == null) {
            this.sessionLoginService = new SessionLoginService(
                this.getSessionHolder(),
                this.ioc.getNonceService(),
                this.ioc.getLoggerFactory().get(SessionLoginService),
            );
        }
        return this.sessionLoginService;
    }
    
    getServerEndpoint() {
        if (this.serverEndpoint == null) {
            this.serverEndpoint = new ServerEndpoint(
                this.getRequestLogger(),
                this.getSrpLoginService(),
                this.ioc.getConfigService(),
                this.ioc.getTicketsDb(),
                this.getKeyLoginService(),
                this.ioc.getPacketValidator(),
                this.getSessionHolder(),
                this.ioc.getPkiFactory(),
                this.ioc.getCallbacks(),
                this.ioc.getMainApiResolver(),
                this,
                this.getRequestInfoHolder(),
                this.ioc.getMaintenanceService(),
                this.getEcdheLoginService(),
                this.getSessionLoginService(),
                this.ioc.getServerAgent(),
                this.ioc.getLoggerFactory().get(ServerEndpoint),
                this.ioc.getLoggerFactory(),
            );
        }
        return this.serverEndpoint;
    }
    
    getAuthorizationDetector() {
        if (!this.authorizationDetector) {
            this.authorizationDetector = new AuthorizationDetector(
                this.ioc.getRepositoryFactory(),
                this.ioc.getTokenEncryptionService(),
                this.ioc.workerRegistry.getSignatureVerificationService(),
                this.getAuthorizationHolder(),
                this.request,
                this.webSocket,
                this.getRequestInfoHolder(),
            );
        }
        return this.authorizationDetector;
    }
    
    getAuthorizationHolder() {
        if (!this.authorizationHolder) {
            this.authorizationHolder = new AuthorizationHolder();
        }
        return this.authorizationHolder;
    }
    
    getAuthService() {
        if (this.authService == null) {
            this.authService = new AuthService(
                this.ioc.getRepositoryFactory(),
                this.ioc.getConfigService(),
                this.ioc.getTokenEncryptionService(),
                this.ioc.getTokenEncryptionKeyProvider(),
                this.ioc.workerRegistry.getSignatureVerificationService(),
                this.webSocket,
            );
        }
        return this.authService;
    }
    
    getMetricsContainer() {
        return this.ioc.workerRegistry.getMetricsContainer();
    }
}
