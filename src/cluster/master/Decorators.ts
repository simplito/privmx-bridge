/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ApiMethod } from "../../api/Decorators";

export interface IpcServiceDescriptor {
    className: string;
    classNameLower: string;
    methods: string[];
}

export const ipcServiceRegistry: IpcServiceDescriptor[] = [];

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function IpcService(constructor: Function) {
    const methods: string[] = [];
    for (const exportedMethod of ApiMethod.getExportedMethods(constructor)) {
        if (typeof (constructor.prototype[exportedMethod.method]) == "function") {
            methods.push(exportedMethod.method);
        }
    }
    ipcServiceRegistry.push({
        className: constructor.name,
        classNameLower: constructor.name[0].toLowerCase() + constructor.name.substring(1),
        methods,
    });
}
