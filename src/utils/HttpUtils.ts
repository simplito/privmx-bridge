/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as http from "http";

interface HttpRequestX extends http.IncomingMessage {
    readBodyPromise?: Promise<Buffer>;
}
export class HttpUtils {
    
    static readBody(request: http.IncomingMessage) {
        const requestX = request as HttpRequestX;
        if (requestX.readBodyPromise != null) {
            return requestX.readBodyPromise;
        }
        return requestX.readBodyPromise = new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on("error", (e) => {
                reject(e);
            });
            request.on("end", () => {
                resolve(Buffer.concat(chunks));
            });
        });
    }
    
    static getFirstHeaderValue(request: http.IncomingMessage, headerName: string): string|null {
        const header = request.headers[headerName];
        if (!header) {
            return null;
        }
        return Array.isArray(header) ? header[0] : header;
    }
    
    static getCookies(request: http.IncomingMessage) {
        const cookie = request.headers.cookie || "";
        return cookie.split(";").map(x => x.split("=")).filter(x => x.length === 2).map(x => ({name: x[0].trim(), value: x[1].trim()}));
    }
}
