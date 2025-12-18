/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { isIpcChannelMessage, isIpcRequest } from "./Ipc";
import { IpcExecutor } from "./IpcExecutor";
import { Logger } from "../../service/log/Logger";

export class SubscriberMessageProcessor {
    
    constructor(
        private ipcExecutor: IpcExecutor,
        private logger: Logger,
    ) {
    }
    
    processMessage(message: unknown, senderName: string) {
        if (!isIpcChannelMessage(message)) {
            this.logger.error(`Invalid ipc channel message from ${senderName}`);
            return;
        }
        else if (message.channel === "request-batch") {
            if (!Array.isArray(message.data)) {
                this.logger.error(`Invalid ipc request-batch, data is not an array, from ${senderName}`);
                return;
            }
            
            void message.data.map(async (innerMessage) => {
                if (isIpcChannelMessage(innerMessage) && isIpcRequest(innerMessage.data)) {
                    if (innerMessage.channel === "request_void") {
                        void this.ipcExecutor.execute(innerMessage.data);
                    }
                }
                else {
                    this.logger.error(innerMessage, `Invalid item in ipc request-batch from ${senderName}`);
                }
            });
        }
        else if (message.channel === "request_void" && isIpcRequest(message.data)) {
            void this.ipcExecutor.execute(message.data);
        }
        else {
            this.logger.error(`Unsupported channel '${message.channel}' in ipc message from ${senderName}`);
            return;
        }
    }
}