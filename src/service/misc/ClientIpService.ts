/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ClientIP, RequestLike } from "real-client-ip";
import { ConfigService } from "../config/ConfigService";
import * as types from "../../types";

export class ClientIpService {
    
    private clientIp?: ClientIP;
    
    constructor(
        private configService: ConfigService,
    ) {
    }
    
    getClientIp(req: RequestLike) {
        return <types.core.IPAddress> this.getClientIpResolver().getClientIP(req);
    }
    
    private getClientIpResolver() {
        if (this.clientIp == null) {
            this.clientIp = new ClientIP({
                allowedRemotes: this.configService.values.server.proxy.allowedRemotes,
                allowedHeaders: this.configService.values.server.proxy.allowedHeaders,
            });
        }
        return this.clientIp;
    }
}
