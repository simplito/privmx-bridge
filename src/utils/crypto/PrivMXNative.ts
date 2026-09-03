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
import { EccKeyPair, NobleEcEngine, setEcEngine } from "./NobleEc";

/**
 * privmx-native secp256k1 engine: overrides the digest-signing operations with the native
 * addon and inherits everything else (keygen / public-key derivation / point encoding /
 * recovery) from the pure-JS noble engine — exactly the surface the addon does not provide.
 * Installed as the active EcEngine in init(); when the addon is absent the noble default stays.
 */
class PrivmxNativeEcEngine extends NobleEcEngine {
    constructor(private readonly addon: any) {
        super();
    }
    
    sign(msgHash: Buffer, priv32: Buffer): { r: Buffer; s: Buffer; recovery: number } {
        // addon.sign -> 65 bytes: [27 + recovery, r(32), s(32)]
        const sig = this.addon.sign(msgHash, priv32) as Buffer;
        return { r: sig.subarray(1, 33), s: sig.subarray(33, 65), recovery: sig[0] - 27 };
    }
    
    verify(msgHash: Buffer, r: Buffer, s: Buffer, pub: Buffer): boolean {
        // addon wants a 65-byte sig: [0x1b, r(32), s(32)] + uncompressed pub
        const sig65 = Buffer.alloc(65, 0);
        sig65[0] = 0x1b;
        Buffer.concat([r, s]).copy(sig65, 1);
        return this.addon.verify(msgHash, sig65, pub) as boolean;
    }
    
    sharedSecretX(priv32: Buffer, pub: Buffer): Buffer {
        // ECDH shared X coordinate (matches elliptic's derive)
        return this.addon.derivePrivAndPub(priv32, pub) as Buffer;
    }
}

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
        
        // Install native secp256k1 acceleration as the active EcEngine. The EccKeyPair facade
        // (and thus ECUtils / TLS / ECIES ECDH) routes sign/verify/derive through it; the rest
        setEcEngine(new PrivmxNativeEcEngine(PrivmxNative));
        
        // =====================
        //        ECIES
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
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesEncrypt = ECIES.prototype.encrypt;
        ECIES.prototype.encrypt = function(this: ECIES, encBuf: Buffer, ivBuf: Buffer|null = null): Buffer {
            if (this.opts.noKey && this.opts.shortTag && ivBuf == null) {
                return PrivmxNative.ecies_encrypt(serializePriv(this.privateKey), serializePub(this.publicKey), encBuf);
            }
            return orgEciesEncrypt.call(this, encBuf, ivBuf as Buffer);
        };
        
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const orgEciesDecrypt = ECIES.prototype.decrypt;
        ECIES.prototype.decrypt = function(this: ECIES, encBuf: Buffer): Buffer {
            if (this.opts.noKey && this.opts.shortTag) {
                return PrivmxNative.ecies_decrypt(serializePriv(this.privateKey), serializePub(this.publicKey), encBuf);
            }
            return orgEciesDecrypt.call(this, encBuf);
        };
        
    }
    catch (e) {
        logger.error(e, "ERROR loading privmx-native");
    }
}
