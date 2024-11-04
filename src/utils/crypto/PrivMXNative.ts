/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

// import type * as PrivmxNativeType from "privmx-native";
import * as bs58 from "bs58";
import * as bs58check from "bs58check";
import * as elliptic from "elliptic";
import * as BN from "bn.js";
import { ECIES } from "./ECIES";
import { Logger } from "../../service/log/LoggerFactory";
import { ECUtils } from "./ECUtils";

export function init(logger: Logger) {
    try {
        // eslint-disable-next-line
        const PrivmxNative = /* <typeof PrivmxNativeType> */require("privmx-native");
        
        // =====================
        //       BASE58
        // =====================
        
        // Hacking bs58 & bs58check - just overwrite their functions with privmx-native
        (<any>bs58).decode = PrivmxNative.base58_decode;
        (<any>bs58).encode = PrivmxNative.base58_encode;
        (<any>bs58check).decode = PrivmxNative.base58check_decode;
        (<any>bs58check).encode = PrivmxNative.base58check_encode;
            
        // =====================
        //         ECC
        // =====================
        
        function serializePriv(key: elliptic.ec.KeyPair): Buffer {
            let r = Buffer.from(key.getPrivate("hex"), "hex");
            if (r.length < 32) {
                r = Buffer.concat([Buffer.alloc(32 - r.length).fill(0), r]);
            }
            return r;
        }
        
        function serializePub(key: elliptic.ec.KeyPair): Buffer {
            return serializePubPoint(key.getPublic());
        }
        
        function serializePubPoint(point: elliptic.curve.base.BasePoint): Buffer {
            return Buffer.from(point.encode());
        }
        
        // Hacking elliptic - get KeyPair class
        const secp256k1 = elliptic.ec("secp256k1");
        const emptyKeyPair = secp256k1.keyPair({});
        const KeyPair = emptyKeyPair.constructor;
        
        // Hacking elliptic public key import when pb is compressed - just decompress it in privmx-native and then use in org importer
        const orgKeyPairImportPublic = KeyPair.prototype._importPublic;
        KeyPair.prototype._importPublic = function(this: typeof emptyKeyPair, key: Buffer|string, enc?: string|number): void {
            if (this.ec.curve == secp256k1.curve && typeof(enc) == "undefined" && Buffer.isBuffer(key) && key[0] != 4) {
                const uncompressed = PrivmxNative.uncompressPub(key);
                return orgKeyPairImportPublic.call(this, uncompressed);
            }
            else if (this.ec.curve == secp256k1.curve && typeof(key) == "string" && (enc == "hex" || enc == 16) && !key.startsWith("04")) {
                const uncompressed = PrivmxNative.uncompressPub(Buffer.from(key, "hex"));
                return orgKeyPairImportPublic.call(this, uncompressed);
            }
            return orgKeyPairImportPublic.call(this, key, enc);
        };
        
        // Hacking elliptic public key calculation - just calc it in privmx-native and call org function
        const orgKeyPairGetPublic = KeyPair.prototype.getPublic;
        KeyPair.prototype.getPublic = function(this: typeof emptyKeyPair, compact: boolean, enc: string): void {
            if (this.ec.curve == secp256k1.curve && !this.pub) {
                const serializedPriv = serializePriv(this);
                const uncompressPub = PrivmxNative.pubFromPriv(serializedPriv);
                (this as any)._importPublic(uncompressPub);
            }
            return orgKeyPairGetPublic.call(this, compact, enc);
        };
        
        const orgKeyPairDerive = KeyPair.prototype.derive;
        KeyPair.prototype.derive = function(this: typeof emptyKeyPair, pub: elliptic.curve.base.BasePoint): BN {
            if (this.ec.curve == secp256k1.curve && pub) {
                const bn = PrivmxNative.derivePrivAndPub(serializePriv(this), serializePubPoint(pub));
                return new BN(bn, "be");
            }
            return orgKeyPairDerive.call(this, pub);
        };
        
        const orgKeyPairSign = KeyPair.prototype.sign;
        KeyPair.prototype.sign = function(this: typeof emptyKeyPair, msg: BN.ConvertibleToBN, enc?: string, options?: elliptic.ec.SignOptions): elliptic.ec.Signature {
            if (this.ec.curve == secp256k1.curve && Buffer.isBuffer(msg) && !enc && !options) {
                const signature = PrivmxNative.sign(msg, serializePriv(this));
                return {
                    r: new BN(signature.slice(1, 33), "be"),
                    s: new BN(signature.slice(33), "be")
                };
            }
            return orgKeyPairSign.call(this, msg, enc, options);
        };
        
        function isValidBNBuffer(data: BN.ConvertibleToBN): data is Buffer|string|BN {
            return Buffer.isBuffer(data) || typeof(data) == "string" || BN.isBN(<any>data);
        }
        
        function getBufferFromBN(data: Buffer|string|BN) {
            return Buffer.isBuffer(data) ? data : (typeof(data) == "string" ? Buffer.from(data, "hex") : Buffer.from(data.toArray("be", 32)));
        }
        
        function getBufferFromBN32(data: Buffer|string|BN) {
            const buf = getBufferFromBN(data);
            if (buf.length == 32) {
                return buf;
            }
            const res = Buffer.alloc(32, 0);
            buf.copy(res, 32 - data.length);
            return res;
        }
        
        const orgKeyPairVerify = KeyPair.prototype.verify;
        KeyPair.prototype.verify = function(this: typeof emptyKeyPair, msg: BN.ConvertibleToBN, signature: elliptic.ec.ConvertibleToSignature): boolean {
            if (this.ec.curve == secp256k1.curve && isValidBNBuffer(msg) && typeof(signature) == "object" && !Buffer.isBuffer(signature) &&
                isValidBNBuffer(signature.r) && isValidBNBuffer(signature.s)) {
                const theMsg = getBufferFromBN(msg);
                const r = getBufferFromBN32(signature.r);
                const s = getBufferFromBN32(signature.s);
                const sig = Buffer.alloc(65, 0);
                sig[0] = 0x1B;
                r.copy(sig, 1);
                s.copy(sig, 33);
                return PrivmxNative.verify(theMsg, sig, serializePub(this));
            }
            return orgKeyPairVerify.call(this, msg, signature);
        };
        
        // =====================
        //        EC_UTILS
        // =====================
        
        const orgSignToCompactSignature = ECUtils.signToCompactSignature;
        ECUtils.signToCompactSignature = function(this: ECUtils, key: elliptic.ec.KeyPair, message: Buffer): Buffer {
            if (key.ec.curve == secp256k1.curve) {
                return PrivmxNative.sign(message, serializePriv(key));
            }
            return orgSignToCompactSignature.call(ECUtils, key, message);
        };
        
        const orgVerifySignature = ECUtils.verifySignature;
        ECUtils.verifySignature = function(this: ECUtils, pubkey: elliptic.ec.KeyPair, signature: Buffer, data: Buffer): boolean {
            if (pubkey.ec.curve == secp256k1.curve) {
                return PrivmxNative.verify(data, signature, serializePub(pubkey));
            }
            return orgVerifySignature.call(ECUtils, pubkey, signature, data);
        };
        
        // =====================
        //        ECIES
        // =====================
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesEncrypt = ECIES.prototype.encrypt;
        ECIES.prototype.encrypt = function(this: ECIES, encBuf: Buffer, ivBuf: Buffer = null): Buffer {
            if (this.privateKey.ec.curve == secp256k1.curve && this.opts.noKey && this.opts.shortTag && ivBuf == null) {
                return PrivmxNative.ecies_encrypt(serializePriv(this.privateKey), serializePub(this.publicKey), encBuf);
            }
            return orgEciesEncrypt.call(this, encBuf, ivBuf);
        };
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesDecrypt = ECIES.prototype.decrypt;
        ECIES.prototype.decrypt = function(this: ECIES, encBuf: Buffer): Buffer {
            if (this.privateKey.ec.curve == secp256k1.curve && this.opts.noKey && this.opts.shortTag) {
                return PrivmxNative.ecies_decrypt(serializePriv(this.privateKey), serializePub(this.publicKey), encBuf);
            }
            return orgEciesDecrypt.call(this, encBuf);
        };
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesGetSharedKey = ECIES.prototype.calculateSharedKey;
        ECIES.prototype.calculateSharedKey = function(this: ECIES): Buffer {
            if (this.privateKey.ec.curve == secp256k1.curve) {
                return PrivmxNative.privPubShared(serializePriv(this.privateKey), serializePub(this.publicKey));
            }
            return orgEciesGetSharedKey.call(this);
        };
    }
    catch (e) {
        logger.error("ERROR loading privmx-native", e);
    }
}
