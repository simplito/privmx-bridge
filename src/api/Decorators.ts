/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ErrorCode } from "./AppException";

export interface ExportedMethod {
    method: string;
    options: ExportedMethodOptions;
}

export interface ExportedMethodOptions {
    errorCodes?: ErrorCode[];
    scope?: string[];
    secondFactorRequired?: boolean;
}

export function ApiMethod(options: ExportedMethodOptions) {
    return (target: any, propertyKey: string, _descriptor: PropertyDescriptor) => {
        if (target.__exportedMethods == null) {
            target.__exportedMethods = [];
        }
        target.__exportedMethods.push({method: propertyKey, options});
    };
}

ApiMethod.getExportedMethods = function(clazz: unknown) {
    return (clazz as any)?.prototype?.__exportedMethods as ExportedMethod[] || [];
};

ApiMethod.getExportedMethod = function(clazz: unknown, method: string) {
    return ApiMethod.getExportedMethods(clazz).find(x => x.method === method);
};