/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as WebSocket from "ws";
import { PromiseUtils } from "./PromiseUtils";
import { Deferred } from "../CommonTypes";
import * as types from "../types";
import { DateUtils } from "./DateUtils";
import { Utils } from "./Utils";
import { Logger } from "../service/log/LoggerFactory";
import { JsonRpcId, JsonRpcResponse, JsonRpcRequest } from "../api/JsonRpcServer";

interface MapEntry {
    createDate: types.core.Timestamp;
    defer: Deferred<unknown>;
}

export class WebSocketClient {
    
    protected ws: WebSocket|null = null;
    private id = 1;
    private map = new Map<JsonRpcId, MapEntry>();
    private closed = false;
    
    constructor(
        protected config: {
            enabled: boolean,
            url: string,
            auth?: string,
        },
        private logger: Logger,
        private onNotificationCb: (data: unknown) => void,
    ) {
    }
    
    async connect(onOpen?: () => Promise<unknown>) {
        if (!this.config.enabled) {
            return;
        }
        if (this.ws) {
            return;
        }
        try {
            this.closed = false;
            this.ws = await WebSocketClient.connectWebsocket({
                url: this.config.url,
                connectTimeout: 5000,
                onClose: () => {
                    this.ws = null;
                    for (const x of this.map.values()) {
                        x.defer.reject({type: "disconnected", cause: "WebsocketChannel closed"});
                    }
                    this.map.clear();
                    if (!this.closed) {
                        this.logger.out("Wait 5s to reconnect WebSocket");
                        setTimeout(() => void this.connect(onOpen), 5000);
                    }
                },
                onMessage: (data) => {
                    const res = Utils.try(() => JSON.parse(typeof(data) === "string" ? data : Buffer.from(data as Buffer).toString("utf8")));
                    if (res.success === false) {
                        this.logger.error("Cannot decode ws message", data.toString(), res.error);
                        return;
                    }
                    const obj = res.result;
                    if (!this.isJsonRpcResponse(obj)) {
                        this.logger.error("Invalid json rpc response");
                        return;
                    }
                    if (obj.id === 0) {
                        if ("result" in obj) {
                            this.onNotificationCb(obj.result);
                        }
                        else {
                            this.logger.error("Get json rpc notification with error");
                        }
                    }
                    else {
                        const entry = this.map.get(obj.id);
                        if (!entry) {
                            this.logger.error(`Get response for not existing request id=${obj.id}`);
                            return;
                        }
                        this.map.delete(obj.id);
                        if ("result" in obj) {
                            entry.defer.resolve(obj.result);
                        }
                        else {
                            entry.defer.reject(obj.error);
                        }
                    }
                },
            }, this.logger);
            if (onOpen) {
                await onOpen();
            }
        }
        catch (e) {
            if (!this.closed) {
                this.logger.out("Wait 5s to reconnect WebSocket", e instanceof Error ? null : e);
                await PromiseUtils.wait(5000);
                void this.connect(onOpen);
            }
        }
    }
    
    async close() {
        this.closed = true;
        try {
            if (this.ws) {
                this.ws.close();
            }
        }
        catch (e) {
            this.logger.error("Error during closing ws", e);
        }
    }
    
    private isJsonRpcResponse(obj: any): obj is JsonRpcResponse {
        return typeof(obj) == "object" && obj != null && obj.jsonrpc == "2.0" && "id" in obj &&  (("result" in obj) || ("error" in obj));
    }
    
    async send<T = unknown>(method: string, params: unknown) {
        const ws = this.ws;
        if (!ws) {
            throw new Error("Weboscket not initliazed yet");
        }
        const id = this.id++;
        const defer = PromiseUtils.defer<T>();
        const req: JsonRpcRequest&{auth?: string} = {jsonrpc: "2.0", id: id, method: method, params: params, auth: this.config.auth};
        this.map.set(id, {createDate: DateUtils.now(), defer: defer as Deferred<unknown>});
        try {
            await PromiseUtils.callbackToPromiseVoid(cb => ws.send(Buffer.from(JSON.stringify(req), "utf8"), cb));
        }
        catch (e) {
            defer.reject(e);
            this.map.delete(id);
        }
        return defer.promise;
    }
    
    private static connectWebsocket(options: {
        url: string,
        onMessage: (msg: any) => void,
        onClose: () => void,
        connectTimeout: number,
    }, logger: Logger) {
        const defer = PromiseUtils.defer<WebSocket>();
        let disconnected = false;
        const connectionTid = setTimeout(() => {
            const errorMessage = "Websocket connection timeout: " + options.connectTimeout;
            logger.error(errorMessage);
            defer.reject({message: errorMessage});
        }, options.connectTimeout);
        const ws = new WebSocket(options.url);
        let pingIntervalId: NodeJS.Timeout|null = null;
        ws.addEventListener("open", () => {
            logger.out("Opened");
            clearTimeout(connectionTid);
            pingIntervalId = setInterval(() => {
                ws.ping(undefined, undefined, err => {
                    if (err) {
                        logger.error("Error during ws ping", err);
                    }
                });
            }, 5000);
            defer.resolve(ws);
        });
        ws.addEventListener("error", event => {
            const errorMessage = "Websocket error: " + this.formatEvent(event);
            logger.error("WebsocketError", errorMessage);
            if (!disconnected) {
                disconnected = true;
                clearTimeout(connectionTid);
                if (pingIntervalId != null) {
                    clearInterval(pingIntervalId);
                }
                defer.reject({message: errorMessage});
            }
        });
        ws.addEventListener("close", event => {
            const errorMessage = "Websocket closed: " + this.formatEvent(event);
            logger.error(errorMessage);
            if (!disconnected) {
                disconnected = true;
                if (pingIntervalId != null) {
                    clearInterval(pingIntervalId);
                }
                defer.reject({message: errorMessage});
                options.onClose();
            }
        });
        ws.addEventListener("message", evt => {
            options.onMessage(evt.data);
        });
        return defer.promise;
    }
    
    private static formatEvent(e: any) {
        try {
            if (!e || typeof(e) != "object") {
                return e;
            }
            const copy = {...e};
            if (e.target instanceof WebSocket) {
                copy.target = "<WebSocket>";
            }
            if (e.error && e.message == e.error.message) {
                copy.error = "<Error>";
            }
            return e.constructor.name + " " + JSON.stringify(copy);
        }
        catch {
            return "<UnserializableData>";
        }
    }
}
