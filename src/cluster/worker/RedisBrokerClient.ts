/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

// Import the "redis" library, which is compatible with Redis
import { createClient, RedisClientType } from "redis";
import { EventPayload, IBrokerClient, MessageHandler } from "../common/BrokerClient";
import { Logger } from "../../service/log/Logger";
import { Utils } from "../../utils/Utils";
import { IpcChannelMessage } from "../common/Ipc";
import { Packr, Unpackr } from "msgpackr";
import { Config } from "../common/ConfigUtils";

export interface RedisBrokerOptions {
    brokerUri: string;
}

export class RedisBrokerClient implements IBrokerClient {
    
    private static readonly IPC_CHANNEL = "ipc:events";
    
    private readonly id: string;
    private messageHandler: MessageHandler = () => {
        this.logger.error("RedisBrokerClient received a message, but no handler was set with onMessage().");
    };
    
    private readonly pubClient: RedisClientType;
    private readonly subClient: RedisClientType;
    private readonly options: RedisBrokerOptions;
    
    private readonly packr: Packr;
    private readonly unpackr: Unpackr;
    
    private sendQueue: Buffer[] = [];
    private isSending: boolean = false;
    
    constructor(
        private logger: Logger,
        private config: Config,
    ) {
        this.options = {
            brokerUri: this.config.server.broker.brokerUri,
        };
        this.id = Utils.getThisWorkerId();
        
        this.pubClient = createClient({ url: this.options.brokerUri });
        this.subClient = createClient({ url: this.options.brokerUri });
        
        this.pubClient.on("error", (err) =>
            this.logger.error(err, `[${this.id}] Redis PubClient Error`),
        );
        this.subClient.on("error", (err) =>
            this.logger.error(err, `[${this.id}] Redis SubClient Error`),
        );
        
        this.pubClient.on("ready", () => {
            this.logger.debug(`[${this.id}] Redis PubClient ready.`);
            void this.processSendQueue();
        });
        
        this.packr = new Packr({ useRecords: true });
        this.unpackr = new Unpackr({ useRecords: true });
    }
    
    onMessage(handler: MessageHandler): void {
        this.messageHandler = handler;
    }
    
    async start(): Promise<void> {
        this.logger.out(`Connecting to ${this.config.server.broker.brokerUri}...`);
        try {
            await this.pubClient.connect();
            await this.subClient.connect();
        }
        catch (err) {
            this.logger.error(err, `[${this.id}] Failed to connect to Redis`);
            throw err;
        }
        this.logger.out(`Connected to ${this.config.server.broker.brokerUri}`);
        
        await this.subClient.subscribe(RedisBrokerClient.IPC_CHANNEL, (message: Buffer) => {
            let messageData: EventPayload;
            try {
                messageData = this.unpackr.unpack(message);
            }
            catch (error) {
                this.logger.error(error, `[${this.id}] Error unpacking message`);
                return;
            }
            void (async () => {
                try {
                    this.messageHandler(messageData);
                }
                catch (err) {
                    this.logger.error(err, `[${this.id}] Unhandled error in onMessage handler`);
                }
            })();
        }, true);
        
        this.logger.debug(` Worker ${this.id} connected to Redis broker at ${this.options.brokerUri}`);
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
    
    private async processSendQueue(): Promise<void> {
        if (this.isSending || !this.pubClient.isOpen) {
            return;
        }
        this.isSending = true;
        try {
            while (this.sendQueue.length > 0 && this.pubClient.isOpen) {
                const message = this.sendQueue.shift();
                if (!message) {
                    continue;
                }
                try {
                    await this.pubClient.publish(RedisBrokerClient.IPC_CHANNEL, message);
                }
                catch (error) {
                    this.logger.error(error, "Failed to send Redis message from queue:");
                }
            }
        }
        finally {
            this.isSending = false;
        }
    }
    
    async stop() {
        try {
            await this.subClient.unsubscribe(RedisBrokerClient.IPC_CHANNEL);
            await this.subClient.quit();
            await this.pubClient.quit();
            this.logger.out(`${this.id} disconnected from ${this.config.server.broker.brokerUri}.`);
        }
        catch (err) {
            this.logger.error(err, "Error disconnecting");
        }
    }
}