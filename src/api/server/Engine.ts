/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ConfigService } from "../../service/config/ConfigService";
import { ERROR_CODES } from "../AppException";
import * as express from "express";
import * as types from "../../types";

export interface EngineResponse {
    code?: number;
    body?: string|Buffer|null;
    headers?: {[name: string]: string};
    done?: boolean;
}

export class Engine {
    
    constructor(
        private configService: ConfigService,
        private request: express.Request|null,
    ) {
    }
    
    addCrossDomainHeaders(response: EngineResponse, addCache: boolean): void {
        if (this.configService.values.server.cors.enabled) {
            if (!this.request) {
                throw new Error("Cannot set headers when request is null");
            }
            const domains = this.configService.values.server.cors.domains;
            const origin = (this.request.header("Origin") || "*") as types.core.Host;
            if (domains.includes("*" as types.core.Host) || domains.includes(origin) || this.configService.hostIsMyself(origin)) {
                response.headers = response.headers || {};
                response.headers.Allow = "OPTIONS,GET,POST";
                response.headers["Access-Control-Allow-Origin"] = origin;
                response.headers["Access-Control-Allow-Credentials"] = "true";
                response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
                response.headers.Vary = "Origin";
                if (addCache) {
                    response.headers["Access-Control-Max-Age"] = Math.floor(this.configService.values.server.cors.cacheTTL / 1000).toString();
                }
            }
        }
    }
    
    optionsResponse(): EngineResponse {
        const response: EngineResponse = {
            code: 200
        };
        this.addCrossDomainHeaders(response, true);
        return response;
    }
    
    setHeaders(response: EngineResponse, contentType?: string, responseCode?: number): void {
        response.code = typeof(responseCode) === "number" ? responseCode : 200;
        if (contentType) {
            response.headers = response.headers || {};
            response.headers["Content-Type"] = contentType;
        }
        this.addCrossDomainHeaders(response, false);
    }
    
    rawResponse(data: string, contentType?: string, responseCode?: number): EngineResponse {
        const response: EngineResponse = {};
        this.setHeaders(response, contentType, responseCode);
        response.body = data;
        return response;
    }
    
    rawJsonResponse(data: string, responseCode?: number): EngineResponse {
        return this.rawResponse(data, "application/json", responseCode);
    }
    
    jsonResponse(data: any, responseCode?: number): EngineResponse {
        return this.rawJsonResponse(data == null ? "" : JSON.stringify(data), responseCode);
    }
    
    jsonRpcSuccessResponse(id: string|number, result: any, responseCode?: number): EngineResponse {
        return this.jsonResponse({
            jsonrpc: "2.0",
            id: id,
            result: result
        }, responseCode);
    }
    
    jsonRpcErrorResponse(id: string|number, code: string, responseCode?: number): EngineResponse {
        const error = ERROR_CODES[code];
        return this.jsonResponse({
            jsonrpc: "2.0",
            id: id,
            error: {
                code: error.code,
                message: error.message
            }
        }, responseCode);
    }
    
    redirect(url: string): EngineResponse {
        return {
            headers: {
                "Location": url
            }
        };
    }
    
    getRequestContentType() {
        if (!this.request) {
            throw new Error("Cannot get Content-Type header when request is null");
        }
        return this.request.header("Content-Type");
    }
    
    static jsonResponse(data: any): EngineResponse {
        return {
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(data)
        };
    }
}
