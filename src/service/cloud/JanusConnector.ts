/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { JanusConnection } from "../../CommonTypes";
import { AppException } from "../../api/AppException";
import { LoggerFactory } from "../log/LoggerFactory";
import { Logger } from "../log/Logger";
import * as WebSocket from "ws";
import { JanusVideoRoomPluginApi } from "../webrtc/v2/janus/videoroom/JanusVideoRoomPluginApi";
import { JanusRequester } from "../webrtc/v2/janus/JanusRequester";
import { JanusApi } from "../webrtc/v2/janus/JanusApi";
import { Config } from "../../cluster/common/ConfigUtils";

const JANUS_PROTOCOL = "janus-protocol";

/** Shared low-level transport (opens a ws to the media server); used by both the admin connection and per-ws contexts. */
export class JanusConnector {
    
    private logger: Logger;
    
    constructor(
        private loggerFactory: LoggerFactory,
        private config: Config,
    ) {
        this.logger = this.loggerFactory.createLogger(JanusConnector);
    }
    
    async openWs(onUnhandledMessage?: (notification: unknown) => unknown, onEveryMessage?: (notification: unknown) => unknown): Promise<JanusConnection> {
        try {
            const url = `wss://${this.config.streams.mediaServer.url}:${this.config.streams.mediaServer.port}`;
            const janusWs = new WebSocket(url, JANUS_PROTOCOL, {
                protocolVersion: 8,
                rejectUnauthorized: !this.config.streams.mediaServer.allowSelfSignedCerts,
            });
            
            return new Promise<JanusConnection>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    janusWs.close();
                    reject(new AppException("CANNOT_CONNECT_TO_MEDIA_SERVER", "Connection timed out"));
                }, 5000);
                
                janusWs.addEventListener("open", () => {
                    clearTimeout(timeout);
                    const janusRequester = new JanusRequester(this.loggerFactory.createLogger(JanusRequester), janusWs, this.config, x => onUnhandledMessage?.(x), x => onEveryMessage?.(x));
                    const janusApi = new JanusApi(janusRequester, this.loggerFactory.createLogger(JanusApi));
                    const janusVideoRoomPluginApi = new JanusVideoRoomPluginApi(janusRequester, this.loggerFactory.createLogger(JanusVideoRoomPluginApi));
                    resolve({ janusRequester, janusWs, janusApi, janusVideoRoomPluginApi });
                });
                
                janusWs.addEventListener("error", (err: unknown) => {
                    clearTimeout(timeout);
                    this.logger.error(err, "WS Connection Error");
                    reject(new AppException("CANNOT_CONNECT_TO_MEDIA_SERVER"));
                });
            });
        }
        catch (e) {
            this.logger.error(e, "Cannot connect to media server");
            throw new AppException("CANNOT_CONNECT_TO_MEDIA_SERVER");
        }
    }
}
