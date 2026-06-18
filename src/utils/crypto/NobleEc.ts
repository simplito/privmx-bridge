/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */

/*
 * @noble/curves-backed adapter that mirrors the slice of the `elliptic`
 * `ec` / `KeyPair` / `Point` API this codebase relies on. Built in Phase 1 of
 * the elliptic -> @noble/curves migration (see ELLIPTIC_TO_NOBLE_MIGRATION.md).
 *
 * As of Phase 2 this is the secp256k1 engine for ECUtils / ECIES / TLS / nonce &
 * session login; privmx-native acceleration is registered via setNativeEcProvider().
 * Design constraints proven in Phase 0:
 *   - noble 2.x prehashes by default -> ALL sign/verify/recover calls pass
 *     `{ prehash: false }` because the callers already pass a hashed digest.
 *   - ECDH returns the 32-byte X coordinate as a bn.js BN, matching elliptic's
 *     `derive(...)` so downstream `.toString("hex", 2)` / `.toArray("be", 32)`
 *     code is untouched.
 *   - `verify` uses strict low-S (`lowS: true`); the legacy elliptic vectors are
 *     low-S, so this rejects only malleable high-S signatures.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as BN from "bn.js";

type NoblePoint = InstanceType<typeof secp256k1.Point>;

export interface EccSignature {
    r: BN;
    s: BN;
    recoveryParam: number;
}

/**
 * Optional native-acceleration provider (privmx-native). Registered in Phase 4.3;
 * `null` here means the pure-JS noble path is used. The byte contracts:
 *   - sign:      returns the raw r/s (32 bytes each, big-endian) + recovery id (0..3)
 *   - verify:    `sig` is the 64-byte compact r||s
 *   - sharedKey: returns the 32-byte big-endian ECDH X coordinate
 * Phase 4.3 finalizes and verifies the mapping onto privmx-native's functions.
 */
export interface NativeEcProvider {
    sign(msg: Buffer, priv: Buffer): { r: Buffer; s: Buffer; recovery: number };
    verify(msg: Buffer, sig: Buffer, pub: Buffer): boolean;
    sharedKey(priv: Buffer, pub: Buffer): Buffer;
}

let nativeProvider: NativeEcProvider | null = null;

export function setNativeEcProvider(provider: NativeEcProvider | null): void {
    nativeProvider = provider;
}

export function getNativeEcProvider(): NativeEcProvider | null {
    return nativeProvider;
}

function toBuf32(value: BN | Buffer | string): Buffer {
    if (Buffer.isBuffer(value)) {
        return value.length === 32 ? value : Buffer.concat([Buffer.alloc(32 - value.length, 0), value]);
    }
    if (typeof value === "string") {
        return Buffer.from(value.padStart(64, "0"), "hex");
    }
    return value.toArrayLike(Buffer, "be", 32);
}

export class EccPoint {
    constructor(private readonly point: NoblePoint) {}
    
    /** Uncompressed encoding: 0x04 || X || Y */
    encode(): Buffer {
        return Buffer.from(this.point.toBytes(false));
    }
    
    /** Compressed encoding: 0x02/0x03 || X */
    encodeCompressed(): Buffer {
        return Buffer.from(this.point.toBytes(true));
    }
    
    eq(other: EccPoint): boolean {
        return this.point.equals(other.point);
    }
    
    /** @internal */
    raw(): NoblePoint {
        return this.point;
    }
}

export class EccKeyPair {
    /** Back-reference to the curve, mirroring elliptic's `keyPair.ec`. */
    public readonly ec: Ec;
    
    constructor(
        private readonly point: NoblePoint,
        private readonly priv: BN | null,
        ecInstance: Ec,
    ) {
        this.ec = ecInstance;
    }
    
    getPublic(): EccPoint;
    getPublic(enc: "hex" | "binary"): string | Buffer;
    getPublic(compact: boolean, enc: "hex" | "binary"): string | Buffer;
    getPublic(a?: boolean | string, b?: string): EccPoint | string | Buffer {
        if (a === undefined) {
            return new EccPoint(this.point);
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
        const bytes = this.point.toBytes(compact);
        if (enc === "hex") {
            return Buffer.from(bytes).toString("hex");
        }
        if (enc === "binary") {
            return Buffer.from(bytes);
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
        const priv = this.privBytes();
        const pubBytes = Buffer.from(pub.raw().toBytes(false));
        if (nativeProvider) {
            return new BN(nativeProvider.sharedKey(priv, pubBytes));
        }
        const shared = secp256k1.getSharedSecret(priv, pubBytes, true);
        return new BN(Buffer.from(shared.subarray(1)));
    }
    
    sign(msg: Buffer): EccSignature {
        const priv = this.privBytes();
        if (nativeProvider) {
            const n = nativeProvider.sign(msg, priv);
            return { r: new BN(n.r), s: new BN(n.s), recoveryParam: n.recovery };
        }
        const rec = secp256k1.sign(msg, priv, { prehash: false, format: "recovered" });
        return {
            recoveryParam: rec[0],
            r: new BN(Buffer.from(rec.subarray(1, 33))),
            s: new BN(Buffer.from(rec.subarray(33, 65))),
        };
    }
    
    verify(msg: Buffer, sig: { r: BN | Buffer | string; s: BN | Buffer | string }): boolean {
        const compact = Buffer.concat([toBuf32(sig.r), toBuf32(sig.s)]);
        // Uncompressed encoding works for both the noble fallback and the privmx-native provider.
        const pubBytes = Buffer.from(this.point.toBytes(false));
        if (nativeProvider) {
            return nativeProvider.verify(msg, compact, pubBytes);
        }
        try {
            // Strict low-S verification (rejects malleable high-S signatures). Confirmed
            // safe: signing emits canonical low-S and existing peers do too.
            return secp256k1.verify(compact, msg, pubBytes, { prehash: false, lowS: true });
        }
        catch {
            return false;
        }
    }
}

export class Ec {
    /** Sentinel kept for parity with `elliptic`'s `key.ec.curve` comparisons (Phase 4.3). */
    readonly curve = "secp256k1";
    
    genKeyPair(): EccKeyPair {
        return this.keyFromPrivate(Buffer.from(secp256k1.utils.randomSecretKey()));
    }
    
    keyFromPrivate(priv: Buffer | string, enc?: string): EccKeyPair {
        const privBuf = typeof priv === "string" ? Buffer.from(priv, enc === "hex" || enc === undefined ? "hex" : enc as BufferEncoding) : priv;
        const priv32 = toBuf32(privBuf);
        const pub = secp256k1.getPublicKey(priv32, false);
        return new EccKeyPair(secp256k1.Point.fromBytes(pub), new BN(priv32), this);
    }
    
    keyFromPublic(pub: EccPoint | Buffer | string, enc?: string): EccKeyPair {
        if (pub instanceof EccPoint) {
            return new EccKeyPair(pub.raw(), null, this);
        }
        const bytes = typeof pub === "string" ? Buffer.from(pub, enc === "hex" || enc === undefined ? "hex" : enc as BufferEncoding) : pub;
        return new EccKeyPair(secp256k1.Point.fromBytes(bytes), null, this);
    }
    
    keyPair(opts: { priv?: Buffer | string; privEnc?: string; pub?: Buffer | string; pubEnc?: string }): EccKeyPair {
        if (opts.priv != null) {
            return this.keyFromPrivate(opts.priv, opts.privEnc);
        }
        if (opts.pub != null) {
            return this.keyFromPublic(opts.pub, opts.pubEnc);
        }
        throw new Error("keyPair requires priv or pub");
    }
    
    recoverPubKey(msg: Buffer, sig: { r: BN | Buffer | string; s: BN | Buffer | string }, recoveryParam: number): EccPoint {
        const recBytes = Buffer.concat([Buffer.from([recoveryParam]), toBuf32(sig.r), toBuf32(sig.s)]);
        // recoverPublicKey operates on the digest directly (no prehashing), matching elliptic.
        const point = secp256k1.Signature.fromBytes(recBytes, "recovered").recoverPublicKey(msg);
        return new EccPoint(point);
    }
    
    /**
     * Bridge a key produced by the elliptic-backed `privmx-pki2` dependency into an
     * adapter key (read-only extraction; no elliptic import needed). Used at the pki
     * boundaries (server keystore) until pki2 itself is migrated (Phase 5).
     */
    fromElliptic(key: EllipticKeyLike): EccKeyPair {
        if (key.getPrivate() != null) {
            return this.keyFromPrivate(key.getPrivate("hex"), "hex");
        }
        return this.keyFromPublic(key.getPublic(false, "hex"), "hex");
    }
}

/** The slice of the elliptic `KeyPair` surface needed to bridge a pki2 key into the adapter. */
export interface EllipticKeyLike {
    getPrivate(): unknown;
    getPrivate(enc: "hex"): string;
    getPublic(compact: boolean, enc: "hex"): string;
}

const secp256k1Ec = new Ec();

/** Mirrors `elliptic.ec(curve)`. Only secp256k1 is supported (the only curve used for these ops). */
export function ec(curve: string = "secp256k1"): Ec {
    if (curve !== "secp256k1") {
        throw new Error("NobleEc only supports secp256k1 (requested: " + curve + ")");
    }
    return secp256k1Ec;
}
