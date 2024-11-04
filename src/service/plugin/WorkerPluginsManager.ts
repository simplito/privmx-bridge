/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IOC } from "../ioc/IOC";
import { WorkerPlugin } from "./Plugin";
import { PluginsManager } from "./PluginsManager";

export class WorkerPluginsManager {
    
    private plugins: WorkerPlugin[] = [];
    
    addPlugin(plugin: WorkerPlugin) {
        this.plugins.push(plugin);
    }
    
    getPluginByName<T extends WorkerPlugin = WorkerPlugin>(pluginName: string) {
        const plugin = this.plugins.find(x => x.getName() === pluginName);
        if (!plugin) {
            throw new Error(`Plugin with name ${pluginName} does not exist`);
        }
        return plugin as T;
    }
    
    loadPlugins(ioc: IOC, pluginsManager: PluginsManager) {
        for (const plugin of this.plugins) {
            pluginsManager.addPlugin(plugin.create(ioc));
        }
    }
}
