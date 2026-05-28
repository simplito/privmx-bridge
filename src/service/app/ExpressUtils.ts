/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as express from "express";
import { EngineResponse } from "../../api/server/Engine";
import { Logger } from "../log/Logger";
import * as fs from "fs";
import { FsPromise } from "../../utils/FsPromise";
import { Utils } from "../../utils/Utils";

export class ExpressUtils {
    
    static getDownloadName(str: string) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 _\-\.]/gi, "").trim();
    }
    
    static async download(request: express.Request, response: express.Response, logger: Logger, date: Date|null, filePath: string, errorMessage: string, contentType: string, contentDisposition?: {inline: boolean; filename: string}, prepare?: () => Promise<void>): Promise<EngineResponse> {
        const stats = await Utils.tryPromise(() => FsPromise.stat(filePath));
        if (stats.success === false) {
            if (stats.error && stats.error.code === "ENOENT") {
                return {
                    code: 404,
                    body: "404 Not found",
                };
            }
            logger.error(stats.error, "Error during download " + errorMessage);
            return {
                code: 500,
                body: "500 Internal server error",
            };
        }
        const theDate = date || stats.result.mtime;
        const lastModified = theDate.toUTCString();
        const etag = "W/\"" + theDate.getTime().toString() + "\"";
        if (request.header("If-Modified-Since") == lastModified || request.header("If-None-Match") == etag) {
            return {
                code: 304,
                headers: {
                    "ETag": etag,
                    "Last-Modified": lastModified,
                },
                body: "",
            };
        }
        if (prepare) {
            await prepare();
        }
        response.contentType(contentType);
        if (contentDisposition) {
            response.set("Content-Disposition", (contentDisposition.inline ? "inline" : "attachment") + "; filename=\"" + ExpressUtils.getDownloadName(contentDisposition.filename) + "\"");
        }
        response.set("Cache-Control", "public, max-age=0");
        response.set("ETag", etag);
        response.set("Last-Modified", lastModified);
        fs.createReadStream(filePath)
            .on("error", err => {
                logger.error(err, "Error during download " + errorMessage);
                if (err && (err as any).code === "ENOENT") {
                    response.status(404);
                    response.send("404 Not found");
                }
                else {
                    response.status(500);
                    response.send("500 Internal server error");
                }
            })
            .pipe(response);
        return {done: true, body: null};
    }
}
