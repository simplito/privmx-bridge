/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Plugin } from "./Plugin";
import { MainApiResolver, RequestApiResolver } from "../../api/ServerEndpoint";

export class PluginsManager {
    
    plugins: Plugin[];
    
    constructor() {
        this.plugins = [];
    }
    
    addPlugin(plugin: Plugin) {
        this.plugins.push(plugin);
    }
    
    getPlugins() {
        return this.plugins;
    }
    
    getPluginByName(name: string) {
        for (const plugin of this.plugins) {
            if (plugin.getName() == name) {
                return plugin;
            }
        }
        return null;
    }
    
    publishEvent(event: any) {
        for (const plugin of this.plugins) {
            plugin.processEvent(event);
        }
    }
    
    registerEndpoint(apiRegistry: MainApiResolver) {
        for (const plugin of this.plugins) {
            plugin.registerEndpoint(apiRegistry);
        }
    }
    
    registerJsonRpcEndpoint(apiResolver: RequestApiResolver) {
        for (const plugin of this.plugins) {
            plugin.registerJsonRpcEndpoint(apiResolver);
        }
    }
    
    getPluginsNames() {
        return this.plugins.map(x => x.getName());
    }
    
    getEnabledPluginsNames() {
        return this.getEnabledPlugins().map(x => x.getName());
    }
    
    private getEnabledPlugins() {
        return this.plugins.filter(x => typeof(x.isEnabled) == "undefined" || x.isEnabled());
    }
}
