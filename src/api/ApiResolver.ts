/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppException } from "./AppException";
import { ApiMethod } from "./Decorators";

export interface Executor {
    execute(method: string, params: unknown): Promise<unknown>;
}

export class ApiResolver<Context> {
    
    private methods = new Map<string, {method: string, factory: (ioc: Context) => Executor}>();
    
    registerApi<T extends Executor>(apiClass: new(...args: any[]) => T, factory: (ctx: Context) => T) {
        this.registerApiWithPrefix("", apiClass, factory);
    }
    
    registerApiWithPrefix<T extends Executor>(prefix: string, apiClass: new(...args: any[]) => T, factory: (ctx: Context) => T) {
        for (const method of ApiMethod.getExportedMethods(apiClass)) {
            const fullMethodName = prefix + method.method;
            if (this.methods.has(fullMethodName)) {
                throw new Error("Method '" + fullMethodName + "' already registered");
            }
            this.methods.set(fullMethodName, {method: method.method, factory: factory});
        }
    }
    
    async execute(ctx: Context, method: string, params: unknown): Promise<unknown> {
        const methodEntry = this.methods.get(method);
        if (!methodEntry) {
            throw new AppException("METHOD_NOT_FOUND");
        }
        const api = methodEntry.factory(ctx);
        return await api.execute(methodEntry.method, params);
    }
}
