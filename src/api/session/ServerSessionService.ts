/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { Crypto } from "../../utils/crypto/Crypto";
import { Hex } from "../../utils/Hex";
import { DateUtils } from "../../utils/DateUtils";
import { ConfigService } from "../../service/config/ConfigService";

export interface SessionData {
    host: types.core.Host;
    serverKey: types.core.EccPubKey;
    established: types.core.Timestamp;
    lastUsage: types.core.Timestamp;
}

export class ServerSessionService {
    
    sessions: {[id: string]: SessionData};
    
    constructor(
        private configService: ConfigService
    ) {
        this.sessions = {};
    }
    
    create(host: types.core.Host, serverKey: types.core.EccPubKey): types.core.ServerSessionId {
        for (const sessionId in this.sessions) {
            if (this.sessions[sessionId].host == host) {
                delete this.sessions[sessionId];
            }
        }
        const id = <types.core.ServerSessionId>Hex.from(Crypto.randomBytes(10));
        const now = DateUtils.now();
        this.sessions[id] = {
            host: host,
            serverKey: serverKey,
            established: now,
            lastUsage: now
        };
        return id;
    }
    
    getSession(id: types.core.ServerSessionId): SessionData|null {
        const session = this.sessions[id];
        if (session == null) {
            return null;
        }
        if (DateUtils.timeElapsed(session.lastUsage, this.configService.values.proxy.serverSessionTTL)) {
            delete this.sessions[id];
            return null;
        }
        return session;
    }
    
    clearSessions(host: types.core.Host): void {
        const newMap: {[id: string]: SessionData} = {};
        for (const sessionId in this.sessions) {
            const session = this.sessions[sessionId];
            if (session.host != host) {
                newMap[sessionId] = session;
            }
        }
        this.sessions = newMap;
    }
}