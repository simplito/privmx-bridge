/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as crypto from "crypto";
import * as elliptic from "elliptic";

export interface KdfParams {
    label?: string;
    seed?: Buffer;
    counters?: boolean;
    feedback?: boolean;
    context?: string|Buffer;
    iv?: string|Buffer;
}

export class Crypto {
    
    /**
     * Pseudo random bytes
     */
    static randomBytes(length: number): Buffer {
        return crypto.randomBytes(length);
    }
    
    static hash(algorithm: string, data: Buffer) {
        return crypto.createHash(algorithm).update(data).digest();
    }
    
    static hmac(algorithm: string, key: Buffer, data: Buffer): Buffer {
        return crypto.createHmac(algorithm, key).update(data).digest();
    }
    
    /**
     * HMAC-SHA-256
     */
    static hmacSha256(key: Buffer, data: Buffer): Buffer {
        return Crypto.hmac("sha256", key, data);
    }
    
    /**
     * SHA-1
     */
    static sha1(data: Buffer): Buffer {
        return Crypto.hash("sha1", data);
    }
    
    /**
     * SHA-256 (32 bytes long)
     */
    static sha256(data: Buffer): Buffer {
        return Crypto.hash("sha256", data);
    }
    
    /**
     * SHA-512 (64 bytes long)
     */
    static sha512(data: Buffer): Buffer {
        return Crypto.hash("sha512", data);
    }
    
    /**
     * HASH-160 (RIPEMD-160 at SHA-256)
     */
    static hash160(data: Buffer): Buffer {
        return Crypto.hash("ripemd160", Crypto.sha256(data));
    }
    
    static md5(data: Buffer) {
        return Crypto.hash("md5", data);
    }
    
    /**
     * AES-256-CBC with PKCS7 padding encryption
     */
    static aes256CbcPkcs7Encrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        const aes = crypto.createCipheriv("aes-256-cbc", key, iv);
        return Buffer.concat([aes.update(data), aes.final()]);
    }
    
    /**
     * AES-256-CBC with PKCS7 padding decryption
     */
    static aes256CbcPkcs7Decrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        const aes = crypto.createDecipheriv("aes-256-cbc", key, iv);
        return Buffer.concat([aes.update(data), aes.final()]);
    }
    
    /**
     * AES-256-CBC encryption
     */
    static aes256CbcEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
        cipher.setAutoPadding(false);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }
    
    /**
     * AES-256-CBC decryption
     */
    static aes256CbcDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        const cipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        cipher.setAutoPadding(false);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }
    
    /**
     * AES-256-ECB encryption
     */
    static aes256EcbEncrypt(data: Buffer, key: Buffer): Buffer {
        const cipher = crypto.createCipheriv("aes-256-ecb", key, "");
        cipher.setAutoPadding(false);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }
    
    /**
     * AES-256-ECB decryption
     */
    static aes256EcbDecrypt(data: Buffer, key: Buffer): Buffer {
        const cipher = crypto.createDecipheriv("aes-256-ecb", key, "");
        cipher.setAutoPadding(false);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }
    
    /**
     * Key Derivation Function
     * See: http://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-108.pdf
     */
    static kdf(algo: string, length: number, key: Buffer, options: string|KdfParams): Buffer {
        if (!options) {
            options = {};
        }
        if (typeof(options) === "string") {
            options = {label: options};
        }
        const counters = options.counters === false ? false : true;
        const feedback = options.feedback === false ? false : true;
        let seed = Buffer.alloc(0);
        const opt2buffer = (opt: Buffer|string|undefined) => {
            if (typeof(opt) === "string") {
                return Buffer.from(opt);
            }
            if (opt instanceof Buffer) {
                return opt;
            }
            return Buffer.alloc(0);
        };
        if (options.seed instanceof Buffer) {
            seed = options.seed;
        }
        else {
            const label = opt2buffer(options.label);
            const context = opt2buffer(options.context);
            seed = Buffer.alloc(label.length + context.length + 5);
            label.copy(seed);
            seed.writeUInt8(0, label.length);
            context.copy(seed, label.length + 1);
            seed.writeUInt32BE(length, label.length + context.length + 1);
        }
        let k = opt2buffer(options.iv);
        let result = Buffer.alloc(0);
        let i = 1;
        while (result.length < length) {
            let input = Buffer.alloc(0);
            if (feedback) {
                input = k;
            }
            if (counters) {
                const count = Buffer.alloc(4);
                count.writeUInt32BE(i++, 0);
                input = Buffer.concat([input, count]);
            }
            input = Buffer.concat([input, seed]);
            k = Crypto.hmac(algo, key, input);
            result = Buffer.concat([result, k]);
        }
        return result.slice(0, length);
    }
    
    static simpleKdf64Sha256(key: Buffer, label: string) {
        const length = 64;
        const algo = "sha256";
        
        // prepare seed
        const seed = Buffer.alloc(label.length + 5);
        Buffer.from(label).copy(seed);
        seed.writeUInt8(0, label.length);
        seed.writeUInt32BE(length, label.length + 1);
        
        // counter
        const count = Buffer.alloc(4);
        
        // round first
        count.writeUInt32BE(1, 0);
        const input1 = Buffer.concat([count, seed]);
        const result1 = Crypto.hmac(algo, key, input1);
        
        // round second
        count.writeUInt32BE(2, 0);
        const input2 = Buffer.concat([result1, count, seed]);
        const result2 = Crypto.hmac(algo, key, input2);
        
        return Buffer.concat([result1, result2]);
    }
    
    /**
     * TLS 1.2 key derivation function
     */
    static prf_tls12(key: Buffer, seed: Buffer, length: number): Buffer {
        let a = seed;
        let result = Buffer.alloc(0);
        while (result.length < length) {
            a = Crypto.hmacSha256(key, a);
            const d = Crypto.hmacSha256(key, Buffer.concat([a, seed]));
            result = Buffer.concat([result, d]);
        }
        return result.slice(0, length);
    }
    
    /**
     * Derives encryption and authentication keys from a given secret key
     */
    static getKEM(algo: string, key: Buffer, keLen: number = 32, kmLen: number = 32): {kE: Buffer, kM: Buffer} {
        const kEM = Crypto.kdf(algo, keLen + kmLen, key, "key expansion");
        return {
            kE: kEM.slice(0, keLen),
            kM: kEM.slice(keLen),
        };
    }
    
    /**
     * AES-256-CBC with PKCS7 padding and SHA-256 HMAC with NIST compatible KDF.
     */
    static aes256CbcHmac256Encrypt(data: Buffer, key32: Buffer, deterministic: boolean = false, tagLen: number = 16) {
        const kem = Crypto.getKEM("sha256", key32);
        const iv = deterministic ? Crypto.hmacSha256(key32, data).slice(16) : Crypto.randomBytes(16);
        // We prefix data with block of zeroes - and so from our IV we obtain E(IV) in first block.
        data = Buffer.concat([Buffer.alloc(16, 0), data]);
        const cipher = Crypto.aes256CbcPkcs7Encrypt(data, kem.kE, iv);
        const tag = Crypto.hmacSha256(kem.kM, cipher).slice(0, tagLen);
        return Buffer.concat([cipher, tag]);
    }
    
    /**
     * AES-256-CBC with PKCS7 padding and SHA-256 HMAC with NIST compatible KDF.
     */
    static aes256CbcHmac256Decrypt(data: Buffer, key32: Buffer, tagLen: number = 16): Buffer {
        const kem = Crypto.getKEM("sha256", key32);
        const tag = data.slice(data.length - tagLen);
        data = data.slice(0, data.length - tagLen);
        const rTag = Crypto.hmacSha256(kem.kM, data).slice(0, tagLen);
        if (!tag.equals(rTag)) {
            throw new Error("Wrong message security tag");
        }
        const iv = data.slice(0, 16);
        data = data.slice(16);
        return Crypto.aes256CbcPkcs7Decrypt(data, kem.kE, iv);
    }
    
    static genericSign(dataToSign: Buffer, privateKey: string) {
        const privKey = crypto.createPrivateKey(privateKey);
        return crypto.sign(null, dataToSign, privKey);
    }
    
    static genericVerify(dataToVerify: Buffer, publicKey: string, signature: Buffer) {
        const pubKey = crypto.createPublicKey(publicKey);
        return crypto.verify(null, dataToVerify, pubKey, signature);
    }
    
    static genKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
            publicKeyEncoding: {
                type: "spki",
                format: "pem",
            },
            privateKeyEncoding: {
                type: "pkcs8",
                format: "pem",
            },
        });
        return {publicKey, privateKey};
    }
    
    static isEd25519PEMPublicKey(pemPubKey: string) {
        try {
            const pubKey = crypto.createPublicKey(pemPubKey);
            return pubKey.type === "public" && pubKey.asymmetricKeyType === "ed25519";
        }
        catch {
            return false;
        }
    }
    
    static uuidv4() {
        return crypto.randomUUID();
    }
    
    static compressPublicKey(uncompressedKey: Uint8Array) {
        if (uncompressedKey.length !== 65 || uncompressedKey[0] !== 0x04) {
            throw new Error("Invalid uncompressed key format");
        }
        const ed25519 = new elliptic.ec("ed25519");
        const pub = ed25519.keyFromPublic(Buffer.from(uncompressedKey)).getPublic();
        return pub.encodeCompressed();
    }
}
