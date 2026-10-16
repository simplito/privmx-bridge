/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as crypto from "crypto";
import { Base58 } from "../../utils/crypto/Base58";
import { Crypto } from "../../utils/crypto/Crypto";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { ED25519_TAG, ED25519_X25519_TAG, ED25519_X25519_MLKEM768_TAG, SECP256K1_TAG, publicVerifyKeyFromBase58, publicVerifyKeyToBase58,
    secp256k1ToBase58, verifyKeyFromEcc, verifySignature } from "../../utils/crypto/VerifyKey";
import * as types from "../../types";

function ed25519Keys() {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    // An SPKI export is a 12-byte header then the 32 raw bytes.
    const raw = publicKey.export({format: "der", type: "spki"}).subarray(12);
    const base58 = <types.core.EccPubKey>Base58.encodeWithChecksum(Buffer.concat([Buffer.from([ED25519_TAG]), raw]));
    return {privateKey, raw, base58};
}

// The message is produced the same way for every algorithm: NonceService hands each one a SHA-256 digest.
const MESSAGE = Crypto.sha256(Buffer.from("ecdhexlogin abc 1700000000", "utf8"));

it("VerifyKey: a tagged secp256k1 key round-trips and its signature verifies", () => {
    const keyPair = ECUtils.generateRandom();
    const base58 = secp256k1ToBase58(keyPair);
    
    const key = publicVerifyKeyFromBase58(base58);
    expect(key).not.toBeNull();
    expect(key?.algorithm).toBe("secp256k1");
    expect(publicVerifyKeyToBase58(key!)).toBe(base58);
    
    const signature = ECUtils.signToCompactSignature(keyPair, MESSAGE);
    expect(verifySignature(key!, signature, MESSAGE)).toBeTruthy();
    expect(verifySignature(verifyKeyFromEcc(keyPair), signature, MESSAGE)).toBeTruthy();
});

// The whole reason the bridge can require a tag: there is exactly one spelling of a key, so the string
// comparisons it is matched by (`userPubKeyExists`, a session's restore key) cannot miss.
it("VerifyKey: the old untagged encoding is refused, not guessed at", () => {
    const keyPair = ECUtils.generateRandom();
    const untagged = ECUtils.publicToBase58DER(keyPair);
    
    expect(publicVerifyKeyFromBase58(untagged)).toBeNull();
    expect(untagged).not.toBe(secp256k1ToBase58(keyPair));
});

it("VerifyKey: a secp256k1 signature over another message is refused", () => {
    const keyPair = ECUtils.generateRandom();
    const key = publicVerifyKeyFromBase58(secp256k1ToBase58(keyPair))!;
    const signature = ECUtils.signToCompactSignature(keyPair, MESSAGE);
    
    expect(verifySignature(key, signature, Crypto.sha256(Buffer.from("other", "utf8")))).toBeFalsy();
});

it("VerifyKey: a tagged key is read as Ed25519 and its signature verifies", () => {
    const {privateKey, base58} = ed25519Keys();
    
    const key = publicVerifyKeyFromBase58(base58);
    expect(key).not.toBeNull();
    expect(key?.algorithm).toBe("ed25519");
    
    const signature = crypto.sign(null, MESSAGE, privateKey);
    expect(signature.length).toBe(64);
    expect(verifySignature(key!, signature, MESSAGE)).toBeTruthy();
});

it("VerifyKey: an Ed25519 signature over another message, or from another key, is refused", () => {
    const {privateKey, base58} = ed25519Keys();
    const key = publicVerifyKeyFromBase58(base58)!;
    const signature = crypto.sign(null, MESSAGE, privateKey);
    
    expect(verifySignature(key, signature, Crypto.sha256(Buffer.from("other", "utf8")))).toBeFalsy();
    
    const other = ed25519Keys();
    expect(verifySignature(publicVerifyKeyFromBase58(other.base58)!, signature, MESSAGE)).toBeFalsy();
});

// The two roles must not be confusable: a signature is only ever checked under the algorithm its own key
// names, so a signature of the wrong shape is refused rather than fed to the wrong verifier.
it("VerifyKey: a signature of the wrong algorithm's length is refused", () => {
    const {privateKey, base58} = ed25519Keys();
    const ed25519 = publicVerifyKeyFromBase58(base58)!;
    const keyPair = ECUtils.generateRandom();
    const secp256k1 = publicVerifyKeyFromBase58(secp256k1ToBase58(keyPair))!;
    
    const ed25519Signature = crypto.sign(null, MESSAGE, privateKey);
    const secp256k1Signature = ECUtils.signToCompactSignature(keyPair, MESSAGE);
    expect(ed25519Signature.length).toBe(64);
    expect(secp256k1Signature.length).toBe(65);
    
    expect(verifySignature(ed25519, secp256k1Signature, MESSAGE)).toBeFalsy();
    expect(verifySignature(secp256k1, ed25519Signature, MESSAGE)).toBeFalsy();
});

it("VerifyKey: a tagged key of the wrong length is refused", () => {
    for (const length of [31, 33]) {
        const payload = Buffer.concat([Buffer.from([ED25519_TAG]), Buffer.alloc(length, 7)]);
        const base58 = <types.core.EccPubKey>Base58.encodeWithChecksum(payload);
        expect(publicVerifyKeyFromBase58(base58)).toBeNull();
    }
});

// A tag names an algorithm; it does not excuse the bytes behind it from being a key.
it("VerifyKey: a correctly tagged key whose bytes are not a point is refused", () => {
    const payload = Buffer.concat([Buffer.from([SECP256K1_TAG, 0x02]), Buffer.alloc(32, 0xff)]);
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>Base58.encodeWithChecksum(payload))).toBeNull();
});

it("VerifyKey: an unknown tag is refused", () => {
    const payload = Buffer.concat([Buffer.from([0xFE]), Buffer.alloc(32, 7)]);
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>Base58.encodeWithChecksum(payload))).toBeNull();
});

// The point of keeping a check at the API boundary at all: a key that was truncated or mistyped has to fail
// here, not later as a container nobody can open.
it("VerifyKey: junk is refused rather than thrown out of", () => {
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>"not-a-key")).toBeNull();
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>"")).toBeNull();
    // Correct Base58Check, correct SEC1 prefix, too few bytes behind it.
    const truncated = Base58.decodeWithChecksum(ECUtils.publicToBase58DER(ECUtils.generateRandom())).subarray(0, 20);
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>Base58.encodeWithChecksum(truncated))).toBeNull();
});

// A composed identity: Ed25519 to sign with, X25519 for the clients to wrap container keys to. The bridge
// only ever verifies, so it uses the signing half and carries the rest.
it("VerifyKey: a composed Ed25519+X25519 identity verifies with its signing half", () => {
    const {privateKey, raw} = ed25519Keys();
    const agreement = crypto.generateKeyPairSync("x25519").publicKey.export({format: "der", type: "spki"}).subarray(12);
    expect(agreement.length).toBe(32);

    const base58 = <types.core.EccPubKey>Base58.encodeWithChecksum(
        Buffer.concat([Buffer.from([ED25519_X25519_TAG]), raw, agreement])
    );

    const key = publicVerifyKeyFromBase58(base58);
    expect(key).not.toBeNull();
    expect(key?.algorithm).toBe("ed25519x25519");
    // Both halves survive the round trip, so the identity stays one string.
    expect(publicVerifyKeyToBase58(key!)).toBe(base58);

    const signature = crypto.sign(null, MESSAGE, privateKey);
    expect(verifySignature(key!, signature, MESSAGE)).toBeTruthy();
    expect(verifySignature(key!, signature, Crypto.sha256(Buffer.from("other", "utf8")))).toBeFalsy();
});

// The post-quantum identity: the same Ed25519 signing half, an X25519 agreement half, and an
// ML-KEM-768 encapsulation half the clients wrap container keys to. None of the latter two mean
// anything to the bridge — which is the point of the test: a key more than a kilobyte long must
// still be read, carried and verified as one identity.
it("VerifyKey: a post-quantum identity verifies with its signing half", () => {
    const {privateKey, raw} = ed25519Keys();
    const agreement = crypto.generateKeyPairSync("x25519").publicKey.export({format: "der", type: "spki"}).subarray(12);
    // ML-KEM-768 public key, 1184 bytes. Its contents are irrelevant here — the bridge never uses it.
    const kem = crypto.randomBytes(1184);

    const base58 = <types.core.EccPubKey>Base58.encodeWithChecksum(
        Buffer.concat([Buffer.from([ED25519_X25519_MLKEM768_TAG]), raw, agreement, kem])
    );

    const key = publicVerifyKeyFromBase58(base58);
    expect(key).not.toBeNull();
    expect(key?.algorithm).toBe("ed25519x25519mlkem768");
    // All three halves survive the round trip, so the identity stays one string.
    expect(publicVerifyKeyToBase58(key!)).toBe(base58);

    const signature = crypto.sign(null, MESSAGE, privateKey);
    expect(verifySignature(key!, signature, MESSAGE)).toBeTruthy();
    expect(verifySignature(key!, signature, Crypto.sha256(Buffer.from("other", "utf8")))).toBeFalsy();
});

it("VerifyKey: a post-quantum identity missing its ML-KEM half is refused", () => {
    const {raw} = ed25519Keys();
    const agreement = crypto.generateKeyPairSync("x25519").publicKey.export({format: "der", type: "spki"}).subarray(12);
    // The classical identity's bytes under the post-quantum tag: right tag, 1184 bytes short.
    const base58 = <types.core.EccPubKey>Base58.encodeWithChecksum(
        Buffer.concat([Buffer.from([ED25519_X25519_MLKEM768_TAG]), raw, agreement])
    );
    expect(publicVerifyKeyFromBase58(base58)).toBeNull();
});

it("VerifyKey: a composed identity of the wrong length is refused", () => {
    const {raw} = ed25519Keys();
    // The signing half alone under the composite tag: right tag, half the bytes.
    const base58 = <types.core.EccPubKey>Base58.encodeWithChecksum(
        Buffer.concat([Buffer.from([ED25519_X25519_TAG]), raw])
    );
    expect(publicVerifyKeyFromBase58(base58)).toBeNull();
});

// Tags sit where a SEC1 point prefix cannot, so a key in the old encoding fails as an unknown tag rather
// than being misread as some other algorithm.
it("VerifyKey: a tag byte cannot collide with a secp256k1 point prefix", () => {
    const untagged = Base58.decodeWithChecksum(ECUtils.publicToBase58DER(ECUtils.generateRandom()));
    expect(untagged.length).toBe(33);
    expect(untagged[0] === 0x02 || untagged[0] === 0x03).toBeTruthy();
    expect(ED25519_TAG >= 0x80).toBeTruthy();
});
