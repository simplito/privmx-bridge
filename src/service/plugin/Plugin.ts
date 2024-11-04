/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type { MainApiResolver, RequestApiResolver } from "../../api/ServerEndpoint";
import type * as types from "../../types";
import type { IOC } from "../ioc/IOC";
import type { WorkerRegistry } from "../../cluster/worker/WorkerRegistry";
import type { MasterRegistry } from "../../cluster/master/MasterRegistry";

export interface Plugin {
    
    isEnabled?: () => boolean;
    processEvent(event: any): void;
    getName(): types.user.PluginName;
    registerEndpoint(endpoint: MainApiResolver): void;
    registerJsonRpcEndpoint(endpoint: RequestApiResolver): void
}

export interface WorkerPlugin {
    create(ioc: IOC): Plugin;
    getName(): string;
}

export interface MasterPlugin {
    getName(): string;
}

// eslint-disable-next-line @typescript-eslint/prefer-function-type
export type WorkerPluginClass = {new (ioc: WorkerRegistry): WorkerPlugin;};

// eslint-disable-next-line @typescript-eslint/prefer-function-type
export type MasterPluginClass = {new (ioc: MasterRegistry): MasterPlugin;};

// eslint-disable-next-line @typescript-eslint/prefer-function-type
export type PluginClass = {new (ioc: IOC): Plugin;};
