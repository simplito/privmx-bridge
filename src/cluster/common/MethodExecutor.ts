/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ApiMethod } from "../../api/Decorators";

export class MethodExecutor {
    
    private methods = new Map<string, any>();
    
    register(service: any) {
        return this.registerWithPrefix("", service);
    }
    
    registerWithPrefix(prefix: string, service: any) {
        for (const method of ApiMethod.getExportedMethods(service.constructor)) {
            const fullMethodName = prefix + method.method;
            if (this.methods.has(fullMethodName)) {
                throw new Error("Method '" + fullMethodName + "' already registered");
            }
            this.methods.set(fullMethodName, service);
        }
    }
    
    execute(method: string, params: unknown) {
        const service = this.methods.get(method);
        if (!service) {
            throw new Error("Method not found");
        }
        return service[method](params);
    }
}
