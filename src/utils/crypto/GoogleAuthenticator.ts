/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as notp from "notp";
import * as base32 from "thirty-two";

export class GoogleAuthenticator {
    
    static validateKey(key: string) {
        this.decodeGoogleAuthKey(key);
    }
    
    static verifyToken(key: string, token: string, windows: number = 1) {
        const bin = this.decodeGoogleAuthKey(key);
        const cleanToken = token.replace(/\W+/g, "");
        return notp.totp.verify(cleanToken, bin, {window: windows, time: 30});
    }
    
    private static decodeGoogleAuthKey(key: string) {
        const unformatted = key.replace(/\W+/g, "").toUpperCase();
        const bin = base32.decode(unformatted);
        return bin;
    }
}
