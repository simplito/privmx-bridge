/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../types";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { ECIES } from "../../utils/crypto/ECIES";
import { Crypto } from "../../utils/crypto/Crypto";
import { getNativeEcProvider, setNativeEcProvider } from "../../utils/crypto/NobleEc";

// --- Key A (signing / address) — private key 683641...a41b ---
const KEY_A_WIF = "KziHVv9Cr2awhHFDmo1NbQukX12ha1d3unM8AoyRLK4MEWPLK7GN" as types.core.EccWif;
const KEY_A_WIF_UNCOMPRESSED = "5JcBY2AZbDbRdKBUN2Mvq8EK1ua1am6T2zQ8y9Nr1kWm1QjnZVJ" as types.core.EccWif;
const KEY_A_PRIV_HEX = "683641b0c8a09ad848c12bd29e3f18342e4db4999cd98ad9e808b6c1ade8a41b";
const KEY_A_PUB58 = "4zWVdDLeohCZDypF4mZp9ajWeqoDtxp3gC77vZALhY4XvR4W1r" as types.core.EccPubKey;
const KEY_A_PUB58_UNCOMPRESSED =
    "3Lkt6q34EwMDrQMUnEGKF9LXTkGN17M38ZtirbwDNYZawkKAA9dWdBa1QnmvNPmrZykFed1ucZ4ruWJEMQVUFZX47CB5NJ" as types.core.EccPubKey;
const KEY_A_PUB_COMPRESSED_HEX = "020dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a";
const KEY_A_ADDRESS = "1NiKXEnydoY4cyzWioV6yFS7nuBxJZGHzQ" as types.core.EccAddress;

// --- Key B (ECDH private) / Key C (ECDH peer public) — from the existing derive/ECIES vectors ---
const KEY_B_WIF = "KyZrs3RKm3Eyq1eciNpiExbVA9DRCUCQXdSw3azQuVQKqWL7zh92" as types.core.EccWif;
const KEY_C_PUB58 =
    "3XaUfGaKLkj883pSgZVFiRGMevnnAZYn2vMwRsKd12WXjVAzUxcF7sgdrsseNbVLYf112oAofJydHCgeomZoQ5e8nXdAy5" as types.core.EccPubKey;

// --- Fixed message (a 32-byte sha256 digest, as used across the codebase) ---
const MSG = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");

// --- Recorded deterministic (RFC 6979) compact signature for Key A over MSG ---
const KEY_A_COMPACT_SIG =
    "1cc3a9d415829d8328b5c08c17e1acdf3645846231b50b9734745c4fb91182f39a4e11b70987f1ab69e13dec51096d440842a6db81a8a9aa019dc6cb50542168c2";

// --- ECIES vectors (noKey + shortTag), Key B private + Key C public ---
const ECIES_PLAINTEXT = Buffer.from(
    "8605375d9dda4b72f7de74a250bcda77b54571f44b71a00b77309c2e6409837ee018e772103f8fd353625f049aaa690879236400de91f38311edee62279a8a2100ad3259fa77cf",
    "hex",
);
const ECIES_CIPHERTEXT = Buffer.from(
    "2df24547a5b119f48f2ca82e36584449e227f44a067ea37d313c476fef67ad7167713a2d3b6218da345f0feda32bec464839266308a02f77d095b1aa99997c0680dd3e3c644364fadaf371d69107ade0d4335b5854457c26fa1ed701c876c29674d4eb29",
    "hex",
);
const ECIES_SHARED_KEY = Buffer.from(
    "074c88bcdb351f109209ca148a8d729d46009c2dcae9383caf3c36acd9256a813febe1be655f1b6049c2ca85d481d92e24ecba2c806d114eb8fb99bfb62be5b8",
    "hex",
);

// --- ed25519 point-compression quirk (Crypto.compressPublicKey) ---
const ED25519_UNCOMPRESSED = Buffer.from(
    "04471568c357d264117a6f5dd8dca15f7f891b1ea9ba8229782e3ce311a90bbdca078642afaa666584446a59fce58afbb0a2e8e774172a8ae2eb2f48f8b8bd6a85",
    "hex",
);
const ED25519_COMPRESSED = "03471568c357d264117a6f5dd8dca15f7f891b1ea9ba8229782e3ce311a90bbdca";

function privKey(wif: types.core.EccWif) {
    const k = ECUtils.fromWIF(wif);
    if (!k) {
        throw new Error("fromWIF returned null for a known-good WIF");
    }
    return k;
}

function pubKey(pub58: types.core.EccPubKey) {
    const k = ECUtils.publicFromBase58DER(pub58);
    if (!k) {
        throw new Error("publicFromBase58DER returned null for a known-good key");
    }
    return k;
}

describe("EC golden vectors - WIF", () => {
    it("fromWIF recovers the private key", () => {
        expect(privKey(KEY_A_WIF).getPrivate("hex")).toBe(KEY_A_PRIV_HEX);
    });
    it("toWIF (compressed) is stable", () => {
        expect(ECUtils.toWIF(privKey(KEY_A_WIF))).toBe(KEY_A_WIF);
    });
    it("toWIF (uncompressed) is stable", () => {
        expect(ECUtils.toWIF(privKey(KEY_A_WIF), "80", false)).toBe(KEY_A_WIF_UNCOMPRESSED);
    });
});

describe("EC golden vectors - public key encoding", () => {
    it("publicToBase58DER (compressed) is stable", () => {
        expect(ECUtils.publicToBase58DER(privKey(KEY_A_WIF), true)).toBe(KEY_A_PUB58);
    });
    it("publicToBase58DER (uncompressed) is stable", () => {
        expect(ECUtils.publicToBase58DER(privKey(KEY_A_WIF), false)).toBe(KEY_A_PUB58_UNCOMPRESSED);
    });
    it("publicFromBase58DER round-trips to the compressed public key", () => {
        expect(pubKey(KEY_A_PUB58).getPublic(true, "hex")).toBe(KEY_A_PUB_COMPRESSED_HEX);
    });
    it("toBase58Address is stable", () => {
        expect(ECUtils.toBase58Address(privKey(KEY_A_WIF))).toBe(KEY_A_ADDRESS);
    });
});

describe("EC golden vectors - signatures", () => {
    it("signToCompactSignature is deterministic (RFC 6979) and byte-stable", () => {
        const prev = getNativeEcProvider();
        setNativeEcProvider(null);
        try {
            const sig = ECUtils.signToCompactSignature(privKey(KEY_A_WIF), MSG);
            expect(sig.toString("hex")).toBe(KEY_A_COMPACT_SIG);
        }
        finally {
            setNativeEcProvider(prev);
        }
    });
    it("verifySignature accepts a valid signature", () => {
        const sig = Buffer.from(KEY_A_COMPACT_SIG, "hex");
        expect(ECUtils.verifySignature(privKey(KEY_A_WIF), sig, MSG)).toBe(true);
    });
    it("verifySignature rejects a tampered message", () => {
        const sig = Buffer.from(KEY_A_COMPACT_SIG, "hex");
        const tampered = Buffer.from(MSG);
        tampered[0] = (tampered[0] + 1) % 256;
        expect(ECUtils.verifySignature(privKey(KEY_A_WIF), sig, tampered)).toBe(false);
    });
    it("recoveryPubKey recovers the signing public key", () => {
        const sig = Buffer.from(KEY_A_COMPACT_SIG, "hex");
        const recovered = ECUtils.recoveryPubKey(MSG, sig);
        expect(recovered.getPublic(true, "hex")).toBe(KEY_A_PUB_COMPRESSED_HEX);
    });
});

describe("EC golden vectors - ECDH / ECIES", () => {
    it("ECIES.calculateSharedKey is byte-stable", () => {
        const ecies = new ECIES(privKey(KEY_B_WIF), pubKey(KEY_C_PUB58));
        expect(ecies.calculateSharedKey().equals(ECIES_SHARED_KEY)).toBe(true);
    });
    it("ECIES.encrypt is byte-stable", () => {
        const ecies = new ECIES(privKey(KEY_B_WIF), pubKey(KEY_C_PUB58));
        expect(ecies.encrypt(ECIES_PLAINTEXT).equals(ECIES_CIPHERTEXT)).toBe(true);
    });
    it("ECIES.decrypt reverses encrypt", () => {
        const ecies = new ECIES(privKey(KEY_B_WIF), pubKey(KEY_C_PUB58));
        expect(ecies.decrypt(ECIES_CIPHERTEXT).equals(ECIES_PLAINTEXT)).toBe(true);
    });
});

describe("EC golden vectors - ed25519 compression", () => {
    it("Crypto.compressPublicKey matches the recorded output", () => {
        const compressed = Crypto.compressPublicKey(ED25519_UNCOMPRESSED);
        expect(Buffer.from(compressed).toString("hex")).toBe(ED25519_COMPRESSED);
    });
});
