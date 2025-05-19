/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as http from "http";
import * as types from "../../types";
import { WebSocketEx } from "../../CommonTypes";
import { Config } from "../common/ConfigUtils";
import { WebSocketInnerManager } from "../../service/ws/WebSocketInnerManager";
import { Logger, LoggerFactory } from "../../service/log/LoggerFactory";
import { Hex } from "../../utils/Hex";
import { Crypto } from "../../utils/crypto/Crypto";
import { WorkerRegistry } from "./WorkerRegistry";
import { App } from "../../service/app/App";
import { IOC } from "../../service/ioc/IOC";
import { ConfigRepository } from "../../service/config/ConfigRepository";

// eslint-disable-next-line
const WebSocketStatusCodeSymbol = require("ws/lib/constants").kStatusCode;

export type Interceptor = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void;

export interface HostContextProvider {
    createHostContext(req: http.IncomingMessage): Promise<IOC>;
    createContextWithHost(host: types.core.Host): Promise<IOC>;
}
export class HttpHandler {
    
    private interceptors: Interceptor[] = [];
    private singleMode?: Promise<App>;
    private hostContextProvider: HostContextProvider = {
        createHostContext: () => this.createHostContext(),
        createContextWithHost: () => this.createHostContext(),
    };
    
    constructor(
        private config: Config,
        private webSocketInnerManager: WebSocketInnerManager,
        private logger: Logger,
        private workerRegistry: WorkerRegistry,
        private configRepository: ConfigRepository,
    ) {
        this.addInterceptor((req, res, next) => {
            if (req.url === "/health" || req.url === "/ready") {
                void this.onStatusRequest(req, res);
            }
            else {
                next();
            }
        });
    }
    
    setHostContextProvider(hostContextProvider: HostContextProvider) {
        this.hostContextProvider = hostContextProvider;
    }
    
    addInterceptor(interceptor: Interceptor) {
        this.interceptors.push(interceptor);
    }
    
    onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        let i = 0;
        const callInterceptor = () => {
            if (i < this.interceptors.length) {
                const interceptor = this.interceptors[i];
                interceptor(req, res, () => {
                    i++;
                    callInterceptor();
                });
            }
            else {
                this.onRequestCore(req, res);
            }
        };
        callInterceptor();
    }
    
    private onRequestCore(req: http.IncomingMessage, res: http.ServerResponse) {
        void (async () => {
            try {
                const hostContext = await this.hostContextProvider.createHostContext(req);
                hostContext.getHttpHandler().onRequest(req, res);
            }
            catch (e) {
                if (typeof(e) === "string" && e.startsWith("Error: Unsupported host")) {
                    if (req.url === "/") {
                        res.statusCode = 200;
                        res.setHeader("Content-Type", "text/plain");
                        res.write("PrivMX Server - given host is not supported");
                        res.end();
                    }
                    else {
                        res.statusCode = 404;
                        res.setHeader("Content-Type", "text/plain");
                        res.write("404 Not found - given host is not supported");
                        res.end();
                    }
                }
                else {
                    this.logger.error("Error during processing request", e);
                    res.statusCode = 500;
                    res.setHeader("Content-Type", "text/plain");
                    res.write("500 Internal server error");
                    res.end();
                }
            }
        })();
    }
    
    async createHostContext() {
        if (this.config.server.mode.type !== "single") {
            throw new Error("Cannot create context for non single mode");
        }
        if (this.singleMode === undefined) {
            const configPath = this.config.server.mode.configPath;
            this.singleMode = (async () => {
                const host = "<main>" as types.core.Host;
                const ioc = new IOC(host, this.workerRegistry, new LoggerFactory(host, this.workerRegistry.getLoggerFactory().getAppender()));
                const app = App.initWithIocAndConfigFile(ioc, configPath);
                const info = await this.configRepository.getInfo(ioc.getConfigService().values.db.mongo.dbName);
                await app.init4(info);
                return app;
            })();
            return (await this.singleMode).ioc;
        }
        else {
            const app = await this.singleMode;
            void app.tryRunJobs();
            return app.ioc;
        }
    }
    
    async createContextWithHost(host: types.core.Host) {
        return this.hostContextProvider.createContextWithHost(host);
    }
    
    onWebSocketConnection(ws: WebSocketEx, req: http.IncomingMessage) {
        const url = req.url || "/";
        this.logger.out("Web socket connected");
        ws.ex = {
            isAlive: true,
            sessions: [],
            plainUserInfo: url.endsWith("/api") ? {
                plainApiChannels: new Map(),
                connectionId: this.generateWsConnectionId(),
            } : undefined,
        };
        ws.on("pong", () => {
            ws.ex.isAlive = true;
        });
        const contextPromise = (async () => {
            try {
                const hostContext = await this.hostContextProvider.createHostContext(req);
                const ip = hostContext.getClientIpService().getClientIp(req);
                return {hostContext, ip};
            }
            catch (e) {
                this.logger.error("Error during processing websocket connection", e);
                ws.close();
                return {};
            }
        })();
        ws.on("message", message => {
            ws.ex.isAlive = true;
            if (url.endsWith("/api")) {
                void (async () => {
                    const {hostContext, ip} = await contextPromise;
                    if (hostContext) {
                        await hostContext.getPrivmxExpressApp().onWebSocketApiMessage({webSocket: ws, ip: ip}, message);
                    }
                })();
                return;
            }
            if (!Buffer.isBuffer(message)) {
                this.logger.error("[Error] Websocket error: not binary message");
                return;
            }
            void (async () => {
                const {hostContext, ip} = await contextPromise;
                if (hostContext) {
                    await hostContext.getPrivmxExpressApp().onWebSocketApiv2Message({webSocket: ws, ip: ip}, message);
                }
            })();
        });
        ws.on("error", e => {
            if (e && e instanceof Error && (<any>e)[WebSocketStatusCodeSymbol] && typeof((<any>e).code) == "string" && (<any>e).code.startsWith("WS_ERR_")) {
                this.logger.error("[Error] " + e.message + " " + (<any>e).code + " " + (<any>e)[WebSocketStatusCodeSymbol]);
            }
            else {
                this.logger.error("[Error] Websocket unknown error:", e);
            }
        });
        ws.on("close", () => {
            this.webSocketInnerManager.onClose(ws);
        });
    }
    
    async onStatusRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        try {
            if (req.url === "/health" || req.url === "/ready") {
                res.writeHead(200, {}).end(JSON.stringify({status: "ok"}));
            }
            else {
                res.writeHead(404, {}).end("404 Not found");
            }
        }
        catch (e) {
            this.logger.error("Error during processing request", req.url, e);
            res.writeHead(500);
            res.end("500 Internal server error");
        }
    }
    
    private generateWsConnectionId() {
        return Hex.from(Crypto.randomBytes(32)) as string as types.core.WsConnectionId;
    }
}
