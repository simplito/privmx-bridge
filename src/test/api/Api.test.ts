/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppException } from "../../api/AppException";
import { ApiMethod } from "../../api/Decorators";
import * as Registry from "./Registry";
import { ApiFunc, ApiResult, ApiResultEntry } from "./Utils";
import "q2-test";

for (const key in Registry) {
    const value = <ApiFunc>(<any>Registry)[key];
    const result = value();
    const usedMethods = new Set<string>();
    for (const entry of result.entries) {
        it("ApiValidators " + result.scope + " " + result.clazz.name + " " + entry.testName, ((res: ApiResult, e: ApiResultEntry) => {
            try {
                usedMethods.add(e.method);
                res.validator.validate(e.method, e.params);
            }
            catch (err) {
                if (AppException.is(err, "INVALID_PARAMS")) {
                    throw new Error(err.message + ": " + err.data);
                }
                throw err;
            }
        }).bind(null, result, entry));
    }
    it("ApiValidators " + result.scope + " " + result.clazz.name + " all methods checked", async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        const uncalledMethods: string[] = [];
        for (const method of ApiMethod.getExportedMethods(result.clazz)) {
            if (!usedMethods.has(method.method)) {
                uncalledMethods.push(method.method);
            }
        }
        if (uncalledMethods.length > 0) {
            throw new Error(`No validator check for ${uncalledMethods.join(", ")}!`);
        }
    });
}
