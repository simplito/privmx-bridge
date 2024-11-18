/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */

import { FetchResponse, HttpClient2 } from "./HttpClient2";

export class ConnectionError extends Error {
    
    constructor(message: string, public data: unknown) {
        super(message);
    }
}

export class HttpClient {
    
    constructor(private options?: {connect_timeout?: number, timeout?: number, base_uri?: string, verify?: boolean, allow_redirects?: {strict: true}}) {
    }
    
    async request(method: string, url: string, options: {[key: string]: any}): Promise<FetchResponse> {
        if (!url) {
            url = this.options?.base_uri || "";
        }
        if (method != "POST") {
            throw new Error("Http method not supported");
        }
        const reqBody = options.body ? options.body : Buffer.from(JSON.stringify(options.json), "utf8");
        const headers: {[header: string]: string} = {};
        if (options["Content-Type"]) {
            headers["Content-Type"] = options["Content-Type"];
        }
        if (options.headers) {
            for (const header in options.headers) {
                headers[header] = options.headers[header];
            }
        }
        // TODO use this.options
        return HttpClient2.req({
            method: "POST",
            url: url,
            body: reqBody,
            headers: headers,
        });
    }
}
