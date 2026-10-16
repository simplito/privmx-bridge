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
import { publicVerifyKeyFromBase58, verifyKeyFromEcc, verifySignature } from "../../utils/crypto/VerifyKey";
import * as types from "../../types";

const ED25519_TAG = 0x80;

function ed25519Keys() {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
    // An SPKI export is a 12-byte header then the 32 raw bytes.
    const raw = publicKey.export({format: "der", type: "spki"}).subarray(12);
    const base58 = <types.core.EccPubKey>Base58.encodeWithChecksum(Buffer.concat([Buffer.from([ED25519_TAG]), raw]));
    return {privateKey, raw, base58};
}

// The message is produced the same way for every algorithm: NonceService hands each one a SHA-256 digest.
const MESSAGE = Crypto.sha256(Buffer.from("ecdhexlogin abc 1700000000", "utf8"));

it("VerifyKey: an untagged key is read as secp256k1 and its signature verifies", () => {
    const keyPair = ECUtils.generateRandom();
    const base58 = ECUtils.publicToBase58DER(keyPair);
    
    const key = publicVerifyKeyFromBase58(base58);
    expect(key).not.toBeNull();
    expect(key?.algorithm).toBe("secp256k1");
    
    const signature = ECUtils.signToCompactSignature(keyPair, MESSAGE);
    expect(verifySignature(key!, signature, MESSAGE)).toBeTruthy();
    // Same result as going through the key pair directly, so existing callers are unaffected.
    expect(verifySignature(verifyKeyFromEcc(keyPair), signature, MESSAGE)).toBeTruthy();
});

it("VerifyKey: a secp256k1 signature over another message is refused", () => {
    const keyPair = ECUtils.generateRandom();
    const key = publicVerifyKeyFromBase58(ECUtils.publicToBase58DER(keyPair))!;
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
    const secp256k1 = publicVerifyKeyFromBase58(ECUtils.publicToBase58DER(keyPair))!;
    
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

// The point of keeping a check at the API boundary at all: a key that was truncated or mistyped has to fail
// here, not later as a container nobody can open.
it("VerifyKey: junk is refused rather than thrown out of", () => {
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>"not-a-key")).toBeNull();
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>"")).toBeNull();
    // Correct Base58Check, correct SEC1 prefix, too few bytes behind it.
    const truncated = Base58.decodeWithChecksum(ECUtils.publicToBase58DER(ECUtils.generateRandom())).subarray(0, 20);
    expect(publicVerifyKeyFromBase58(<types.core.EccPubKey>Base58.encodeWithChecksum(truncated))).toBeNull();
});

// The encodings have to stay apart: a tag is at 0x80 or above, where a SEC1 point prefix can never be.
it("VerifyKey: a tag byte cannot collide with a secp256k1 point prefix", () => {
    const untagged = Base58.decodeWithChecksum(ECUtils.publicToBase58DER(ECUtils.generateRandom()));
    expect(untagged.length).toBe(33);
    expect(untagged[0] === 0x02 || untagged[0] === 0x03).toBeTruthy();
    expect(ED25519_TAG >= 0x80).toBeTruthy();
});
