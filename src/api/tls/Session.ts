/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ISession } from "./ISession";

export class Session implements ISession {
    
    container: {[key: string]: any};
    
    constructor() {
        this.container = {};
    }
    
    contains(key: string): boolean {
        return key in this.container;
    }
    
    save<T = any>(key: string, value: T): void {
        this.container[key] = value;
    }
    
    get<T = any>(key: string, def: T = null): T {
        return key in this.container ? this.container[key] : def;
    }
    
    delete(_key: string): void {
        // delete this.container[key];
    }
}
