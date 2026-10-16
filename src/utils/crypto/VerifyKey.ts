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
    | {algorithm: "ed25519", raw: Buffer}
    /**
     * An identity that signs with Ed25519 and agrees keys with X25519, carried as one key:
     * `raw` is `ed25519(32) || x25519(32)`.
     *
     * It is one key because Ed25519 alone cannot be a user here — clients wrap container keys to a
     * member's public key by Diffie-Hellman, which Ed25519 has none of. The bridge only ever
     * verifies with the signing half; the agreement half is a client concern, stored and served
     * along with it so that an identity stays a single string.
     */
    | {algorithm: "ed25519x25519", raw: Buffer}
    /**
     * The same identity with a post-quantum half added: `raw` is
     * `ed25519(32) || x25519(32) || mlkem768(1184)`.
     *
     * The ML-KEM-768 half is what clients encapsulate container keys to, so that a wrapped key
     * recorded today cannot be opened later by a quantum computer. None of that reaches the bridge:
     * as with `ed25519x25519` only the signing half is ever used here, and the rest is carried along
     * so that an identity stays a single string.
     */
    | {algorithm: "ed25519x25519mlkem768", raw: Buffer};

export type VerifyKeyAlgorithm = VerifyKey["algorithm"];

/**
 * How an algorithm is named on the wire.
 *
 * Every key is `Base58Check(tag || rawKey)`. **A key without a known tag is refused** — there is no untagged
 * form and no guessing from length, so a key always says what it is and exactly one spelling of it exists.
 * That last part matters: a key is matched as a string (`ContextUserRepository.userPubKeyExists`), so two
 * spellings of one key would be two different users.
 *
 * Tags sit at 0x80 and above, where a SEC1 point prefix can never be (0x02/0x03 compressed, 0x04/0x06/0x07
 * uncompressed). Nothing depends on that any more now that untagged keys are refused outright — it is kept so
 * that a key in the old encoding fails loudly as an unknown tag, rather than being misread as some other
 * algorithm.
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

export const ED25519_TAG = 0x80;
/** secp256k1 as a 33-byte compressed point — the same bytes the untagged encoding carried, behind a tag. */
export const SECP256K1_TAG = 0x81;
/** Ed25519 signing half followed by X25519 agreement half, 32 bytes each. */
export const ED25519_X25519_TAG = 0x82;
/** Ed25519 signing half, X25519 agreement half, ML-KEM-768 encapsulation half: 32 + 32 + 1184. */
export const ED25519_X25519_MLKEM768_TAG = 0x83;
const ED25519_PUBLIC_LENGTH = 32;

const TAGGED_ALGORITHMS: TaggedAlgorithmSpec[] = [
    {algorithm: "ed25519", tag: ED25519_TAG, publicKeyLength: 32},
    {algorithm: "secp256k1", tag: SECP256K1_TAG, publicKeyLength: 33},
    {algorithm: "ed25519x25519", tag: ED25519_X25519_TAG, publicKeyLength: 64},
    {algorithm: "ed25519x25519mlkem768", tag: ED25519_X25519_MLKEM768_TAG, publicKeyLength: 1248},
];

/**
 * Reads a public key, picking the algorithm from the tag rather than assuming one.
 *
 * @returns null when the string carries no known tag, or is not a key this bridge can verify with
 */
export function publicVerifyKeyFromBase58(key: types.core.EccPubKey): VerifyKey|null {
    const decoded = Utils.try(() => Base58.decodeWithChecksum(key));
    if (decoded.success === false || decoded.result.length === 0) {
        return null;
    }
    const payload = decoded.result;
    const spec = TAGGED_ALGORITHMS.find(x => x.tag === payload[0]);
    if (!spec || payload.length !== 1 + spec.publicKeyLength) {
        return null;
    }
    const raw = payload.subarray(1);
    switch (spec.algorithm) {
        case "ed25519":
            return {algorithm: "ed25519", raw};
        case "ed25519x25519":
            return {algorithm: "ed25519x25519", raw};
        case "ed25519x25519mlkem768":
            return {algorithm: "ed25519x25519mlkem768", raw};
        case "secp256k1": {
            // Guarded: elliptic throws when the bytes are not a point on the curve.
            const ecc = Utils.try(() => elliptic.ec("secp256k1").keyFromPublic(raw.toString("hex"), "hex"));
            return ecc.success === true ? {algorithm: "secp256k1", ecc: ecc.result} : null;
        }
        default: {
            // Exhaustive by construction: `spec.algorithm` is a `VerifyKeyAlgorithm`, so a new row in
            // TAGGED_ALGORITHMS without a case here fails to compile instead of being refused at run
            // time as an unknown key — which is what happened when the post-quantum row was added.
            const unhandled: never = spec.algorithm;
            void unhandled;
            return null;
        }
    }
}

/** Wraps an already-parsed secp256k1 key, for callers that hold one for other reasons (ECDH). */
export function verifyKeyFromEcc(ecc: elliptic.ec.KeyPair): VerifyKey {
    return {algorithm: "secp256k1", ecc};
}

/**
 * The tagged encoding of a key the bridge holds parsed.
 *
 * Needed wherever the bridge produces a key string that is then compared against, or stored alongside, one a
 * client sent — a session's restore key, the identity derived from an `ecdhe`/`ecdhex` handshake. Both sides
 * have to spell a key the same way or the comparison silently fails.
 */
export function publicVerifyKeyToBase58(key: VerifyKey): types.core.EccPubKey {
    const raw = key.algorithm === "secp256k1"
        ? Buffer.from(key.ecc.getPublic(true, "hex"), "hex")
        : key.raw;
    const spec = TAGGED_ALGORITHMS.find(x => x.algorithm === key.algorithm);
    if (!spec || raw.length !== spec.publicKeyLength) {
        throw new Error("Cannot encode a public key of algorithm '" + key.algorithm + "'");
    }
    return <types.core.EccPubKey>Base58.encodeWithChecksum(Buffer.concat([Buffer.from([spec.tag]), raw]));
}

/** Shorthand for the common case: a secp256k1 key pair the bridge already holds. */
export function secp256k1ToBase58(ecc: elliptic.ec.KeyPair): types.core.EccPubKey {
    return publicVerifyKeyToBase58(verifyKeyFromEcc(ecc));
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
            case "ed25519":
            case "ed25519x25519":
            case "ed25519x25519mlkem768": {
                if (signature.length !== ED25519_SIGNATURE_LENGTH) {
                    return false;
                }
                // Only the signing half verifies. For a composed identity the other halves follow it
                // in `raw` and take no part here — the bridge never agrees or encapsulates a key.
                const signingHalf = key.raw.subarray(0, ED25519_PUBLIC_LENGTH);
                const pub = crypto.createPublicKey({
                    key: Buffer.concat([ED25519_SPKI_PREFIX, signingHalf]),
                    format: "der",
                    type: "spki",
                });
                return crypto.verify(null, message, pub, signature);
            }
            default: {
                // Exhaustive for the same reason as in `publicVerifyKeyFromBase58`: a new algorithm
                // left out here would silently fail to verify rather than fail to build.
                const unhandled: never = key;
                void unhandled;
                return false;
            }
        }
    });
    return verified.success === true && verified.result === true;
}
