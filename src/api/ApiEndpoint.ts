/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../service/log/LoggerFactory";
import { EngineResponse, Engine } from "./server/Engine";
import * as express from "express";
import { ServerEndpoint } from "./ServerEndpoint";
import { RequestInfoHolder } from "./session/RequestInfoHolder";
import * as types from "../types";
import { ClientIpService } from "../service/misc/ClientIpService";
import { IpRateLimiterClient } from "../cluster/worker/IpRateLimiterClient";

export class ApiEndpoint {
    
    constructor(
        private engine: Engine,
        private request: express.Request|null,
        private serverEndpoint: ServerEndpoint,
        private requestInfoHolder: RequestInfoHolder,
        private clientIpService: ClientIpService,
        private logger: Logger,
        private ipRateLimiterClient: IpRateLimiterClient,
    ) {
    }
    
    async v2_0(): Promise<EngineResponse> {
        this.logger.debug("Api request v 2.0");
        if (!this.request) {
            throw new Error("Cannot execute method on empty requst");
        }
        const ipAddress = this.clientIpService.getClientIp(this.request);
        if (!(await this.ipRateLimiterClient.canPerformRequest(ipAddress))) {
            return this.engine.rawResponse("Too many requests", "text/plain", 429);
        }
        const contentType = this.engine.getRequestContentType();
        if (contentType != null) {
            if (!contentType.startsWith("application/octet-stream")) {
                this.logger.debug("Content-Type is not 'application/octet-stream', rejecting 400");
                return this.engine.jsonResponse({
                    msg: "Invalid transport type",
                }, 400);
            }
        }
        this.logger.debug("Processing api request v2.0");
        
        try {
            this.requestInfoHolder.setData(
                this.clientIpService.getClientIp(this.request),
                <types.core.ServerSessionId> this.request.header("Privmx-Auth"));
        }
        catch (e) {
            if (e && (e as {message: string}).message == "INVALID_PROXY_SESSION") {
                return this.engine.rawResponse("INVALID_PROXY_SESSION", "text/plain", 403);
            }
            throw e;
        }
        const response: EngineResponse = {};
        this.engine.setHeaders(response, "application/octet-stream");
        response.body = await this.serverEndpoint.execute(<Buffer> this.request.body);
        return response;
    }
}
