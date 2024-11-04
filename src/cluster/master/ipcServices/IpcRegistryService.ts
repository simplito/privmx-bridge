/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService, ipcServiceRegistry } from "../../master/Decorators";
import { ApiMethod } from "../../../api/Decorators";

@IpcService
export class IpcRegistryService {
    
    @ApiMethod({})
    async getIpcServiceRegistry() {
        return ipcServiceRegistry;
    }
}
