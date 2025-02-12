/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */

import { JsonRpcResponse, JsonRpcRequest, JsonRpcResponseErrorData } from "../api/JsonRpcServer";
import { Result } from "../CommonTypes";
import { RequestHeaders } from "./ClientSignatureClient";
import { FetchResponse, HttpClient2 } from "./HttpClient2";
import { Utils } from "./Utils";

export interface JsonRpcRequestOptions {
    url: string;
    method: string;
    params: unknown;
    headers?: {[name: string]: string|string[]};
}
export interface JsonRpcRequestWithSessionOptions {
    method: string;
    params: unknown;
    headers?: {[name: string]: string|string[]};
}

export class JsonRpcClientWithSession {
    
    private cookies: {[name: string]: string} = {};
    
    constructor(
        private url: string,
        private headers: RequestHeaders,
    ) {
    }
    
    async request<T = unknown>(method: string, params: unknown) {
        const response = await this.requestFull<T>(method, params);
        return response.result;
    }
    
    async requestFull<T = unknown>(method: string, params: unknown) {
        const cookie = this.getCookies();
        const response = await JsonRpcClient.requestFull<T>({
            method: method,
            headers: {...this.headers, cookie},
            params: params,
            url: this.url,
        });
        const cookieHeader = response.headers["set-cookie"];
        if (cookieHeader) {
            this.updateCookies(cookieHeader);
        }
        return response;
    }
    
    getCookies() {
        const cookie: string[] = [];
        for (const cookieName in this.cookies) {
            cookie.push(cookieName + "=" + this.cookies[cookieName]);
        }
        return cookie;
    }
    
    private updateCookies(headerCookies: string[]) {
        for (const header of headerCookies) {
            const cookieName = header.substring(0, header.indexOf("="));
            const cookieValue = header.substring(header.indexOf("=") + 1);
            this.cookies[cookieName] = cookieValue;
        }
    }
}

export class JsonRpcClient {
    
    constructor(
        private url: string,
        private headers: {[name: string]: string},
    ) {
    }
    
    async request<T = unknown>(method: string, params: unknown) {
        return JsonRpcClient.request<T>({url: this.url, method, params, headers: this.headers});
    }
    
    async requestFull<T = unknown>(method: string, params: unknown) {
        return JsonRpcClient.requestFull<T>({url: this.url, method, params, headers: this.headers});
    }
    
    setHeader(header: string, value: string|undefined) {
        if (value === undefined) {
            delete this.headers[header];
        }
        else {
            this.headers[header] = value;
        }
    }
    
    static async requestFull<T = unknown>(options: JsonRpcRequestOptions) {
        const body = JsonRpcClient.createJsonRpcRequestBody(options.method, options.params);
        const requestResult = await Utils.tryPromise(() => HttpClient2.req({
            method: "POST",
            url: options.url,
            body: body,
            headers: {
                ...(options.headers || {}),
                "Content-Type": "application/json",
            },
        }));
        return JsonRpcClient.processHttpResponse<T>(requestResult, options);
    }
    
    static async request<T = unknown>(options: JsonRpcRequestOptions) {
        const payload = await this.requestFull<T>(options);
        return payload.result;
    }
    
    static isJsonRpcResponse(x: any): x is JsonRpcResponse {
        return x && typeof(x) === "object" &&
            "jsonrpc" in x && x.jsonrpc === "2.0" &&
            "id" in x && (typeof(x.id) === "string" || typeof(x.id) === "number") &&
            ("result" in x || ("error" in x && typeof(x.error) === "object" && "code" in x.error && "message" in x.error && typeof(x.error.code) === "number" && typeof(x.error.message) === "string"));
    }
    
    static createJsonRpcRequestBody(method: string, params: unknown, id?: string|number) {
        const jsonRpcRequest: JsonRpcRequest = {
            jsonrpc: "2.0",
            id: typeof(id) === "undefined" ? 1 : id,
            method: method,
            params: params,
        };
        return Buffer.from(JSON.stringify(jsonRpcRequest), "utf8");
    }
    
    static async processHttpResponse<T = unknown>(requestResult: Result<FetchResponse>, options: JsonRpcRequestOptions) {
        if (requestResult.success === false) {
            throw new JsonRpcException({type: "connection", cause: requestResult.error}, options, null);
        }
        if (requestResult.result.response.statusCode !== 200) {
            throw new JsonRpcException({type: "connection", cause: `Invalid status code ${requestResult.result.response.statusCode}`}, options, requestResult.result);
        }
        const parseResult = await Utils.tryPromise(async () => {
            return requestResult.result.readBody();
        });
        if (parseResult.success === false) {
            throw new JsonRpcException({type: "parse", cause: parseResult.error}, options, requestResult.result);
        }
        const parsedPayload = Utils.try(() => {
            return JSON.parse(parseResult.result.toString());
        });
        if (parsedPayload.success === false) {
            throw new JsonRpcException({type: "parse", cause: parsedPayload.error}, options, requestResult.result);
        }
        const payload = parsedPayload.result;
        if (!JsonRpcClient.isJsonRpcResponse(payload)) {
            throw new JsonRpcException({type: "parse", cause: "Invalid JSON-RPC response"}, options, requestResult.result);
        }
        if ("error" in payload) {
            throw new JsonRpcException({type: "json-rpc", cause: payload.error}, options, requestResult.result);
        }
        return {
            result: payload.result as T,
            headers: requestResult.result.response.headers,
        };
    }
}

export type JsonRpcErrorData = {type: "connection", cause: unknown}|{type: "parse", cause: unknown}|{type: "json-rpc", cause: JsonRpcResponseErrorData};

export class JsonRpcException extends Error {
    
    constructor(private data: JsonRpcErrorData, private options: JsonRpcRequestOptions, private response: FetchResponse|null) {
        super(JsonRpcException.getErrorMessage(options, data));
        this.options = JsonRpcException.filterSecrects(options);
    }
    
    getData() {
        return this.data;
    }
    
    getOptions() {
        return this.options;
    }
    
    getResponse() {
        return this.response?.response;
    }
    
    static isJsonRpcError(e: unknown, code: number) {
        return e instanceof JsonRpcException && e.data.type === "json-rpc" && e.data.cause.code === code;
    }
    
    static getJsonRpcError(e: unknown) {
        return e instanceof JsonRpcException && e.data.type === "json-rpc" ? e.data.cause : null;
    }
    
    private static getErrorMessage(options: JsonRpcRequestOptions, data: JsonRpcErrorData) {
        const prefix = `JsonRpcRequest ${options.method} to ${options.url}. `;
        if (data.type === "connection") {
            return prefix + "Error during connecting. " + JSON.stringify(data.cause, null, 2);
        }
        if (data.type === "parse") {
            return prefix + "Error during parsing. " + JSON.stringify(data.cause, null, 2);
        }
        if (data.type === "json-rpc") {
            return prefix + `Error (${data.cause.code}) ${data.cause.message}`;
        }
        return prefix;
    }
    
    private static filterSecrects(options: JsonRpcRequestOptions) {
        const restrictedWords = ["secret", "auth", "token"];
        const res: JsonRpcRequestOptions = {...options};
        if (options.headers) {
            res.headers = {};
            for (const header in options.headers) {
                const headerName = header.toLowerCase();
                res.headers[header] = restrictedWords.some(x => headerName.includes(x)) ? options.headers[header][0] + "......" : options.headers[header];
            }
        }
        return res;
    }
}
