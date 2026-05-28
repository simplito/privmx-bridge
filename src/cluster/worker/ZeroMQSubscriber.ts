/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Publisher, Subscriber } from "zeromq";
import { EventPayload, IBrokerClient, MessageHandler } from "../common/BrokerClient";
import { Logger } from "../../service/log/Logger";
import { Utils } from "../../utils/Utils";
import { IpcChannelMessage } from "../common/Ipc";
import { Packr, Unpackr } from "msgpackr";
import { Config } from "../common/ConfigUtils";

export interface ZeroMQSubscriberOptions {
    socketPath: string;
    reconnectInterval: number;
}

export class ZeroMQSubscriber implements IBrokerClient {
    
    private readonly id: string;
    private readonly pubEndpoint: string;
    private readonly subEndpoint: string;
    private messageHandler: MessageHandler = () => {
        this.logger.error("ZeroMQSubscriber received a message, but no handler was set with onMessage().");
    };
    private readonly pubSocket: Publisher;
    private readonly subSocket: Subscriber;
    private readonly options: ZeroMQSubscriberOptions;
    
    private readonly packr: Packr;
    private readonly unpackr: Unpackr;
    
    private sendQueue: Buffer[] = [];
    private isSending: boolean = false;
    
    constructor(
        private logger: Logger,
        private config: Config,
    ) {
        this.options = {
            socketPath: this.config.server.broker.brokerUri,
            reconnectInterval: 100,
        };
        this.id = Utils.getThisWorkerId();
        this.pubEndpoint = `ipc://${this.options.socketPath}_pub.ipc`;
        this.subEndpoint = `ipc://${this.options.socketPath}_sub.ipc`;
        
        this.pubSocket = new Publisher({
            reconnectInterval: this.options.reconnectInterval,
        });
        this.subSocket = new Subscriber({
            reconnectInterval: this.options.reconnectInterval,
        });
        
        this.packr = new Packr({useRecords: true});
        this.unpackr = new Unpackr({useRecords: true});
    }
    
    onMessage(handler: MessageHandler): void {
        this.messageHandler = handler;
    }
    
    async start(): Promise<void> {
        try {
            this.pubSocket.connect(this.pubEndpoint);
            this.subSocket.connect(this.subEndpoint);
        }
        catch (err) {
            this.logger.error(err, `[${this.id}] Failed to connect sockets`);
            throw err;
        }
        
        this.subSocket.subscribe("");
        this.logger.out(`${this.id} connected to internal broker.`);
        this.logger.debug(` - Pub connected to: ${this.pubEndpoint}`);
        this.logger.debug(` - Sub connected to: ${this.subEndpoint}`);
        void this.receiveEvents();
    }
    
    async publish(data: IpcChannelMessage): Promise<void> {
        const fullPayload: EventPayload = {
            sender: this.id,
            data: data,
        };
        const messageBuffer: Buffer = this.packr.pack(fullPayload);
        this.sendQueue.push(messageBuffer);
        void this.processSendQueue();
    }
    
    private async receiveEvents(): Promise<void> {
        try {
            for await (const [msgBuffer] of this.subSocket) {
                let messageData: EventPayload;
                try {
                    messageData = this.unpackr.unpack(msgBuffer);
                }
                catch (error) {
                    this.logger.error(error, `[${this.id}] Error unpacking message`);
                    continue;
                }
                void (async () => {
                    try {
                        this.messageHandler(messageData);
                    }
                    catch (err) {
                        this.logger.error(err, `[${this.id}] Unhandled error in onMessage handler`);
                    }
                })();
            }
        }
        catch (err: unknown) {
            this.logger.error(err, `[${this.id}] ZeroMQ receive loop terminated unexpectedly.`);
        }
    }
    
    private async processSendQueue(): Promise<void> {
        if (this.isSending) {
            return;
        }
        this.isSending = true;
        try {
            while (this.sendQueue.length > 0) {
                const message = this.sendQueue.shift();
                if (!message) {
                    continue;
                }
                try {
                    await this.pubSocket.send(message);
                }
                catch (error) {
                    this.logger.error(error, "Failed to send ZMQ message from queue:");
                }
            }
        }
        finally {
            this.isSending = false;
        }
    }
    
    async stop() {
        this.pubSocket.close();
        this.subSocket.close();
        this.logger.debug(`Worker ${this.id} stopped.`);
    }
}