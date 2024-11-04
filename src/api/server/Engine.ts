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
    body?: string|Buffer;
    headers?: {[name: string]: string};
    done?: boolean;
}

export class Engine {
    
    constructor(
        private configService: ConfigService,
        private request: express.Request
    ) {
    }
    
    addCrossDomainHeaders(response: EngineResponse, addCache: boolean): void {
        let origin = "*";
        if (this.request.header("Origin") != null) {
            origin = this.request.header("Origin");
        }
        if (this.configService.values.server.cors.enabled) {
            const domains = this.configService.values.server.cors.domains;
            if (domains.includes(<types.core.Host>"*") || domains.includes(<types.core.Host>origin) || this.configService.hostIsMyself(<types.core.Host>origin)) {
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
    
    setHeaders(response: EngineResponse, contentType: string = null, responseCode: number = null): void {
        response.code = responseCode == null ? 200 : responseCode;
        if (contentType != null) {
            response.headers = response.headers || {};
            response.headers["Content-Type"] = contentType;
        }
        this.addCrossDomainHeaders(response, false);
    }
    
    rawResponse(data: string, contentType: string = null, responseCode: number = null): EngineResponse {
        const response: EngineResponse = {};
        this.setHeaders(response, contentType, responseCode);
        response.body = data;
        return response;
    }
    
    rawJsonResponse(data: string, responseCode: number = null): EngineResponse {
        return this.rawResponse(data, "application/json", responseCode);
    }
    
    jsonResponse(data: any, responseCode: number = null): EngineResponse {
        return this.rawJsonResponse(data == null ? "" : JSON.stringify(data), responseCode);
    }
    
    jsonRpcSuccessResponse(id: string|number, result: any, responseCode: number = null): EngineResponse {
        return this.jsonResponse({
            jsonrpc: "2.0",
            id: id,
            result: result
        }, responseCode);
    }
    
    jsonRpcErrorResponse(id: string|number, code: string, responseCode: number = null): EngineResponse {
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
    
    getRequestContentType(): string {
        return this.request.header("Content-Type");
    }
    
    static jsonResponse(data: any): EngineResponse {
        return {
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(data)
        };
    }
}
