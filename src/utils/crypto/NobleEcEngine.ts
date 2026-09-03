/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { EcEngine } from "./EcEngine";

/**
 * Default engine, backed by @noble/curves. This is the only place that imports a curve
 * library; an alternative engine just implements `EcEngine` and is installed via setEcEngine.
 */
export class NobleEcEngine implements EcEngine {
    randomPrivateKey(): Buffer {
        return Buffer.from(secp256k1.utils.randomSecretKey());
    }
    
    getPublicKey(priv32: Buffer, compressed: boolean): Buffer {
        return Buffer.from(secp256k1.getPublicKey(priv32, compressed));
    }
    
    pointToBytes(pub: Buffer, compressed: boolean): Buffer {
        return Buffer.from(secp256k1.Point.fromBytes(pub).toBytes(compressed));
    }
    
    pointsEqual(a: Buffer, b: Buffer): boolean {
        return secp256k1.Point.fromBytes(a).equals(secp256k1.Point.fromBytes(b));
    }
    
    sharedSecretX(priv32: Buffer, pub: Buffer): Buffer {
        // noble returns the 33-byte compressed shared point; strip the 0x02/0x03 prefix.
        return Buffer.from(secp256k1.getSharedSecret(priv32, pub, true).subarray(1));
    }
    
    sign(msgHash: Buffer, priv32: Buffer): { r: Buffer; s: Buffer; recovery: number } {
        const rec = secp256k1.sign(msgHash, priv32, { prehash: false, format: "recovered" });
        return {
            recovery: rec[0],
            r: Buffer.from(rec.subarray(1, 33)),
            s: Buffer.from(rec.subarray(33, 65)),
        };
    }
    
    verify(msgHash: Buffer, r: Buffer, s: Buffer, pub: Buffer): boolean {
        try {
            // Strict low-S verification (rejects malleable high-S signatures). Confirmed safe:
            // signing emits canonical low-S and existing peers do too.
            return secp256k1.verify(Buffer.concat([r, s]), msgHash, pub, { prehash: false, lowS: true });
        }
        catch {
            return false;
        }
    }
    
    recover(msgHash: Buffer, r: Buffer, s: Buffer, recovery: number): Buffer {
        const recBytes = Buffer.concat([Buffer.from([recovery]), r, s]);
        // recoverPublicKey operates on the digest directly (no prehashing), matching elliptic.
        const point = secp256k1.Signature.fromBytes(recBytes, "recovered").recoverPublicKey(msgHash);
        return Buffer.from(point.toBytes(false));
    }
}
