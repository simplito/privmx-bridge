/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as http from "http";
import { EngineResponse } from "../../api/server/Engine";
import { RequestLogger } from "../../service/log/RequestLogger";
import { LoggerFactory } from "../../service/log/LoggerFactory";
import { HttpUtils } from "../../utils/HttpUtils";
import { Config } from "./ConfigUtils";

export class HttpHandler {
    
    constructor(
        private loggerFactory: LoggerFactory,
        private requestName: string,
        private router: {onRequest: (request: http.IncomingMessage, response: http.ServerResponse, body: Buffer, requestLogger: RequestLogger) => Promise<EngineResponse>},
        private config: Config,
    ) {
    }
    
    onRequest(request: http.IncomingMessage, response: http.ServerResponse) {
        void (async () => {
            const requestLogger = this.createRequestLogger();
            try {
                const body = await HttpUtils.readBody(request);
                requestLogger.setRequestSize(body.length);
                const result = await this.router.onRequest(request, response, body, requestLogger);
                this.applyResponse(result, response, requestLogger);
            }
            catch (e) {
                requestLogger.setMainException(e);
                this.applyResponse({
                    code: 500,
                    body: "500 Internal server error",
                    headers: {
                        "Content-Type": "text/plain"
                    }
                }, response, requestLogger);
            }
            finally {
                requestLogger.flush();
            }
        })();
    }
    
    private createRequestLogger() {
        return new RequestLogger(this.requestName, null, this.loggerFactory, null, this.config);
    }
    
    private applyResponse(eRes: EngineResponse, res: http.ServerResponse, requestLogger: RequestLogger) {
        if (eRes.done) {
            return;
        }
        res.statusCode = eRes.code ? eRes.code : 200;
        if (eRes.headers) {
            for (const hName in eRes.headers) {
                res.setHeader(hName, eRes.headers[hName]);
            }
        }
        if (eRes.body) {
            res.write(eRes.body);
            requestLogger.setResponsSize(eRes.body.length);
        }
        res.end();
    }
}
