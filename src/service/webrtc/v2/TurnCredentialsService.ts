/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Config } from "../../../cluster/common/ConfigUtils";
import { Crypto } from "../../../utils/crypto/Crypto";
import * as WebRtcTypes from "./WebRtcTypes";

export class TurnCredentialsService {
    
    constructor(
        private config: Config,
    ) {
    }
    
    getTurnCredentials(userId: string): WebRtcTypes.Credentials[] {
        return this.config.streams.turnServers.map(x => {
            const unixTimeStamp = Math.floor(Date.now() / 1000) + 24 * 3600; // 24 hours validity
            
            const userIdBuffer = Buffer.from(userId, "utf8");
            const hashedIdBuffer = Crypto.sha256(userIdBuffer);
            const hashedIdHex = hashedIdBuffer.toString("hex");
            
            const username = unixTimeStamp + ":" + hashedIdHex;
            
            const secretBuffer = Buffer.from(x.sharedSecret, "utf8");
            const usernameBuffer = Buffer.from(username, "utf8");
            
            const hmacBuffer = Crypto.hmacSha1(secretBuffer, usernameBuffer);
            const password = hmacBuffer.toString("base64");
            
            return {
                url: x.url,
                username: username,
                password: password,
                expirationTime: unixTimeStamp,
            };
        });
    }
}