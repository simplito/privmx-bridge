/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../../service/log/Logger";
import { LoggerFactory } from "../../service/log/LoggerFactory";
import { IBrokerClient } from "../common/BrokerClient";
import { Config } from "../common/ConfigUtils";
import { RedisBrokerClient } from "./RedisBrokerClient";
import { ZeroMQSubscriber } from "./ZeroMQSubscriber";

export class BrokerClientProvider {
    
    private logger: Logger;
    
    constructor(
        private loggerFactory: LoggerFactory,
        private config: Config,
    ) {
        this.logger = this.loggerFactory.createLogger(BrokerClientProvider);
    }
    
    public createClient(): IBrokerClient {
        const brokerType = this.config.server.broker.mode;
        this.logger.debug(`Creating broker client for type: ${brokerType}`);
        switch (brokerType) {
            case "internal":
                return new ZeroMQSubscriber(this.loggerFactory.createLogger(ZeroMQSubscriber), this.config);
            case "redis":
                return new RedisBrokerClient(this.loggerFactory.createLogger(RedisBrokerClient), this.config);
            default:
                throw new Error(`Unsupported broker type: ${brokerType}`);
        }
    }
}