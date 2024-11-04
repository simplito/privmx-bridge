/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as http from "http";
import * as https from "https";
import * as urlModule from "url";
import { ConnectionError } from "./HttpClient";
import { Utils } from "./Utils";

export interface FetchOptions {
    method?: string;
    url: string;
    headers?: {[name: string]: string};
    body?: Buffer;
    agent?: https.Agent;
}

export interface FetchResponse {
    response: http.IncomingMessage;
    url: string;
    options: http.RequestOptions;
    readBody(): Promise<Buffer>;
}

export class HttpClient2 {
    
    static post(url: string, headers: {[name: string]: string}, body: Buffer): Promise<Buffer> {
        return HttpClient2.request("POST", url, headers, body);
    }

    static get(url: string, headers: {[name: string]: string}): Promise<Buffer> {
        return HttpClient2.request("GET", url, headers, Buffer.from(""));
    }
    
    static async request(httpMethod: string, url: string, headers: {[name: string]: string}, body: Buffer, agent?: https.Agent): Promise<Buffer> {
        const response = await this.req({method: httpMethod, url, headers, body, agent});
        if (response.response.statusCode != 200) {
            // eslint-disable-next-line
            throw {message: "Invalid status code " + response.response.statusCode, options: response.options};
        }
        return response.readBody();
    }
    
    static async req(opts: FetchOptions) {
        try {
            const defer = Utils.defer<FetchResponse>();
            const parsedUrl = urlModule.parse(opts.url);
            const options: http.RequestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol == "https:" ? 443 : 80),
                path: parsedUrl.path,
                method: opts.method || "GET",
                headers: opts.headers || {},
                agent: opts.agent
            };
            const callback = (msg: http.IncomingMessage) => {
                defer.resolve({
                    response: msg,
                    url: opts.url,
                    options: options,
                    readBody: () => new Promise<Buffer>((resolve, reject) => {
                        const chunks: Buffer[] = [];
                        msg.on("data", (chunk: Buffer) => {
                            chunks.push(chunk);
                        });
                        msg.on("end", () => {
                            resolve(Buffer.concat(chunks));
                        });
                        msg.on("error", e => {
                            reject(e);
                        });
                    }),
                });
            };
            let request: http.ClientRequest;
            if (parsedUrl.protocol == "https:") {
                request = https.request(options, callback);
            }
            else {
                request = http.request(options, callback);
            }
            request.on("error", err => {
                defer.reject({msg: "Error", cause: err, options: options});
            });
            if (opts.body) {
                request.end(opts.body);
            }
            else {
                request.end();
            }
            return await defer.promise;
        }
        catch (e) {
            throw new ConnectionError("cannot-make-http-call", {cause: e});
        }
    }
}
