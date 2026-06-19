/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*
 * Engine-neutral secp256k1 key pair . It holds canonical
 * byte encodings (+ a bn.js private scalar) and delegates every curve operation to the
 * active engine. bn.js stays at this facade; only bytes reach the port.
 */

import * as BN from "bn.js";
import type { EccSignature, EllipticKeyLike } from "./EcEngine";
import { getEcEngine } from "./EcEngineRegistry";
import { EccPoint } from "./EccPoint";

function toBuf32(value: BN | Buffer | string): Buffer {
    if (Buffer.isBuffer(value)) {
        return value.length === 32 ? value : Buffer.concat([Buffer.alloc(32 - value.length, 0), value]);
    }
    if (typeof value === "string") {
        return Buffer.from(value.padStart(64, "0"), "hex");
    }
    return value.toArrayLike(Buffer, "be", 32);
}

export class EccKeyPair {
    
    /**
     * @param pub  canonical SEC1 uncompressed public key bytes
     * @param priv private scalar as a bn.js BN, or null for a public-only key
     */
    constructor(
        private readonly pub: Buffer,
        private readonly priv: BN | null,
    ) {}
    
    /** Generate a fresh random secp256k1 key pair. */
    static generate(): EccKeyPair {
        return EccKeyPair.fromPrivate(getEcEngine().randomPrivateKey());
    }
    
    static fromPrivate(priv: Buffer | string, enc?: string): EccKeyPair {
        const privBuf = typeof priv === "string" ? Buffer.from(priv, enc === "hex" || enc === undefined ? "hex" : enc as BufferEncoding) : priv;
        const priv32 = toBuf32(privBuf);
        const pub = getEcEngine().getPublicKey(priv32, false);
        return new EccKeyPair(Buffer.from(pub), new BN(priv32));
    }
    
    static fromPublic(pub: EccPoint | Buffer | string, enc?: string): EccKeyPair {
        if (pub instanceof EccPoint) {
            return new EccKeyPair(pub.rawBytes(), null);
        }
        const bytes = typeof pub === "string" ? Buffer.from(pub, enc === "hex" || enc === undefined ? "hex" : enc as BufferEncoding) : pub;
        // canonicalize to uncompressed (validates the point and accepts compressed input)
        return new EccKeyPair(getEcEngine().pointToBytes(bytes, false), null);
    }
    
    static fromElliptic(key: EllipticKeyLike): EccKeyPair {
        if (key.getPrivate() != null) {
            return EccKeyPair.fromPrivate(key.getPrivate("hex"), "hex");
        }
        return EccKeyPair.fromPublic(key.getPublic(false, "hex"), "hex");
    }
    
    getPublic(): EccPoint;
    getPublic(enc: "hex" | "binary"): string | Buffer;
    getPublic(compact: boolean, enc: "hex" | "binary"): string | Buffer;
    getPublic(a?: boolean | string, b?: string): EccPoint | string | Buffer {
        if (a === undefined) {
            return new EccPoint(this.pub);
        }
        let compact: boolean;
        let enc: string;
        if (typeof a === "string") {
            compact = false;
            enc = a;
        }
        else {
            compact = a;
            enc = b as string;
        }
        const bytes = getEcEngine().pointToBytes(this.pub, compact);
        if (enc === "hex") {
            return bytes.toString("hex");
        }
        if (enc === "binary") {
            return bytes;
        }
        throw new Error("Unsupported public key encoding: " + enc);
    }
    
    getPrivate(): BN | null;
    getPrivate(enc: "hex"): string;
    getPrivate(enc?: "hex"): BN | string | null {
        if (this.priv == null) {
            return null;
        }
        return enc === "hex" ? this.priv.toString("hex", 2) : this.priv;
    }
    
    private privBytes(): Buffer {
        if (this.priv == null) {
            throw new Error("KeyPair has no private key");
        }
        return this.priv.toArrayLike(Buffer, "be", 32);
    }
    
    /** ECDH: returns the shared secret X coordinate as a BN (matches elliptic's `derive`). */
    derive(pub: EccPoint): BN {
        return new BN(getEcEngine().sharedSecretX(this.privBytes(), pub.rawBytes()));
    }
    
    sign(msg: Buffer): EccSignature {
        const sig = getEcEngine().sign(msg, this.privBytes());
        return { r: new BN(sig.r), s: new BN(sig.s), recoveryParam: sig.recovery };
    }
    
    verify(msg: Buffer, sig: { r: BN | Buffer | string; s: BN | Buffer | string }): boolean {
        return getEcEngine().verify(msg, toBuf32(sig.r), toBuf32(sig.s), this.pub);
    }
}

/** Recover the public key (as a point) from a digest, signature, and recovery id (0..3). */
export function recoverPublicKey(msg: Buffer, sig: { r: BN | Buffer | string; s: BN | Buffer | string }, recoveryParam: number): EccPoint {
    const pub = getEcEngine().recover(msg, toBuf32(sig.r), toBuf32(sig.s), recoveryParam);
    return new EccPoint(Buffer.from(pub));
}
