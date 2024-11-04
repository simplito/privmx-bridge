/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as fs from "fs";
import * as path from "path";

export class Dumper {
    
    static dumpDependencies(ioc: any, dumpDir: string) {
        const filePath = path.resolve(dumpDir, `dump-${new Date().toISOString()}-${Math.random()}`);
        const deps: {id: string, scope: string, name: string, className: string, deps: string[], obj: any}[] = [];
        const map = new Map<any, string>();
        const invalidNames = ["request", "response", "webSocket"];
        function insert(name: string, obj: any) {
            if (!obj || map.has(obj) || invalidNames.includes(name)) {
                return;
            }
            const id = `id-${Math.random()}`;
            deps.push({id, scope: "request", name: name, className: obj.constructor.name, deps: [], obj});
            map.set(obj, id);
        }
        insert("requestScopeIoc", ioc);
        insert("ioc", ioc.ioc);
        for (const key in ioc) {
            insert(key, ioc[key]);
        }
        for (const key in ioc.ioc) {
            insert(key, ioc.ioc[key]);
        }
        for (const key in ioc.objectBag) {
            insert(key, ioc.objectBag[key]);
        }
        for (const dep of deps) {
            for (const x in dep.obj) {
                const prop = dep.obj[x];
                const id = map.get(prop);
                dep.deps.push(id || x);
            }
            delete dep.obj;
        }
        fs.writeFileSync(filePath, JSON.stringify(deps, null, 2));
    }
}
