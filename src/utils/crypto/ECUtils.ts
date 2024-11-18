/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as elliptic from "elliptic";
import { Base58 } from "./Base58";
import { Crypto } from "./Crypto";
import * as types from "../../types";
import { Base64 } from "../Base64";
import * as pki from "privmx-pki2";
import { Utils } from "../Utils";

export class ECUtils {
    
    static generateKeyPair() {
        const keyPair = pki.common.keystore.EccKeyPair.generate().keyPair;
        return {
            keyPair,
            pub58: ECUtils.publicToBase58DER(keyPair),
            privWif: ECUtils.toWIF(keyPair),
        };
    }
    
    static generateKeystore(domain: string): string {
        const keyPair = pki.common.keystore.EccKeyPair.generate();
        keyPair.timestamp = Math.floor(Date.now() / 1000);
        const keystore = pki.common.keystore.KeyStore.createFromKeyPair(domain, keyPair);
        return keystore.serializeWithArmor();
    }
    
    static generateRandom(curve: string = "secp256k1"): elliptic.ec.KeyPair {
        const ec = elliptic.ec(curve);
        return ec.genKeyPair();
    }
    
    static toPublic(keyPair: elliptic.ec.KeyPair): elliptic.ec.KeyPair {
        const hex = keyPair.getPublic(true, "hex");
        return keyPair.ec.keyFromPublic(hex, "hex");
    }
    
    static fromWIF(wif: types.core.EccWif, curve: string = "secp256k1"): elliptic.ec.KeyPair|null {
        const payloadResult = Utils.try(() => Base58.decodeWithChecksum(wif));
        if (payloadResult.success === false) {
            return null;
        }
        let payload = payloadResult.result.slice(1);
        if (payload.length === 33) {
            if (payload[32] != 0x01) {
                return null; // "Invalid compression flag"
            }
            payload = payload.slice(0, -1);
        }
        if (payload.length != 32) {
            return null; // "Invalid WIF payload length"
        }
        const ec = elliptic.ec(curve);
        return ec.keyFromPrivate(payload);
    }
    
    static toWIF(keyPair: elliptic.ec.KeyPair, network = "80", compressed = true): types.core.EccWif {
        let priv = network + keyPair.getPrivate("hex").padStart(64, "0");
        if (compressed) {
            priv += "01";
        }
        return <types.core.EccWif>Base58.encodeWithChecksum(Buffer.from(priv, "hex"));
    }
    
    static publicFromBase58DER(base58: types.core.EccPubKey, curve: string = "secp256k1"): elliptic.ec.KeyPair|null {
        const result = Utils.try(() => Base58.decodeWithChecksum(base58));
        if (result.success === false || result.result.length === 0) {
            return null;
        }
        const ec = elliptic.ec(curve);
        return ec.keyFromPublic(result.result.toString("hex"), "hex");
    }
    
    static publicToBase58DER(keyPair: elliptic.ec.KeyPair, compressed: boolean = true): types.core.EccPubKey {
        const hex = keyPair.getPublic(compressed, "hex");
        return <types.core.EccPubKey>Base58.encodeWithChecksum(Buffer.from(hex, "hex"));
    }
    
    static validateAddress(address: types.core.EccAddress, network: string = "00"): boolean {
        const networkBin = Buffer.from(network, "hex");
        if (networkBin == null || networkBin.length != 1) {
            return false;
        }
        const bin = Utils.try(() => Base58.decodeWithChecksum(address));
        return bin.success === true && bin.result !== null && bin.result.length == 21 && bin.result[0] == networkBin[0];
    }
    
    static verifySignature(pubkey: elliptic.ec.KeyPair, signature: Buffer, data: Buffer): boolean {
        if (signature.length != 65) {
            return false;
        }
        const r = signature.slice(1, 33).toString("hex");
        const s = signature.slice(33).toString("hex");
        return pubkey.verify(data.toString("hex"), {r: r, s: s});
    }
    
    static verifySignature2(pubkey: types.core.EccPubKey, signature: types.core.EccSignature, data: Buffer): boolean {
        const pub = ECUtils.publicFromBase58DER(pubkey);
        return !!pub && ECUtils.verifySignature(pub, Base64.toBuf(signature), data);
    }
    
    static verifySignature3(pubkey: elliptic.ec.KeyPair, signature: types.core.EccSignature, data: Buffer): boolean {
        return ECUtils.verifySignature(pubkey, Base64.toBuf(signature), data);
    }
    
    static toBase58Address(key: elliptic.ec.KeyPair, network: string = "00"): types.core.EccAddress|null {
        const networkBin = Buffer.from(network, "hex");
        if (networkBin == null || networkBin.length != 1) {
            return null;
        }
        const data = Buffer.from(key.getPublic(true, "hex"), "hex");
        const hash160 = Crypto.hash160(data);
        return <types.core.EccAddress>Base58.encodeWithChecksum(Buffer.concat([networkBin, hash160]));
    }
    
    static signToCompactSignature(key: elliptic.ec.KeyPair, message: Buffer): Buffer {
        const sign = <elliptic.ec.Signature&{recoveryParam: number}>key.sign(message);
        let compact = (27 + sign.recoveryParam).toString(16);
        compact += sign.r.toString("hex").padStart(64, "0");
        compact += sign.s.toString("hex").padStart(64, "0");
        return Buffer.from(compact, "hex");
    }
    
    static recoveryPubKey(message: Buffer, signature: Buffer, curve: string = "secp256k1") {
        if (signature.length != 65) {
            throw new Error("Invalid signature buffer");
        }
        const ec = elliptic.ec(curve);
        const sig = {
            r: signature.slice(1, 33).toString("hex"),
            s: signature.slice(33).toString("hex")
        };
        const recoveryParam = ECUtils.getRecoveryParam(signature[0]);
        const pubPoint = (<any>ec).recoverPubKey(message, sig, recoveryParam);
        return ec.keyFromPublic(pubPoint);
    }
    
    private static getRecoveryParam(value: number) {
        if (value >= 27 && value <= 30) {
            return value - 27;
        }
        if (value >= 31 && value <= 34) {
            return value - 31;
        }
        if (value >= 35 && value <= 38) {
            return value - 35;
        }
        if (value >= 39 && value <= 42) {
            return value - 39;
        }
        throw new Error("Invalid recovery param value");
    }
}
