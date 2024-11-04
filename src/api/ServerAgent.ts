/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";
import { ConfigService } from "../service/config/ConfigService";

export class ServerAgent {
    
    constructor(
        private configService: ConfigService
    ) {
    }
    
    getAgent(): types.core.UserAgent {
        return <types.core.UserAgent>("privmx-bridge;" + this.configService.values.server.version + ",PrivmxApi/2.11.0");
    }
}
