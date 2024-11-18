/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Crypto } from "./Crypto";

export class CryptoPrivFs {
    
    static AES_256_CBC_PKC7_NO_IV = 1;
    static AES_256_CBC_PKC7_WITH_IV = 2;
    static AES_256_CBC_PKC7_WITH_IV_AND_HMAC_SHA256 = 4;
    
    /**
     * Generate IV from index for AES (16 bytes long)
     */
    static generateIv(key: Buffer, idx: number): Buffer {
        return Crypto.hmacSha256(key, Buffer.from("iv" + idx, "utf8")).slice(0, 16);
    }
    
    /**
     * Reduce 32-bytes long key to 16-bytes long by SHA-256 and take first 16 bytes
     */
    static reduceKey(key: Buffer): Buffer {
        return Crypto.sha256(key).slice(0, 16);
    }
    
    /**
     * AES-256-CBC with PKCS7 padding encryption without attached IV
     */
    static aesEncryptWithDetachedIv(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        return Buffer.concat([Buffer.from([CryptoPrivFs.AES_256_CBC_PKC7_NO_IV]), Crypto.aes256CbcPkcs7Encrypt(data, key, iv)]);
    }
    
    /**
     * AES-256-CBC with PKCS7 padding encryption with attached IV
     */
    static aesEncryptWithAttachedIv(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        return Buffer.concat([Buffer.from([CryptoPrivFs.AES_256_CBC_PKC7_WITH_IV]), Crypto.aes256CbcPkcs7Encrypt(data, key, iv)]);
    }
    
    /**
     * AES-256-CBC with PKCS7 padding encryption with attached random IV
     */
    static aesEncryptWithAttachedRandomIv(data: Buffer, key: Buffer): Buffer {
        return CryptoPrivFs.aesEncryptWithAttachedIv(data, key, Crypto.randomBytes(16));
    }
    
    static aes256CbcHmac256Encrypt(data: Buffer, key32: Buffer, deterministic = false, tagLen = 16): Buffer {
        const encrypted = Crypto.aes256CbcHmac256Encrypt(data, key32, deterministic, tagLen);
        return Buffer.concat([Buffer.from([CryptoPrivFs.AES_256_CBC_PKC7_WITH_IV_AND_HMAC_SHA256]), encrypted]);
    }
    
    static decrypt(data: Buffer, key32: Buffer, iv16: Buffer|null = null): Buffer {
        const type = data.readUInt8(0);
        if (type == CryptoPrivFs.AES_256_CBC_PKC7_NO_IV) {
            if (!iv16) {
                throw new Error("Cannot decrypt AES_256_CBC_PKC7_NO_IV without iv");
            }
            return Crypto.aes256CbcPkcs7Decrypt(data.slice(1), key32, iv16);
        }
        if (type == CryptoPrivFs.AES_256_CBC_PKC7_WITH_IV) {
            return Crypto.aes256CbcPkcs7Decrypt(data.slice(17), key32, data.slice(1, 16));
        }
        if (type == CryptoPrivFs.AES_256_CBC_PKC7_WITH_IV_AND_HMAC_SHA256) {
            return Crypto.aes256CbcHmac256Decrypt(data.slice(1), key32);
        }
        throw new Error("Unknown decryption type " + type);
    }
}
