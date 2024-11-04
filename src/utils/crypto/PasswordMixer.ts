/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as crypto from "crypto";

export interface Options {
    algorithm?: string;
    hash?: string;
    version?: number;
    salt?: string;
    length?: number;
    rounds?: number;
}

export class PasswordMixer {
    
    mix(password: string, data: Options) {
        const algorithm = data.algorithm || "none";
        if (algorithm !== "PBKDF2") {
            throw new Error("Unsupported algorithm '" + algorithm + "'");
        }
        const hash = data.hash || "none";
        if (hash !== "SHA512") {
            throw new Error("Unsupported hash algorithm '" + hash + "'");
        }
        const version = data.version || -1;
        if (version !== 1) {
            throw new Error("Unsupported version " + version + "");
        }
        const saltB64 = data.salt || "";
        const salt = Buffer.from(saltB64);
        const length = data.length || -1;
        if (salt.length !== 16 || length !== 16 ) {
            throw new Error("Incorrect params - salt: " + saltB64 + ", length: " + length + "");
        }
        const rounds = data.rounds || -1;
        return crypto.pbkdf2Sync(password, salt, rounds, length, hash);
    }
}
