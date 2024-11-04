import { Config } from "../common/ConfigUtils";
import { Logger } from "../../service/log/LoggerFactory";
import { WebSocketClient } from "../../utils/WebSocketClient";

export type Notification = never;

export class ExternalCommunicationService {
    
    private ws: WebSocketClient;
    
    constructor(
        config: Config,
        private logger: Logger,
    ) {
        this.ws = new WebSocketClient({
            get enabled() {
                return config.server.externalWs.enabled;
            },
            get url() {
                return config.server.externalWs.wsUrl;
            },
            get auth() {
                return config.server.externalWs.apiKey;
            },
        }, this.logger, x => this.onNotification(x));
    }
    
    async connect() {
        return this.ws.connect();
    }
    
    async send<T = unknown>(method: string, params: unknown) {
        return this.ws.send<T>(method, params);
    }
    
    async close() {
        return this.ws.close();
    }
    
    private onNotification(_data: unknown) {
        this.logger.error("Unsupported notification");
    }
}
