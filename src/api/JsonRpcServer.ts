/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MethodInfo } from "../service/log/RequestLogger";
import { HttpUtils } from "../utils/HttpUtils";
import { AppException } from "./AppException";
import { EngineResponse } from "./server/Engine";
import * as http from "http";
import * as types from "../types";

export type JsonRpcId = number|string;

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: JsonRpcId;
    method: string;
    params: any;
    token?: types.auth.ApiAccessToken;
}

export type JsonRpcResponse = JsonRpcResponseSuccess | JsonRpcResponseError;

export interface JsonRpcResponseSuccess {
    jsonrpc: "2.0";
    id: JsonRpcId;
    result: any;
}

export interface JsonRpcResponseError {
    jsonrpc: "2.0";
    id: JsonRpcId;
    error: JsonRpcResponseErrorData;
}

export interface JsonRpcResponseErrorData {
    code: number;
    message: string;
    data?: any;
}

export interface Executor {
    execute(method: string, params: any, token?: types.auth.ApiAccessToken): Promise<any>;
}

export interface IEngine {
    setHeaders(res: EngineResponse, contentType: string): void;
}

export class JsonRpcServer {
    
    private id?: JsonRpcId;
    
    constructor(
        private executor: Executor,
        private methodInfo: MethodInfo,
        private engine: IEngine,
    ) {
    }
    
    async processRequest(request: http.IncomingMessage): Promise<EngineResponse> {
        return this.withEngine(async () => {
            if (request.headers["content-type"] !== "application/json") {
                throw new AppException("PARSE_ERROR", "Invalid Content-Type");
            }
            const jRpc = this.parseData(await HttpUtils.readBody(request));
            return this.process(jRpc);
        });
    }
    
    async processBuffer(body: Buffer): Promise<EngineResponse> {
        return this.withEngine(() => {
            const jRpc = this.parseData(body);
            return this.process(jRpc);
        });
    }
    
    async processBody(body: string) {
        const response = await this.with(() => {
            const jRpc = this.parseData(body);
            return this.process(jRpc);
        });
        return JSON.stringify(response);
    }
    
    private async withEngine(func: () => Promise<any>) {
        const response = await this.with(func);
        const res = {
            body: Buffer.from(JSON.stringify(response), "utf8"),
        };
        this.engine.setHeaders(res, "application/json");
        return res;
    }
    
    private async with(func: () => Promise<unknown>) {
        try {
            const result = await func();
            const response: JsonRpcResponseSuccess = {
                jsonrpc: "2.0",
                id: this.id as JsonRpcId,
                result: result,
            };
            this.reportSuccess(response);
            return response;
        }
        catch (e) {
            const error: JsonRpcResponseErrorData = e instanceof AppException ?
                {code: e.code, message: e.message, data: e.data} :
                {code: -32603, message: "Internal error"};
            const response: JsonRpcResponseError = {
                jsonrpc: "2.0",
                id: this.id as JsonRpcId,
                error: error,
            };
            this.reportError(e, response);
            return response;
        }
    }
    
    private parseData(body: Buffer|string) {
        try {
            return JSON.parse(typeof(body) === "string" ? body : body.toString("utf8"));
        }
        catch {
            throw new AppException("PARSE_ERROR");
        }
    }
    
    private async process(jRpc: any) {
        if (!this.isJsonRpcRequest(jRpc)) {
            throw new AppException("PARSE_ERROR");
        }
        this.id = jRpc.id;
        this.reportData(jRpc);
        return await this.executor.execute(jRpc.method, jRpc.params, jRpc.token);
    }
    
    private isJsonRpcRequest(x: any): x is JsonRpcRequest {
        return x && typeof(x) === "object" &&
            "jsonrpc" in x && x.jsonrpc === "2.0" &&
            "id" in x && (typeof(x.id) === "string" || typeof(x.id) === "number") &&
            "method" in x && typeof(x.method) === "string" &&
            "params" in x;
    }
    
    private reportData(jRpc: JsonRpcRequest) {
        this.methodInfo.frame = jRpc;
        this.methodInfo.user = "guest";
        this.methodInfo.method = jRpc.method;
        this.methodInfo.params = jRpc.params;
    }
    
    private reportSuccess(response: JsonRpcResponseSuccess) {
        this.methodInfo.success = true;
        this.methodInfo.response = response;
    }
    
    private reportError(error: any, response: JsonRpcResponseError) {
        this.methodInfo.success = false;
        this.methodInfo.error = error;
        this.methodInfo.response = response;
    }
}
