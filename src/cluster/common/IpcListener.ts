/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../../service/log/Logger";
import { IpcResponse } from "../common/Ipc";
import { DeferredMap } from "./DeferredMap";

export class IpcListener {
    
    constructor(
        private map: DeferredMap,
        private logger: Logger,
    ) {
    }
    
    onMessage(message: IpcResponse) {
        const defer = this.map.pop(message.id);
        if (!defer) {
            this.logger.error("Invalid id of ipc response message");
            return;
        }
        if ("result" in message) {
            defer.resolve(message.result);
        }
        else {
            defer.reject(message.error);
        }
    }
}
