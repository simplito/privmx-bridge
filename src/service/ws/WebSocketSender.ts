/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { TargetChannel, WebSocketConnectionManager } from "./WebSocketConnectionManager";

export class WebSocketSender {
    
    constructor(
        private webSocketConnectionManager: WebSocketConnectionManager,
    ) {
    }
    
    sendToAllAtChannel<T extends types.core.Event<any, any>>(channel: TargetChannel, event: T) {
        return this.sendAtChannel(null, channel, event);
    }
    
    sendCloudEventAtChannel<T extends types.cloud.Event<string, string, any>>(clients: types.core.Client[], channel: TargetChannel, event: T) {
        return this.sendAtChannel(clients, channel, event);
    }
    
    sendAtChannel<T extends types.core.Event<any, any>>(clients: types.core.Client[]|null, targetChannel: TargetChannel, event: T) {
        return this.webSocketConnectionManager.sendAtChannel(targetChannel, clients, event);
    }
}
