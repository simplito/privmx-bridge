/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ConfigLoaderFunc, ConfigValues } from "./ConfigLoader";
import { Callbacks } from "../event/Callbacks";
import * as types from "../../types";
import * as path from "path";

export class ConfigService {
    
    values!: ConfigValues;
    
    constructor(
        private configLoader: ConfigLoaderFunc,
        private callbacks: Callbacks
    ) {
    }
    
    load(values: ConfigValues) {
        this.values = values;
        // logMicro("readConfigFile 02");
        this.callbacks.triggerZ("configLoad", []);
    }
    
    readConfigFile() {
        // logMicro("readConfigFile 01");
        this.load(this.configLoader());
        // logMicro("readConfigFile 03");
    }
    
    hostIsMyself(host: types.core.Host) {
        return this.values.hosts.includes(host);
    }
    
    getMainHost() {
        return this.values.hosts[0];
    }
    
    isAllowedUsername(username: string) {
        return this.values.user.allowedUsernames.includes(username);
    }
    
    getAssetPath(asset: string) {
        return path.resolve(this.values.assetsDir, asset);
    }
}
