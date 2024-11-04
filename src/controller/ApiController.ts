/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ApiFunc } from "../test/api/Utils";
import * as Registry from "../test/api/Registry";
import { docs } from "../docs/get_docs";
import * as fs from "fs";
import { ConfigService } from "../service/config/ConfigService";
import { EngineResponse } from "../api/server/Engine";

export class ApiController {
    
    constructor(
        private configService: ConfigService,
    ) {
    }
    
    async testApi(): Promise<EngineResponse> {
        const htmlTemplate = await fs.promises.readFile(this.configService.getAssetPath("assets/testApi.html"), "utf8");
        const html = htmlTemplate
            .replace(/{{presets}}/g, await this.getApiExamples())
            .replace(/{{commonErrors}}/g, JSON.stringify(docs.errorsWithDescription, null, 2))
            .replace(/{{errors}}/g, JSON.stringify(docs.jsonRpcErrors, null, 2));
        return {body: html};
    }
    
    private async getApiExamples() {
        const res = [];
        let i = 0;
        for (const key in Registry) {
            const value = <ApiFunc>(<any>Registry)[key];
            const result = value();
            const apiRes = {name: result.clazz.name, methods: [] as any[]};
            const currentlyResolvedApi = docs.apis[result.clazz.name];
            res.push(apiRes);
            for (const entry of result.entries) {
                apiRes.methods.push({
                    id: "api-" + (i++),
                    label: entry.testName,
                    api: result.scope,
                    method: result.prefix + entry.method,
                    params: entry.params,
                    info: currentlyResolvedApi?.methods[entry.testName],
                });
            }
        }
        return JSON.stringify(res, null, 4);
    }
}