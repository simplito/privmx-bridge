/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Crypto } from "./Crypto";

export interface Encoder {
    
    encode(value: Buffer): Buffer;
    decode(value: Buffer): Buffer;
}

// TODO: Cache is not optimal cause need to binary string conversation
// Encode/decode methods could get false but now its null
export class AesEncryptor implements Encoder {
    
    cache: {[data: string]: Buffer};
    
    constructor(
        private key: Buffer,
        private useCache: boolean
    ) {
        this.cache = {};
    }
    
    encode(value: Buffer): Buffer {
        if (value == null) {
            return value;
        }
        let binaryValue: string|null = null;
        let iv: Buffer;
        if (this.useCache) {
            binaryValue = value.toString("binary");
            if (binaryValue in this.cache) {
                return this.cache[binaryValue];
            }
            iv = Crypto.sha256(value).slice(0, 16);
        }
        else {
            iv = Crypto.randomBytes(16);
        }
        const cipher = Buffer.concat([iv, Crypto.aes256CbcPkcs7Encrypt(value, this.key, iv)]);
        if (binaryValue !== null) {
            this.cache[binaryValue] = cipher;
        }
        return cipher;
    }
    
    decode(value: Buffer): Buffer {
        if (value == null) {
            return value;
        }
        if (this.useCache) {
            for (const plainEntry in this.cache) {
                if (this.cache[plainEntry].equals(value)) {
                    return Buffer.from(plainEntry, "binary");
                }
            }
        }
        const iv = value.slice(0, 16);
        const cipher = value.slice(16);
        const plain = Crypto.aes256CbcPkcs7Decrypt(cipher, this.key, iv);
        if (this.useCache) {
            this.cache[plain.toString("binary")] = value;
        }
        return plain;
    }
}