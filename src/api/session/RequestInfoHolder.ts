/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { SessionData, ServerSessionService } from "./ServerSessionService";

export class RequestInfoHolder {
    
    ip: types.core.IPAddress;
    serverSession: SessionData;
    
    constructor(
        private serverSessionService: ServerSessionService
    ) {
    }
    
    setIP(ip: types.core.IPAddress): void {
        this.ip = ip;
    }
    
    setServerSession(auth: types.core.ServerSessionId): void {
        const serverSession = this.serverSessionService.getSession(auth);
        if (serverSession == null) {
            throw new Error("INVALID_PROXY_SESSION");
        }
        this.serverSession = serverSession;
    }
    
    setData(ip: types.core.IPAddress, auth: types.core.ServerSessionId): void {
        this.setIP(ip);
        if (auth) {
            this.setServerSession(auth);
        }
    }
}