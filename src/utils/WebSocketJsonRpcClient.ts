/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

// eslint-disable-next-line max-classes-per-file
import * as WebSocket from "ws";
import { PromiseUtils, Deferred } from "adv-promise";
import { JsonRpcRequest, JsonRpcResponse, JsonRpcResponseSuccess } from "../api/JsonRpcServer";
import { JsonRpcClient, JsonRpcException, JsonRpcRequestOptions } from "./JsonRpcClient";
import * as cloudTypes from "privmx-cloud-server-api";

export class WebSocketJsonRpcRequester {
    
    private lastId: number = 0;
    private requestMap: Map<string|number, {options: JsonRpcRequestOptions, defer: Deferred<unknown>}> = new Map();
    private notifications: cloudTypes.notification.Event[] = [];
    
    constructor(private socket: WebSocket) {
        socket.on("message", data => this.handleMessage(data));
    }

    async request<T>(method: string, params: unknown) {
        if (this.socket.readyState !== 1) {
            throw new Error("Websocket already in closing/closed state");
        }
        const id = this.lastId++;
        const defer = PromiseUtils.defer<T>();
        this.requestMap.set(id, {
            options: {
                method,
                params,
                url: this.socket.url,
            },
            defer,
        });
        const request: JsonRpcRequest = {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        this.socket.send(JSON.stringify(request));
        return defer.promise;
    }

    popAllNotifications() {
        const notifications = this.notifications;
        this.notifications = [];
        return notifications;
    }

    private handleMessage(data: WebSocket.Data) {
        const payload = this.getWebSocketDataAsString(data);
        const response = JSON.parse(payload);
        if (!JsonRpcClient.isJsonRpcResponse(response) || response.id === undefined) {
            if (this.isNotification(response)) {
                this.notifications.push(response);
            }
            return;
        }
        const deferAndOptions = this.requestMap.get(response.id);
        if (!deferAndOptions) {
            return;
        }
        const {defer, options} = deferAndOptions;
        this.requestMap.delete(response.id);

        if (this.isJsonRpcSuccessResponse(response)) {
            defer.resolve(response.result);
        }
        else {
            defer.reject(new JsonRpcException({type: "json-rpc", cause: response.error}, options, null));
        };
    }
    
    private isNotification(x: any): x is cloudTypes.notification.Event  {
        return x && typeof(x) === "object" && "type" in x && typeof(x.type) === "string" && "data" in x;
    }

    private isJsonRpcSuccessResponse(response: JsonRpcResponse): response is JsonRpcResponseSuccess {
        return "result" in response;
    }
    
    private getWebSocketDataAsString(data: WebSocket.Data): string {
        if (Array.isArray(data)) {
            return Buffer.concat(data).toString("utf8");
        }
        else if (data instanceof Buffer) {
            return data.toString("utf8");
        }
        else if (typeof data === "string") {
            return data;
        }
        else if (data instanceof DataView) {
            return Buffer.from(data.buffer).toString("utf8");
        }
        else {
            throw new Error("Unsupported WebSocket data type");
        }
    }
}

export class WebSocketClient {
    
    static connectToWs(url: string) {
        const ws = new WebSocket(url);
        const defer = PromiseUtils.defer<WebSocketJsonRpcRequester>();
        ws.on("open", () => {
            defer.resolve(new WebSocketJsonRpcRequester(ws));
        });
        ws.on("error", e => {
            defer.reject(e);
        });
        return defer.promise;
    }
}

