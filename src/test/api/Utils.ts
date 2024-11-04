/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../api/BaseValidator";
import { BaseApi } from "../../api/BaseApi";
import { ApiMethod, ExportedMethodOptions } from "../../api/Decorators";

export interface ApiResultEntry {
    testName: string;
    method: string;
    options: ExportedMethodOptions;
    params: unknown;
    result?: unknown;
}

export interface ApiResult {
    scope: string;
    prefix: string;
    clazz: any;
    validator: BaseValidator;
    entries: ApiResultEntry[];
}
export type ApiFunc = () => ApiResult;

// eslint-disable-next-line
export function testApi<T extends BaseApi>(scope: string, prefix: string, clazz: {new(...args: any[]): T}, validator: BaseValidator, func: (call: <R>(testName: string, f: (api: T) => Promise<R>) => {setResult(result: R): void}) => unknown): ApiFunc {
    return () => {
        const entries: ApiResultEntry[] = [];
        const methods = ApiMethod.getExportedMethods(clazz);
        const stub: any = {};
        for (const method of methods) {
            stub[method.method] = ((methodName: string, params: unknown) => {
                const p = params || {};
                return {method: methodName, options: method.options, params: p};
            }).bind(null, method.method);
        }
        func((testName, f) => {
            const res = <{method: string, options: ExportedMethodOptions, params: unknown}>(f(stub as T) as any);
            const entry: ApiResultEntry = {testName: testName, method: res.method, options: res.options, params: res.params};
            entries.push(entry);
            return {
                setResult: (result) => {
                    entry.result = result;
                },
            };
        });
        const res: ApiResult = {
            scope: scope,
            prefix: prefix,
            clazz: clazz,
            validator: validator,
            entries: entries,
        };
        return res;
    };
}
