/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as elliptic from "elliptic";
import { Crypto } from "./Crypto";

export interface Options {
    noKey: boolean;
    shortTag: boolean;
}

export class ECIES {
    
    private pubKeyBuf: Buffer;
    private sharedKey: Buffer;
    private encryptionKey: Buffer;
    private kM: Buffer;
    
    constructor(
        public privateKey: elliptic.ec.KeyPair,
        public publicKey: elliptic.ec.KeyPair,
        public opts: Options = {noKey: true, shortTag: true}
    ) {
        this.privateKey = privateKey;
        this.publicKey = publicKey;
        this.opts = opts;
    }
    
    getPubKeyBuf(): Buffer {
        if (this.pubKeyBuf == null) {
            this.pubKeyBuf = Buffer.from(this.privateKey.getPublic().encodeCompressed());
        }
        return this.pubKeyBuf;
    }
    
    calculateSharedKey(): Buffer {
        const shared = this.privateKey.derive(this.publicKey.getPublic());
        const bin = Buffer.from(shared.toArray("be", 32));
        return Crypto.sha512(bin);
    }
    
    getSharedKey(): Buffer {
        if (this.sharedKey == null) {
            this.sharedKey = this.calculateSharedKey();
        }
        return this.sharedKey;
    }
    
    getEncryptionKey(): Buffer {
        if (this.encryptionKey == null) {
            this.encryptionKey = this.getSharedKey().slice(0, 32);
        }
        return this.encryptionKey;
    }
    
    getSignatureKey(): Buffer {
        if (this.kM == null) {
            this.kM = this.getSharedKey().slice(32, 64);
        }
        return this.kM;
    }
    
    getPrivateEncKey(): Buffer {
        let r = Buffer.from(this.privateKey.getPrivate("hex"), "hex");
        if (r.length < 32) {
            r = Buffer.concat([Buffer.alloc(32 - r.length).fill(0), r]);
        }
        return r;
    }
    
    encrypt(message: Buffer, ivBuf: Buffer = null): Buffer {
        if (ivBuf == null) {
            ivBuf = Crypto.hmacSha256(this.getPrivateEncKey(), message).slice(0, 16);
        }
        const c = Buffer.concat([ivBuf, Crypto.aes256CbcPkcs7Encrypt(message, this.getEncryptionKey(), ivBuf)]);
        let d = Crypto.hmacSha256(this.getSignatureKey(), c);
        if (this.opts.shortTag) {
            d = d.slice(0, 4);
        }
        let encBuf: Buffer;
        if (this.opts.noKey) {
            encBuf = Buffer.concat([c, d]);
        }
        else {
            encBuf = Buffer.concat([this.getPubKeyBuf(), c, d]);
        }
        return encBuf;
    }
    
    decrypt(encBuf: Buffer): Buffer {
        let offset = 0;
        let tagLength = 32;
        if (this.opts.shortTag) {
            tagLength = 4;
        }
        if (!this.opts.noKey) {
            offset = 33;
            // TODO WTF
            // this.publicKey = encBuf.slice(0, 33);
        }
        
        const c = encBuf.slice(offset, encBuf.length - tagLength);
        const d = encBuf.slice(encBuf.length - tagLength, encBuf.length);
        
        let d2 = Crypto.hmacSha256(this.getSignatureKey(), c);
        if (this.opts.shortTag) {
            d2 = d2.slice(0, 4);
        }
        
        let equal = true;
        for (let i = 0; i < d.length; i++) {
            equal = equal && (d[i] === d2[i]);
        }
        if (!equal) {
            throw new Error("Invalid checksum");
        }
        
        return Crypto.aes256CbcPkcs7Decrypt(c.slice(16), this.getEncryptionKey(), c.slice(0, 16));
    }
}