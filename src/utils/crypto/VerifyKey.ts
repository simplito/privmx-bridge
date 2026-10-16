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
import { Base58 } from "./Base58";
import { ECUtils } from "./ECUtils";
import * as types from "../../types";
import { Utils } from "../Utils";

/**
 * A public key in its **credential** role: something the bridge verifies a signature with.
 *
 * This is deliberately separate from the key's **identifier** role (stored on a context user, wrapped to by
 * clients, compared as a string). An identifier only has to be a bounded, stable string, so it can be opaque
 * to the bridge. A credential cannot: the bridge has to know which algorithm to verify under, so every
 * algorithm it accepts needs an entry here.
 *
 * Adding an algorithm is one row in `TAGGED_ALGORITHMS` plus one branch in `verifySignature`.
 */
export type VerifyKey =
    | {algorithm: "secp256k1", ecc: elliptic.ec.KeyPair}
    | {algorithm: "ed25519", raw: Buffer};

export type VerifyKeyAlgorithm = VerifyKey["algorithm"];

/**
 * How an algorithm is named on the wire.
 *
 * secp256k1 keys stay in their existing, **untagged** encoding — `Base58Check(compressed point)`, whose first
 * payload byte is a SEC1 prefix (0x02/0x03 compressed, 0x04/0x06/0x07 uncompressed). Every other algorithm is
 * `Base58Check(tag || rawKey)` with a tag at 0x80 or above, so it can never be mistaken for a point prefix and
 * a reader can tell the two apart from the first byte alone.
 *
 * Note what this rules out on purpose: there is **no** tagged spelling of a secp256k1 key. A key is matched by
 * its encoding (`ContextUserRepository.userPubKeyExists` is a string lookup), so two spellings of one key would
 * be two different users.
 */
interface TaggedAlgorithmSpec {
    algorithm: VerifyKeyAlgorithm;
    /** First byte of the Base58Check payload. Must be >= 0x80. */
    tag: number;
    /** Length of the raw public key that follows the tag. */
    publicKeyLength: number;
}

/** SPKI wrapper for a raw Ed25519 public key: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING }. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_SIGNATURE_LENGTH = 64;
/** Compact recoverable ECDSA: `[recovery byte][r 32][s 32]`. */
const SECP256K1_SIGNATURE_LENGTH = 65;

const TAGGED_ALGORITHMS: TaggedAlgorithmSpec[] = [
    {algorithm: "ed25519", tag: 0x80, publicKeyLength: 32},
];

/**
 * Reads a public key, picking the algorithm from the encoding rather than assuming one.
 *
 * @returns null when the string is not a key this bridge can verify with
 */
export function publicVerifyKeyFromBase58(key: types.core.EccPubKey): VerifyKey|null {
    const decoded = Utils.try(() => Base58.decodeWithChecksum(key));
    if (decoded.success === false || decoded.result.length === 0) {
        return null;
    }
    const payload = decoded.result;
    const spec = TAGGED_ALGORITHMS.find(x => x.tag === payload[0]);
    if (!spec) {
        // Untagged, so secp256k1. Delegated rather than re-decoded here, to keep one definition of what
        // counts as a valid point.
        const ecc = Utils.try(() => ECUtils.publicFromBase58DER(key));
        return ecc.success === true && ecc.result !== null ? {algorithm: "secp256k1", ecc: ecc.result} : null;
    }
    if (payload.length !== 1 + spec.publicKeyLength) {
        return null;
    }
    switch (spec.algorithm) {
        case "ed25519":
            return {algorithm: "ed25519", raw: payload.subarray(1)};
        default:
            return null;
    }
}

/** Wraps an already-parsed secp256k1 key, for callers that hold one for other reasons (ECDH). */
export function verifyKeyFromEcc(ecc: elliptic.ec.KeyPair): VerifyKey {
    return {algorithm: "secp256k1", ecc};
}

/**
 * Verifies a signature under the key's own algorithm.
 *
 * `message` is the same bytes for every algorithm — `NonceService.getMessage` produces a SHA-256 digest and
 * each algorithm signs that digest. For secp256k1 this is ECDSA over the digest (the endpoint's
 * `SigScheme::Compact`); for Ed25519 it is a plain Ed25519 signature over those 32 bytes.
 *
 * A signature that does not match its key's algorithm is **refused, never thrown out of** — the input is
 * whatever a client sent. Both branches are guarded, because the underlying verifiers do not agree on that:
 * `ECUtils.verifySignature` checks the length itself, but `PrivMXNative` replaces it with a native call that
 * does not, and throws on a malformed signature instead of returning false.
 */
export function verifySignature(key: VerifyKey, signature: Buffer, message: Buffer): boolean {
    const verified = Utils.try(() => {
        switch (key.algorithm) {
            case "secp256k1":
                return signature.length === SECP256K1_SIGNATURE_LENGTH &&
                    ECUtils.verifySignature(key.ecc, signature, message);
            case "ed25519": {
                if (signature.length !== ED25519_SIGNATURE_LENGTH) {
                    return false;
                }
                const pub = crypto.createPublicKey({
                    key: Buffer.concat([ED25519_SPKI_PREFIX, key.raw]),
                    format: "der",
                    type: "spki",
                });
                return crypto.verify(null, message, pub, signature);
            }
            default:
                return false;
        }
    });
    return verified.success === true && verified.result === true;
}
