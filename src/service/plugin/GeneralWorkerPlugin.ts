/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type{ IOC } from "../ioc/IOC";
import type { PluginClass, WorkerPlugin } from "./Plugin";

export class GeneralWorkerPlugin implements WorkerPlugin {
    
    constructor(
        private pluginClass: PluginClass,
    ) {
    }
    
    create(ioc: IOC) {
        return new this.pluginClass(ioc);
    }
    
    getName() {
        return this.pluginClass.name.replace("Plugin", "").toLowerCase();
    }
}
