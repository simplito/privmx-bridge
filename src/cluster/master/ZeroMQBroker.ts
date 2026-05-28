/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { XSubscriber, XPublisher } from "zeromq";
import { Logger } from "../../service/log/Logger";
import { Config } from "../common/ConfigUtils";
import { Utils } from "../../utils/Utils";

export class ZeroMQBroker {
    private readonly pubEndpoint: string;
    private readonly subEndpoint: string;
    private running: boolean = false;
    private xsubSocket?: XSubscriber;
    private xpubSocket?: XPublisher;
    
    constructor(
        private logger: Logger,
        private config: Config,
    ) {
        this.pubEndpoint = `ipc://${this.config.server.broker.brokerUri}_pub.ipc`;
        this.subEndpoint = `ipc://${this.config.server.broker.brokerUri}_sub.ipc`;
    }
    
    public async start(): Promise<void> {
        if (this.running) {
            return;
        }
        
        this.xsubSocket = new XSubscriber();
        this.xpubSocket = new XPublisher();
        
        try {
            await this.xsubSocket.bind(this.pubEndpoint);
            await this.xpubSocket.bind(this.subEndpoint);
            this.running = true;
            this.logger.out(`Broker starting on ${Utils.getThisWorkerId()}`);
            this.logger.debug(" ZeroMQ IPC Broker started:");
            this.logger.debug(` - Workers Publish (XSUB) to: ${this.pubEndpoint}`);
            this.logger.debug(` - Workers Subscribe (XPUB) from: ${this.subEndpoint}`);
            
            void this.forwardMessages();
            void this.forwardSubscriptions();
            
        }
        catch (error) {
            this.logger.error(error, "ZeroMQ Broker failed to start:");
            this.stop();
        }
    }
    
    private async forwardMessages(): Promise<void> {
        if (!this.xsubSocket || !this.xpubSocket) {
            return;
        }
        try {
            for await (const frames of this.xsubSocket) {
                if (!this.running) {
                    break;
                }
                await this.xpubSocket.send(frames);
            }
        }
        catch (err) {
            if (this.running) {
                this.logger.error(err, "Error in XSub->XPub forward loop:");
            }
        }
    }
    
    private async forwardSubscriptions(): Promise<void> {
        if (!this.xsubSocket || !this.xpubSocket) {
            return;
        }
        try {
            for await (const frames of this.xpubSocket) {
                if (!this.running) {
                    break;
                }
                await this.xsubSocket.send(frames);
            }
        }
        catch (err) {
            if (this.running) {
                this.logger.error(err, "Error in XPub->XSub forward loop:");
            }
        }
    }
    
    public stop(): void {
        if (!this.running) {
            return;
        }
        this.running = false;
        this.xsubSocket?.close();
        this.xpubSocket?.close();
        this.logger.debug("ZeroMQ IPC Broker stopped.");
    }
}