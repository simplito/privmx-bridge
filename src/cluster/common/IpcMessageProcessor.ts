/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcChannelMessage, isIpcChannelMessage, isIpcRequest, isIpcResponse } from "./Ipc";
import { IpcExecutor } from "./IpcExecutor";
import { IpcListener } from "./IpcListener";
import * as child from "child_process";
import { Logger } from "../../service/log/Logger";

export class IpcMessageProcessor {
    
    constructor(
        private ipcExecutor: IpcExecutor,
        private ipcListener: IpcListener,
        private logger: Logger,
    ) {
    }
    
    async processMessage(message: unknown, senderName: string, responseChannel: {send(message: child.Serializable): void}) {
        if (!isIpcChannelMessage(message)) {
            this.logger.error(`Invalid ipc channel message from ${senderName}`);
            return;
        }
        
        if (message.channel === "request") {
            if (!isIpcRequest(message.data)) {
                this.logger.error(`Invalid ipc request message from ${senderName}`);
                return;
            }
            const response = await this.ipcExecutor.execute(message.data);
            const res: IpcChannelMessage = {channel: "response", data: response};
            responseChannel.send(res);
        }
        else if (message.channel === "request-batch") {
            if (!Array.isArray(message.data)) {
                this.logger.error(`Invalid ipc request-batch, data is not an array, from ${senderName}`);
                return;
            }
            
            const processingPromises = message.data.map(async (innerMessage) => {
                if (isIpcChannelMessage(innerMessage) && isIpcRequest(innerMessage.data)) {
                    if (innerMessage.channel === "request") {
                        const response = await this.ipcExecutor.execute(innerMessage.data);
                        const res: IpcChannelMessage = {channel: "response", data: response};
                        responseChannel.send(res);
                    }
                    else  if (innerMessage.channel === "request_void") {
                        void this.ipcExecutor.execute(innerMessage.data);
                    }
                    
                }
                else {
                    this.logger.error(innerMessage, `Invalid item in ipc request-batch from ${senderName}`);
                }
            });
            
            await Promise.all(processingPromises);
        }
        else if (message.channel === "response") {
            if (!isIpcResponse(message.data)) {
                this.logger.error(message, `Invalid ipc response message from ${senderName}`);
                return;
            }
            this.ipcListener.onMessage(message.data);
        }
        else {
            this.logger.error(`Unsupported channel '${message.channel}' in ipc message from ${senderName}`);
            return;
        }
    }
}