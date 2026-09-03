/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*
 * The swappable secp256k1 port.
 *
 * `EcEngine` is the seam between the codebase and whichever curve library backs it:
 * bytes in, bytes out — no bn.js and no library objects cross it, so the backing
 * library is replaceable in one place (see `NobleEcEngine` for the default adapter
 * and `EcEngineRegistry` for installing alternatives).
 *
 * Invariants every engine MUST preserve (proven by the EC golden vectors):
 *   - callers pass an already-hashed digest, so sign/verify/recover do NOT prehash;
 *   - signatures are strict low-S (malleable high-S is rejected);
 *   - ECDH yields the 32-byte big-endian X coordinate.
 */

import type * as BN from "bn.js";

export interface EccSignature {
    r: BN;
    s: BN;
    recoveryParam: number;
}

/**
 * The swappable secp256k1 engine. All inputs/outputs are raw bytes (big-endian where
 * applicable) so no detail of the backing library leaks to callers. Public keys are SEC1
 * point encodings (0x04||X||Y uncompressed, 0x02/0x03||X compressed); private keys are
 * 32-byte big-endian scalars; r/s are 32-byte big-endian.
 */
export interface EcEngine {
    /** Fresh random 32-byte private scalar. */
    randomPrivateKey(): Buffer;
    /** Public key for a private scalar, SEC1-encoded. */
    getPublicKey(priv32: Buffer, compressed: boolean): Buffer;
    /** Re-encode a SEC1 public key (validates and (de)compresses). */
    pointToBytes(pub: Buffer, compressed: boolean): Buffer;
    /** Curve-point equality for two SEC1 public keys. */
    pointsEqual(a: Buffer, b: Buffer): boolean;
    /** ECDH shared secret — the 32-byte X coordinate only. */
    sharedSecretX(priv32: Buffer, pub: Buffer): Buffer;
    /** Sign a digest (NO prehash, low-S). Returns raw r/s + recovery id (0..3). */
    sign(msgHash: Buffer, priv32: Buffer): { r: Buffer; s: Buffer; recovery: number };
    /** Verify a digest against r/s and a SEC1 public key (NO prehash, low-S). */
    verify(msgHash: Buffer, r: Buffer, s: Buffer, pub: Buffer): boolean;
    /** Recover the SEC1 (uncompressed) public key from a digest, r/s and recovery id. */
    recover(msgHash: Buffer, r: Buffer, s: Buffer, recovery: number): Buffer;
}

/** The slice of the elliptic `KeyPair` surface needed to bridge a pki2 key into the adapter. */
export interface EllipticKeyLike {
    getPrivate(): unknown;
    getPrivate(enc: "hex"): string;
    getPublic(compact: boolean, enc: "hex"): string;
}
