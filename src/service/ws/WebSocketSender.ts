/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { WebSocketConnectionManager } from "./WebSocketConnectionManager";

export class WebSocketSender {
    
    constructor(
        private webSocketConnectionManager: WebSocketConnectionManager,
    ) {
    }
    
    sendToAll<T extends types.core.Event<any, any>>(event: T) {
        return this.sendToAllAtChannel("", event);
    }
    
    sendToAllAtChannel<T extends types.core.Event<any, any>>(channel: string, event: T) {
        return this.sendAtChannel(channel, null, event);
    }
    
    send<T extends types.core.Event<any, any>>(clients: types.core.Client[], event: T) {
        return this.sendAtChannel("", clients, event);
    }
    
    sendCloudEventAtChannel<T extends types.cloud.Event<string, string, any>>(clients: types.core.Client[], event: T) {
        return this.sendAtChannel(event.channel, clients, event);
    }
    
    sendAtChannel<T extends types.core.Event<any, any>>(channel: string, clients: types.core.Client[]|null, event: T) {
        return this.webSocketConnectionManager.sendAtChannel(channel, clients, event);
    }
}
