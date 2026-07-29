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
import type { MasterPluginClass, PluginClass, WorkerPlugin, WorkerPluginClass } from "./Plugin";
import type { WorkerRegistry } from "../../cluster/worker/WorkerRegistry";
import { GeneralWorkerPlugin } from "./GeneralWorkerPlugin";
import type { MasterRegistry } from "../../cluster/master/MasterRegistry";

export type PluginCreator = (workerRegistry: WorkerRegistry) => WorkerPlugin;

export class PluginsLoader {
    
    static loadForMaster(masterRegistry: MasterRegistry) {
        const pluginsDir = path.resolve(__dirname, "../../../plugins");
        if (!fs.existsSync(pluginsDir)) {
            return;
        }
        const pluginDirs = fs.readdirSync(pluginsDir);
        for (const pluginDirName of pluginDirs) {
            if (pluginDirName == "." || pluginDirName == "..") {
                continue;
            }
            const pluginDir = path.resolve(pluginsDir, pluginDirName);
            if (!fs.statSync(pluginDir).isDirectory()) {
                continue;
            }
            const pluginOutDir = path.resolve(pluginDir, "out");
            if (!fs.statSync(pluginOutDir).isDirectory()) {
                continue;
            }
            const pluginFileName = fs.readdirSync(pluginOutDir);
            const masterPluginFileName = pluginFileName.find(x => x.endsWith("MasterPlugin.js"));
            if (masterPluginFileName) {
                const pluginMasterClass = PluginsLoader.loadClass<MasterPluginClass>(path.resolve(pluginOutDir, masterPluginFileName));
                if (!pluginMasterClass) {
                    continue;
                }
                masterRegistry.addPlugin(new pluginMasterClass.clazz(masterRegistry));
            }
        }
    }
    
    static loadForWorker(workerRegistry: WorkerRegistry) {
        const logger = workerRegistry.getLoggerFactory().createLogger(PluginsLoader);
        const pluginsManager = workerRegistry.getWorkerPluginsManager();
        const addPlugin = (pluginCreator: PluginCreator) => {
            const plugin = pluginCreator(workerRegistry);
            pluginsManager.addPlugin(plugin);
            logger.debug("Plugin " + plugin.getName() + " loaded");
            // logMicro("PluginsLoader " + plugin.getName());
        };
        // logMicro("PluginsLoader start");
        PluginsLoader.enumeratePlugins(pluginCreator => addPlugin(pluginCreator));
    }
    
    static enumeratePlugins(onPlugin: (creator: PluginCreator) => void) {
        const pluginsDir = path.resolve(__dirname, "../../../plugins");
        if (!fs.existsSync(pluginsDir)) {
            return;
        }
        const pluginDirs = fs.readdirSync(pluginsDir);
        for (const pluginDirName of pluginDirs) {
            if (pluginDirName == "." || pluginDirName == "..") {
                continue;
            }
            const pluginDir = path.resolve(pluginsDir, pluginDirName);
            if (!fs.statSync(pluginDir).isDirectory()) {
                continue;
            }
            const pluginOutDir = path.resolve(pluginDir, "out");
            if (!fs.statSync(pluginOutDir).isDirectory()) {
                continue;
            }
            const pluginFileNames = fs.readdirSync(pluginOutDir);
            const workerPluginFileName = pluginFileNames.find(x => x.endsWith("WorkerPlugin.js"));
            if (workerPluginFileName) {
                const pluginWorkerClass = PluginsLoader.loadClass<WorkerPluginClass>(path.resolve(pluginOutDir, workerPluginFileName));
                if (!pluginWorkerClass) {
                    continue;
                }
                onPlugin(wr => new pluginWorkerClass.clazz(wr));
            }
            else {
                const pluginFileName = pluginFileNames.find(x => x.endsWith("Plugin.js") && !x.endsWith("MasterPlugin.js"));
                if (!pluginFileName) {
                    continue;
                }
                const pluginClass = PluginsLoader.loadClass<PluginClass>(path.resolve(pluginOutDir, pluginFileName));
                if (!pluginClass) {
                    continue;
                }
                onPlugin(() => new GeneralWorkerPlugin(pluginClass.clazz));
            }
        }
    }
    
    static loadClass<T>(filePath: string): null|{clazz: T, className: string} {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const fileName = path.parse(filePath).base;
        const className = fileName.replace(".js", "");
        //  eslint-disable-next-line
        const loadedModule = require(filePath);
        if (!loadedModule) {
            return null;
        }
        const loadedClass = loadedModule[className];
        if (!loadedClass || typeof(loadedClass) != "function") {
            return null;
        }
        return {clazz: loadedClass, className: className};
    }
}
