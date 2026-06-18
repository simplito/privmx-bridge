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
import { ECIES } from "./ECIES";
import { Logger } from "../../service/log/Logger";
import { EccKeyPair, setNativeEcProvider } from "./NobleEc";

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
        
        function serializePriv(key: EccKeyPair): Buffer {
            let r = Buffer.from(key.getPrivate("hex"), "hex");
            if (r.length < 32) {
                r = Buffer.concat([Buffer.alloc(32 - r.length).fill(0), r]);
            }
            return r;
        }
        
        function serializePub(key: EccKeyPair): Buffer {
            return key.getPublic().encode();
        }
        
        // Re-home secp256k1 acceleration onto the noble-backed adapter: instead of monkey-patching
        // elliptic's KeyPair.prototype (which no longer exists), register a provider the adapter's
        // sign/verify/derive consult before falling back to pure-JS noble.
        setNativeEcProvider({
            sign: (msg: Buffer, priv: Buffer) => {
                // PrivmxNative.sign -> 65 bytes: [27 + recovery, r(32), s(32)]
                const sig = PrivmxNative.sign(msg, priv) as Buffer;
                return { r: sig.subarray(1, 33), s: sig.subarray(33, 65), recovery: sig[0] - 27 };
            },
            verify: (msg: Buffer, sig: Buffer, pub: Buffer) => {
                // adapter passes 64-byte compact r||s + uncompressed pub; native wants a 65-byte sig
                const sig65 = Buffer.alloc(65, 0);
                sig65[0] = 0x1b;
                sig.copy(sig65, 1);
                return PrivmxNative.verify(msg, sig65, pub);
            },
            sharedKey: (priv: Buffer, pub: Buffer) => {
                // ECDH shared X coordinate (matches elliptic's derive)
                return PrivmxNative.derivePrivAndPub(priv, pub) as Buffer;
            },
        });
        
        // =====================
        //        ECIES
        // =====================
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesEncrypt = ECIES.prototype.encrypt;
        ECIES.prototype.encrypt = function(this: ECIES, encBuf: Buffer, ivBuf: Buffer|null = null): Buffer {
            if (this.privateKey.ec.curve === "secp256k1" && this.opts.noKey && this.opts.shortTag && ivBuf == null) {
                return PrivmxNative.ecies_encrypt(serializePriv(this.privateKey), serializePub(this.publicKey), encBuf);
            }
            return orgEciesEncrypt.call(this, encBuf, ivBuf as Buffer);
        };
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesDecrypt = ECIES.prototype.decrypt;
        ECIES.prototype.decrypt = function(this: ECIES, encBuf: Buffer): Buffer {
            if (this.privateKey.ec.curve === "secp256k1" && this.opts.noKey && this.opts.shortTag) {
                return PrivmxNative.ecies_decrypt(serializePriv(this.privateKey), serializePub(this.publicKey), encBuf);
            }
            return orgEciesDecrypt.call(this, encBuf);
        };
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesGetSharedKey = ECIES.prototype.calculateSharedKey;
        ECIES.prototype.calculateSharedKey = function(this: ECIES): Buffer {
            if (this.privateKey.ec.curve === "secp256k1") {
                return PrivmxNative.privPubShared(serializePriv(this.privateKey), serializePub(this.publicKey));
            }
            return orgEciesGetSharedKey.call(this);
        };
    }
    catch (e) {
        logger.error(e, "ERROR loading privmx-native");
    }
}
