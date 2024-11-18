/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as express from "express";
import { EngineResponse } from "../../api/server/Engine";
import { Logger } from "../log/LoggerFactory";
import * as http from "http";
import * as https from "https";
import * as WebSocket from "ws";
import { ConfigService } from "../config/ConfigService";
import { Callbacks } from "../event/Callbacks";
import { RequestContextFactory, WebSocketInfo } from "../../api/RequestContextFactory";
import { RequestContext } from "../../api/RequestContext";
import { ExpressUtils } from "./ExpressUtils";
import * as compression from "compression";
import { URL } from "url";
import { Dumper } from "../../utils/Dumper";
import { Config } from "../../cluster/common/ConfigUtils";
import { RequestLogger } from "../log/RequestLogger";
import { HttpUtils } from "../../utils/HttpUtils";

export interface ServerBinding {
    server: http.Server|https.Server;
    wss: WebSocket.Server;
}

export interface WebSocketResult<T = Buffer|string> {
    data: T;
    log: boolean;
}

export class PrivmxExpressApp {
    
    public expressApp: express.Application;
    
    constructor(
        private configService: ConfigService,
        private config: Config,
        private callbacks: Callbacks,
        private requestContextFactory: RequestContextFactory,
        private logger: Logger,
    ) {
        this.expressApp = express();
    }
    
    registerRoutes() {
        this.expressApp.disable("x-powered-by");
        this.expressApp.use((req, _res, next) => {
            HttpUtils.readBody(req).then(body => {
                req.body = body;
                next();
            }).catch(e => next(e));
        });
        
        this.expressApp.use((req, res, next) => {
            if (req.method === "OPTIONS") {
                this.applyResponse(this.requestContextFactory.createForRequest("raw", req, res).ioc.getEngine().optionsResponse(), res);
            }
            else {
                next();
            }
        });
        this.expressApp.use((_req, res, next) => {
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
            next();
        });

        const compressionMiddleware = compression();
        for (const entry of this.configService.values.server.compressedPaths) {
            this.expressApp.use(entry, compressionMiddleware);
        }
        
        this.expressApp.get("/privmx-configuration.json", (req, res) => {
            this.applyResponse(this.requestContextFactory.createForRequest("raw", req, res).ioc.getEngine().jsonResponse({
                defaultEndpoint: "//" + this.configService.values.domain
            }), res);
        });
        
        this.expressApp.get("/privmx/privmx-configuration.json", (req, res) => {
            this.applyResponse(this.requestContextFactory.createForRequest("raw", req, res).ioc.getEngine().jsonResponse({
                defaultEndpoint: "//" + this.configService.values.domain
            }), res);
        });

        this.expressApp.get("/metrics", (req, res) => {
            return this.onRequest("metrics", req, res, async (context): Promise<EngineResponse> => {
                if (!this.config.metrics.enabled) {
                    return {code: 404, body: "Not found"}
                }
                if (!req.headers.authorization || !this.checkMetricsBasicAuthorization(req.headers.authorization)) {
                    return {code: 401, body: "Unauthorized", headers: {"WWW-Authenticate": 'Basic realm="Access to metrics"'}};
                }
                return {code: 200, body: await context.ioc.getMetricsContainer().getMetrics(), headers: {"Content-type": "text/plain"}};
            });
        })
        
        this.expressApp.get("/healthcheck", (_req, res) => {
            this.applyResponse({body: JSON.stringify({status: "ok"})}, res);
        });
        
        this.expressApp.get("/health", (_req, res) => {
            this.applyResponse({body: JSON.stringify({status: "ok"})}, res);
        });
        
        this.expressApp.get("/ready", (_req, res) => {
            this.applyResponse({body: JSON.stringify({status: "ok"})}, res);
        });
        
        this.expressApp.post("/api", (req, res) => {
            this.onApiRequest(req, res);
        });
        
        this.expressApp.post("/api/v2.0", (req, res) => {
            this.onApi2Request(req, res);
        });
        
        this.expressApp.get("/api/tester", (req, res) => {
            return this.onRequest("api-tester", req, res, context => {
                return context.ioc.createApiController().testApi();
            });
        });
        
        for (const entry of this.configService.values.server.staticDirs) {
            this.expressApp.use(entry.url, express.static(entry.path, {dotfiles: "allow"}));
        }
        
        this.callbacks.triggerZ("registerRoutes", []);
        
        this.expressApp.get("/", (_req, res, next) => {
            if (this.config.server.mainPageRedirect) {
                this.applyResponse({
                    code: 301,
                    headers: {
                        "Location": this.config.server.mainPageRedirect,
                    },
                }, res);
            }
            else {
                next();
            }
        });
        
        if (this.configService.values.server.fallbackHtml) {
            this.expressApp.use((req, res, next) => this.safelyProcessRequest(req, res, async () => {
                if (!this.configService.values.server.fallbackHtml) {
                    return next();
                }
                const reqUrl = new URL("http://localhost" + req.url);
                const pathParts = reqUrl.pathname.split("/").filter(x => !!x);
                const lastPathPart = pathParts[pathParts.length - 1];
                if (lastPathPart && lastPathPart.includes(".")) {
                    return next();
                }
                this.applyResponse(await ExpressUtils.download(req, res, this.logger, null, this.configService.values.server.fallbackHtml, "index from fallback", "text/html"), res);
            }));
        }
        this.expressApp.use("/", express.static(this.configService.values.assetsDir));
    }
    
    getExpress() {
        return express;
    }
    
    onRequest(requestType: string, req: express.Request, res: express.Response, func: (context: RequestContext) => Promise<EngineResponse>) {
        this.safelyProcessRequest(req, res, async () => {
            const context = this.requestContextFactory.createForRequest(requestType, req, res);
            try {
                const eRes = await func(context);
                this.applyResponse(eRes, res);
            }
            catch (e) {
                context.setMainException(e);
                this.applyResponse({code: 500}, res);
            }
            finally {
                context.flush();
            }
        });
    }
    
    safelyProcessRequest(req: express.Request, res: express.Response, func: () => Promise<void>|void) {
        void (async () => {
            try {
                await func();
            }
            catch (e) {
                this.logger.error("Critical error during processing request", req.url, e);
                this.applyResponse({code: 500}, res);
            }
        })();
    }
    
    applyResponse(eRes: EngineResponse, res: express.Response) {
        if (eRes.done) {
            return;
        }
        if (eRes.code) {
            res.status(eRes.code);
        }
        if (eRes.headers) {
            for (const hName in eRes.headers) {
                res.setHeader(hName, eRes.headers[hName]);
            }
        }
        if (eRes.body) {
            res.send(eRes.body);
            if (res.req && (res.req as any).requestLogger) {
                ((res.req as any).requestLogger as RequestLogger).setResponsSize(eRes.body.length);
            }
        }
        else {
            res.send("");
        }
    }
    
    async onWebSocketMessage(requestType: string, webSocketInfo: WebSocketInfo, message: WebSocket.Data, func: (context: RequestContext) => Promise<WebSocketResult>) {
        const context = this.requestContextFactory.createForWebSocket(requestType, webSocketInfo);
        if (Buffer.isBuffer(message)) {
            context.ioc.getRequestLogger().setRequestSize(message.length);
        }
        try {
            const res = await func(context);
            context.setLogging(res.log);
            webSocketInfo.webSocket.send(res.data);
            context.ioc.getRequestLogger().setResponsSize(res.data.length);
        }
        catch (e) {
            context.setMainException(e);
        }
        finally {
            context.flush();
        }
    }
    
    onApiRequest(req: express.Request, res: express.Response) {
        return this.onRequest("api", req, res, context => {
            return context.runWith(methodInfo => {
                return context.ioc.createPlainJsonRpcServer(methodInfo).processBuffer(req.body);
            });
        });
    }
    
    onApi2Request(req: express.Request, res: express.Response) {
        return this.onRequest("api2", req, res, async context => {
            const endpoint = context.ioc.getApiEndpoint();
            const result = await endpoint.v2_0();
            this.dumpDeps(context.ioc);
            return result;
        });
    }
    
    private dumpDeps(obj: any) {
        if (this.configService.values.misc.dumpDepsDir) {
            Dumper.dumpDependencies(obj, this.configService.values.misc.dumpDepsDir);
        }
    }
    
    async withApiV2(message: WebSocket.Data, func: (data: Buffer) => Promise<Buffer>): Promise<WebSocketResult<Buffer>> {
        const msg = <Buffer>message;
        const idBuf = msg.slice(0, 4);
        const data = msg.slice(4);
        const res = await this.executeApiV2(data, func);
        return {data: Buffer.concat([idBuf, res.data]), log: res.log};
    }
    
    async executeApiV2(data: Buffer, func: (data: Buffer) => Promise<Buffer>): Promise<WebSocketResult<Buffer>> {
        if (data.length == 4 && data.toString() == "ping") {
            return {data: Buffer.from("pong", "utf8"), log: false};
        }
        const res = await func(data);
        return {data: res, log: true};
    }
    
    async onWebSocketApiv2Message(webSocketInfo: WebSocketInfo, message: WebSocket.Data) {
        return this.onWebSocketMessage("apiv2ws", webSocketInfo, message, context => {
            return this.withApiV2(message, async data => {
                const endpoint = context.ioc.getServerEndpoint();
                const result = await endpoint.execute(data);
                this.dumpDeps(context.ioc);
                return result;
            });
        });
    }
    
    async onWebSocketApiMessage(webSocketInfo: WebSocketInfo, message: WebSocket.Data) {
        return this.onWebSocketMessage("apiws", webSocketInfo, message, context => context.runWith(async methodInfo => {
            const result = await context.ioc.createPlainJsonRpcServer(methodInfo).processBody(this.wsDataToString(message));
            return {data: result, log: true};
        }));
    }
    
    private wsDataToString(message: WebSocket.Data) {
        if (typeof(message) === "string") {
            return message;
        }
        if (Array.isArray(message)) {
            return Buffer.concat(message).toString("utf8");
        }
        return Buffer.from(message).toString("utf8");
    }

    private checkMetricsBasicAuthorization(authorizationHeader: string) {
        const credentials = this.parseAuthorizationHeader(authorizationHeader);
        return credentials && credentials.user === this.config.metrics.username && credentials.password === this.config.metrics.password;
    }
    
    private parseAuthorizationHeader(authorizationHeader: string) {
        const parts = authorizationHeader.split(" ");
        if (parts.length !== 2 || parts[0] !== "Basic") {
            return null;
        }
        const credentials = atob(parts[1]).split(":");
        if (credentials.length != 2) {
            return null;
        }
        return {user: credentials[0], password: credentials[1]};
    }
}