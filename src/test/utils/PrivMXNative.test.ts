/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as PrivmxNative from "../../utils/crypto/PrivMXNative";
import * as base58 from "bs58";
import * as base58check from "bs58check";
import * as types from "../../types";
import * as elliptic from "elliptic";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { ECIES } from "../../utils/crypto/ECIES";
import { StringLogger } from "../testUtils/logger/StringLogger";

PrivmxNative.init(new StringLogger());

describe("base58_encode", () => {
    each<[string, types.core.Base58]>([
        [
            "02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "nqZePEmHFJxgZdv4SAFvo9suMiFob8pA2YEdiGGQqcRt" as types.core.Base58,
        ],
        [
            "000000000002a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "11111nqZePEmHFJxgZdv4SAFvo9suMiFob8pA2YEdiGGQqcRt" as types.core.Base58,
        ],
        [
            "FF02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "6mN142AhbCSAHbRT4L9f95Tv8ggSU9b4oJ5qBggqJYQv6AA" as types.core.Base58,
        ],
        [
            "0102a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "2KqceXTBCrVPjQakNzb5hpKfDRL8zYJQtMqaRt45au3TSW" as types.core.Base58,
        ],
    ]).it("input=%s expected=%s", async ([inputHex, expected]) => {
        // Setup
        const input = Buffer.from(inputHex, "hex");
        
        // Act
        const result = base58.encode(input);
        
        // Assert
        expect(result).toBe(expected);
    });
});

describe("base58_decode", () => {
    each<[types.core.Base58, string]>([
        [
            "nqZePEmHFJxgZdv4SAFvo9suMiFob8pA2YEdiGGQqcRt" as types.core.Base58,
            "02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
        [
            "11111nqZePEmHFJxgZdv4SAFvo9suMiFob8pA2YEdiGGQqcRt" as types.core.Base58,
            "000000000002a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
        [
            "6mN142AhbCSAHbRT4L9f95Tv8ggSU9b4oJ5qBggqJYQv6AA" as types.core.Base58,
            "FF02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
        [
            "2KqceXTBCrVPjQakNzb5hpKfDRL8zYJQtMqaRt45au3TSW" as types.core.Base58,
            "0102a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
    ]).it("input=%s expected=%s", async ([input, expectedHex]) => {
        // Setup
        const expected = Buffer.from(expectedHex, "hex");
        
        // Act
        const result = base58.decode(input);
        
        // Assert
        expect(result.equals(expected)).toBe(true);
    });
});

describe("base58_encode_with_checksum", () => {
    each<[string, types.core.Base58]>([
        [
            "02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "6AwhUu1H2qb7SeEUdrBrGKz1x1W6UXogwQF2mVdyaCDihVsXMo" as types.core.Base58,
        ],
        [
            "000000000002a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "111116AwhUu1H2qb7SeEUdrBrGKz1x1W6UXogwQF2mVdyaCDifnLLnT" as types.core.Base58,
        ],
        [
            "FF02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "eiwxjrNHeUeu54pXFoHaCEPXSpBMNocuKLndvs7dqzkh28SRTAm2" as types.core.Base58,
        ],
        [
            "0102a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
            "9foWrqoBRwyZdTQnZ2jz2MpET9fLWkFy8ZXoV7b8TKuW3wsGmxa" as types.core.Base58,
        ],
    ]).it("input=%s expected=%s", async ([inputHex, expected]) => {
        // Setup
        const input = Buffer.from(inputHex, "hex");
        
        // Act
        const result = base58check.encode(input);
        
        // Assert
        expect(result).toBe(expected);
    });
});

describe("base58_decode_with_checksum", () => {
    each<[types.core.Base58, string]>([
        [
            "6AwhUu1H2qb7SeEUdrBrGKz1x1W6UXogwQF2mVdyaCDihVsXMo" as types.core.Base58,
            "02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
        [
            "111116AwhUu1H2qb7SeEUdrBrGKz1x1W6UXogwQF2mVdyaCDifnLLnT" as types.core.Base58,
            "000000000002a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
        [
            "eiwxjrNHeUeu54pXFoHaCEPXSpBMNocuKLndvs7dqzkh28SRTAm2" as types.core.Base58,
            "FF02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
        [
            "9foWrqoBRwyZdTQnZ2jz2MpET9fLWkFy8ZXoV7b8TKuW3wsGmxa" as types.core.Base58,
            "0102a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f",
        ],
    ]).it("input=%s expected=%s", async ([input, expectedHex]) => {
        // Setup
        const expected = Buffer.from(expectedHex, "hex");
        
        // Act
        const result = base58check.decode(input);
        
        // Assert
        expect(result.equals(expected)).toBe(true);
    });
});

const secp256k1 = elliptic.ec("secp256k1");

it("elliptic import public from uncompressed buffer", () => {
    const pubBuffer = Buffer.from("040dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a915981e033696e3ab8ba723e2a24108b81635fdf97cc5ad0ae68200d3bdc83d6", "hex");
    
    const key = secp256k1.keyFromPublic(pubBuffer);
    const encoded = Buffer.from(key.getPublic().encode());
    
    expect(encoded.equals(pubBuffer)).toBe(true);
});

it("elliptic import public from uncompressed hex", () => {
    const pubHex = "040dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a915981e033696e3ab8ba723e2a24108b81635fdf97cc5ad0ae68200d3bdc83d6";
    const pubBuffer = Buffer.from(pubHex, "hex");
    
    const key = secp256k1.keyFromPublic(pubHex, "hex");
    const encoded = Buffer.from(key.getPublic().encode());
    
    expect(encoded.equals(pubBuffer)).toBe(true);
});

it("elliptic import public from compressed buffer", () => {
    const compressedPubBuffer = Buffer.from("020dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a", "hex");
    const uncompressedPubBuffer = Buffer.from("040dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a915981e033696e3ab8ba723e2a24108b81635fdf97cc5ad0ae68200d3bdc83d6", "hex");
    
    const key = secp256k1.keyFromPublic(compressedPubBuffer);
    const encoded = Buffer.from(key.getPublic().encode());
    
    expect(encoded.equals(uncompressedPubBuffer)).toBe(true);
});

it("elliptic import public from compressed hex", () => {
    const compressedPubHex = "020dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a";
    const uncompressedPubBuffer = Buffer.from("040dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a915981e033696e3ab8ba723e2a24108b81635fdf97cc5ad0ae68200d3bdc83d6", "hex");
    
    const key = secp256k1.keyFromPublic(compressedPubHex, "hex");
    const encoded = Buffer.from(key.getPublic().encode());
    
    expect(encoded.equals(uncompressedPubBuffer)).toBe(true);
});

it("elliptic get public from priv", () => {
    const privHex = "683641b0c8a09ad848c12bd29e3f18342e4db4999cd98ad9e808b6c1ade8a41b";
    const pubBuffer = Buffer.from("040dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a915981e033696e3ab8ba723e2a24108b81635fdf97cc5ad0ae68200d3bdc83d6", "hex");
    
    const key = secp256k1.keyFromPrivate(privHex, "hex");
    const encoded = Buffer.from(key.getPublic().encode());
    
    expect(encoded.equals(pubBuffer)).toBe(true);
});

it("elliptic derive", () => {
    const priv = Buffer.from("460a6033b2e1cf95e8814249776b4660787560e7ae5ab40d4ce902c5205a620f", "hex");
    const pub = Buffer.from("04606077a427012ffd2c746b7ae0c47f89582cd71beca46d99094aca0e64a8ed501e0a6f267c502f2d0bcaf59872a5a138c7a10bec6309c36e62fbcc9f6c38e5fd", "hex");
    const expected = Buffer.from("2c0d5b3057d97acdbb8441e9a5b18bb894874407627d20071e203c1215d74ee1", "hex");
    const privKey = secp256k1.keyFromPrivate(priv);
    const pubKey = secp256k1.keyFromPublic(pub);
    
    const point = privKey.derive(pubKey.getPublic());
    const pointBuf = Buffer.from(point.toArray("be", 32));
    
    expect(pointBuf.equals(expected)).toBe(true);
});

it("elliptic sign", () => {
    const priv = Buffer.from("feaff121605538753a4b7ca4e37a4b5bc79ff3c285d652ab52506aa62cca6095", "hex");
    const msg = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");
    const privKey = secp256k1.keyFromPrivate(priv);
    
    const signature = privKey.sign(msg);
    
    expect(privKey.verify(msg, signature)).toBe(true);
});

it("elliptic verify true", () => {
    const pub = Buffer.from("02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f", "hex");
    const msg = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");
    const signature = Buffer.from("1b6018871e60314845b7953b1bf2474a03ef156b53264eedb9f58b66cafd86bbc54c5910a7abb50ab0160379e56d912053fefaf0b36fc195d038550fd6a86b9d4e", "hex");
    const pubKey = secp256k1.keyFromPublic(pub);
    
    const verified = pubKey.verify(msg, {r: signature.slice(1, 33), s: signature.slice(33)});
    
    expect(verified).toBe(true);
});

it("elliptic verify false", () => {
    const pub = Buffer.from("0271a1f7222cb682cc3afa06743b9346710eba9ef73446fc49ffee47934aa37e79", "hex");
    const msg = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");
    const signature = Buffer.from("1b6018871e60314845b7953b1bf2474a03ef156b53264eedb9f58b66cafd86bbc54c5910a7abb50ab0160379e56d912053fefaf0b36fc195d038550fd6a86b9d4e", "hex");
    const pubKey = secp256k1.keyFromPublic(pub);
    
    const verified = pubKey.verify(msg, {r: signature.slice(1, 33), s: signature.slice(33)});
    
    expect(verified).toBe(false);
});

it("ECUtils signToCompactSignature", () => {
    const priv = Buffer.from("feaff121605538753a4b7ca4e37a4b5bc79ff3c285d652ab52506aa62cca6095", "hex");
    const msg = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");
    const privKey = secp256k1.keyFromPrivate(priv);
    
    const signature = ECUtils.signToCompactSignature(privKey, msg);
    
    expect(ECUtils.verifySignature(privKey, signature, msg)).toBe(true);
});

it("ECUtils verifySignature true", () => {
    const pub = Buffer.from("02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f", "hex");
    const msg = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");
    const signature = Buffer.from("1b6018871e60314845b7953b1bf2474a03ef156b53264eedb9f58b66cafd86bbc54c5910a7abb50ab0160379e56d912053fefaf0b36fc195d038550fd6a86b9d4e", "hex");
    const pubKey = secp256k1.keyFromPublic(pub);
    
    const verified = ECUtils.verifySignature(pubKey, signature, msg);
    
    expect(verified).toBe(true);
});

it("ECUtils verifySignature false", () => {
    const pub = Buffer.from("0271a1f7222cb682cc3afa06743b9346710eba9ef73446fc49ffee47934aa37e79", "hex");
    const msg = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");
    const signature = Buffer.from("1b6018871e60314845b7953b1bf2474a03ef156b53264eedb9f58b66cafd86bbc54c5910a7abb50ab0160379e56d912053fefaf0b36fc195d038550fd6a86b9d4e", "hex");
    const pubKey = secp256k1.keyFromPublic(pub);
    
    const verified = ECUtils.verifySignature(pubKey, signature, msg);
    
    expect(verified).toBe(false);
});

it("ECIES calculateSharedKey", () => {
    const priv = Buffer.from("460a6033b2e1cf95e8814249776b4660787560e7ae5ab40d4ce902c5205a620f", "hex");
    const pub = Buffer.from("04606077a427012ffd2c746b7ae0c47f89582cd71beca46d99094aca0e64a8ed501e0a6f267c502f2d0bcaf59872a5a138c7a10bec6309c36e62fbcc9f6c38e5fd", "hex");
    const expected = Buffer.from("074c88bcdb351f109209ca148a8d729d46009c2dcae9383caf3c36acd9256a813febe1be655f1b6049c2ca85d481d92e24ecba2c806d114eb8fb99bfb62be5b8", "hex");
    const privKey = secp256k1.keyFromPrivate(priv);
    const pubKey = secp256k1.keyFromPublic(pub);
    const ecies = new ECIES(privKey, pubKey);
    
    const shared = ecies.calculateSharedKey();
    
    expect(shared.equals(expected)).toBe(true);
});

it("ECIES encrypt", () => {
    const priv = Buffer.from("460a6033b2e1cf95e8814249776b4660787560e7ae5ab40d4ce902c5205a620f", "hex");
    const pub = Buffer.from("04606077a427012ffd2c746b7ae0c47f89582cd71beca46d99094aca0e64a8ed501e0a6f267c502f2d0bcaf59872a5a138c7a10bec6309c36e62fbcc9f6c38e5fd", "hex");
    const data = Buffer.from("8605375d9dda4b72f7de74a250bcda77b54571f44b71a00b77309c2e6409837ee018e772103f8fd353625f049aaa690879236400de91f38311edee62279a8a2100ad3259fa77cf", "hex");
    const expected = Buffer.from("2df24547a5b119f48f2ca82e36584449e227f44a067ea37d313c476fef67ad7167713a2d3b6218da345f0feda32bec464839266308a02f77d095b1aa99997c0680dd3e3c644364fadaf371d69107ade0d4335b5854457c26fa1ed701c876c29674d4eb29", "hex");
    const privKey = secp256k1.keyFromPrivate(priv);
    const pubKey = secp256k1.keyFromPublic(pub);
    const ecies = new ECIES(privKey, pubKey);
    
    const cipher = ecies.encrypt(data);
    
    expect(cipher.equals(expected)).toBe(true);
});

it("ECIES decrypt", () => {
    const priv = Buffer.from("460a6033b2e1cf95e8814249776b4660787560e7ae5ab40d4ce902c5205a620f", "hex");
    const pub = Buffer.from("04606077a427012ffd2c746b7ae0c47f89582cd71beca46d99094aca0e64a8ed501e0a6f267c502f2d0bcaf59872a5a138c7a10bec6309c36e62fbcc9f6c38e5fd", "hex");
    const data = Buffer.from("2df24547a5b119f48f2ca82e36584449e227f44a067ea37d313c476fef67ad7167713a2d3b6218da345f0feda32bec464839266308a02f77d095b1aa99997c0680dd3e3c644364fadaf371d69107ade0d4335b5854457c26fa1ed701c876c29674d4eb29", "hex");
    const expected = Buffer.from("8605375d9dda4b72f7de74a250bcda77b54571f44b71a00b77309c2e6409837ee018e772103f8fd353625f049aaa690879236400de91f38311edee62279a8a2100ad3259fa77cf", "hex");
    const privKey = secp256k1.keyFromPrivate(priv);
    const pubKey = secp256k1.keyFromPublic(pub);
    const ecies = new ECIES(privKey, pubKey);
    
    const plain = ecies.decrypt(data);
    
    expect(plain.equals(expected)).toBe(true);
});
