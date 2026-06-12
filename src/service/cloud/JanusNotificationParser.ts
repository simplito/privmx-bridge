/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { LoggerFactory } from "../log/LoggerFactory";
import { Logger } from "../log/Logger";

export class JanusNotificationParser {
    
    private logger: Logger;
    
    constructor(loggerFactory: LoggerFactory) {
        this.logger = loggerFactory.createLogger(JanusNotificationParser);
    }
    
    isValidJanusNotification(n: any): boolean {
        return typeof n === "object" && n !== null && "janus" in n && "session_id" in n && typeof n.session_id === "number";
    }
    
    extractData<T>(raw: any): T | null {
        if ("plugindata" in raw && "data" in raw.plugindata) {
            return raw.plugindata.data as T;
        }
        return null;
    }
    
    extractAndValidateEventType(raw: any): string {
        const data = this.extractData<any>(raw);
        if (!data && "janus" in raw) {
            return raw.janus;
        }
        if (data && "videoroom" in data) {
            return data.videoroom;
        }
        // Called per inbound frame to classify events; most "unknown" shapes are benign Janus
        // noise we deliberately ignore, so keep this at debug to avoid log spam.
        this.logger.debug({ raw }, "Unknown event type structure");
        return "unknown";
    }
}
