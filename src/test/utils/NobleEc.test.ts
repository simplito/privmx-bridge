/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as BN from "bn.js";
import { ec, EccKeyPair, getNativeEcProvider, NativeEcProvider, setNativeEcProvider } from "../../utils/crypto/NobleEc";

const secp256k1 = ec("secp256k1");

// Fixtures (recorded from elliptic in Phase 0)
const A_PRIV_HEX = "683641b0c8a09ad848c12bd29e3f18342e4db4999cd98ad9e808b6c1ade8a41b";
const A_PUB_UNCOMPRESSED =
    "040dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a915981e033696e3ab8ba723e2a24108b81635fdf97cc5ad0ae68200d3bdc83d6";
const A_PUB_COMPRESSED = "020dab1baa2684afaeaff496180bf7619b2afb0759e6223a8d975a535f28b9e06a";
const MSG = Buffer.from("80e53907ed0b62f7530921bd6fdb0c179ccd5b8db6bb1be53f8023ea87859aab", "hex");
const A_COMPACT_SIG =
    "1cc3a9d415829d8328b5c08c17e1acdf3645846231b50b9734745c4fb91182f39a4e11b70987f1ab69e13dec51096d440842a6db81a8a9aa019dc6cb50542168c2";

const B_PRIV_HEX = "460a6033b2e1cf95e8814249776b4660787560e7ae5ab40d4ce902c5205a620f";
const C_PUB_UNCOMPRESSED =
    "04606077a427012ffd2c746b7ae0c47f89582cd71beca46d99094aca0e64a8ed501e0a6f267c502f2d0bcaf59872a5a138c7a10bec6309c36e62fbcc9f6c38e5fd";
const BC_SHARED_X = "2c0d5b3057d97acdbb8441e9a5b18bb894874407627d20071e203c1215d74ee1";

// existing verify vectors from PrivMXNative.test.ts
const V_PUB = "02a90eb3aa9d0ed700503ab74ef18faafe948902a1edd588e1954dbd75547b801f";
const V_PUB_WRONG = "0271a1f7222cb682cc3afa06743b9346710eba9ef73446fc49ffee47934aa37e79";
const V_SIG = Buffer.from(
    "1b6018871e60314845b7953b1bf2474a03ef156b53264eedb9f58b66cafd86bbc54c5910a7abb50ab0160379e56d912053fefaf0b36fc195d038550fd6a86b9d4e",
    "hex",
);

function keyA(): EccKeyPair {
    return secp256k1.keyFromPrivate(Buffer.from(A_PRIV_HEX, "hex"));
}

// signToCompactSignature, re-implemented exactly as ECUtils does it, on top of the adapter
function compactSig(key: EccKeyPair, msg: Buffer): Buffer {
    const sign = key.sign(msg);
    let compact = (27 + sign.recoveryParam).toString(16);
    compact += sign.r.toString("hex").padStart(64, "0");
    compact += sign.s.toString("hex").padStart(64, "0");
    return Buffer.from(compact, "hex");
}

describe("NobleEc - public key derivation & encoding", () => {
    it("getPublic(false, hex) is the uncompressed public key", () => {
        expect(keyA().getPublic(false, "hex")).toBe(A_PUB_UNCOMPRESSED);
    });
    it("getPublic(true, hex) is the compressed public key", () => {
        expect(keyA().getPublic(true, "hex")).toBe(A_PUB_COMPRESSED);
    });
    it("getPublic(hex) single-arg is uncompressed (elliptic semantics)", () => {
        expect(keyA().getPublic("hex")).toBe(A_PUB_UNCOMPRESSED);
    });
    it("getPublic(true, binary) is a Buffer of the compressed key", () => {
        const bin = keyA().getPublic(true, "binary");
        expect(Buffer.isBuffer(bin)).toBe(true);
        expect((bin as Buffer).toString("hex")).toBe(A_PUB_COMPRESSED);
    });
    it("getPublic() returns a point with encode()/encodeCompressed()", () => {
        const p = keyA().getPublic();
        expect(p.encode().toString("hex")).toBe(A_PUB_UNCOMPRESSED);
        expect(p.encodeCompressed().toString("hex")).toBe(A_PUB_COMPRESSED);
    });
    it("getPrivate(hex) round-trips", () => {
        expect(keyA().getPrivate("hex")).toBe(A_PRIV_HEX);
    });
    it("keyFromPublic point eq matches", () => {
        const fromPriv = keyA().getPublic();
        const fromPub = secp256k1.keyFromPublic(Buffer.from(A_PUB_COMPRESSED, "hex")).getPublic();
        expect(fromPriv.eq(fromPub)).toBe(true);
    });
});

function forceNoble<T>(fn: () => T): T {
    const prev = getNativeEcProvider();
    setNativeEcProvider(null);
    try {
        return fn();
    }
    finally {
        setNativeEcProvider(prev);
    }
}

describe("NobleEc - signatures", () => {
    it("sign produces the recorded deterministic recovery param", () => {
        expect(forceNoble(() => keyA().sign(MSG).recoveryParam)).toBe(1);
    });
    it("compact signature is byte-identical to elliptic", () => {
        expect(forceNoble(() => compactSig(keyA(), MSG).toString("hex"))).toBe(A_COMPACT_SIG);
    });
    it("verify accepts a valid signature (r/s as hex)", () => {
        const sig = Buffer.from(A_COMPACT_SIG, "hex");
        const r = sig.slice(1, 33).toString("hex");
        const s = sig.slice(33).toString("hex");
        expect(keyA().verify(MSG, { r, s })).toBe(true);
    });
    it("verify rejects a tampered message", () => {
        const sig = Buffer.from(A_COMPACT_SIG, "hex");
        const tampered = Buffer.from(MSG);
        tampered[0] = (tampered[0] + 1) % 256;
        expect(keyA().verify(tampered, { r: sig.slice(1, 33).toString("hex"), s: sig.slice(33).toString("hex") })).toBe(false);
    });
    it("verify matches elliptic on the legacy vector (true)", () => {
        const key = secp256k1.keyFromPublic(Buffer.from(V_PUB, "hex"));
        expect(key.verify(MSG, { r: V_SIG.slice(1, 33).toString("hex"), s: V_SIG.slice(33).toString("hex") })).toBe(true);
    });
    it("verify matches elliptic on the legacy vector (false / wrong key)", () => {
        const key = secp256k1.keyFromPublic(Buffer.from(V_PUB_WRONG, "hex"));
        expect(key.verify(MSG, { r: V_SIG.slice(1, 33).toString("hex"), s: V_SIG.slice(33).toString("hex") })).toBe(false);
    });
    it("recoverPubKey recovers the signing key", () => {
        const sig = Buffer.from(A_COMPACT_SIG, "hex");
        const recParam = sig[0] - 27;
        const point = secp256k1.recoverPubKey(MSG, { r: sig.slice(1, 33).toString("hex"), s: sig.slice(33).toString("hex") }, recParam);
        expect(point.encodeCompressed().toString("hex")).toBe(A_PUB_COMPRESSED);
    });
});

describe("NobleEc - ECDH derive", () => {
    it("derive returns the shared X coordinate as a BN matching elliptic", () => {
        const priv = secp256k1.keyFromPrivate(Buffer.from(B_PRIV_HEX, "hex"));
        const pub = secp256k1.keyFromPublic(Buffer.from(C_PUB_UNCOMPRESSED, "hex"));
        const shared = priv.derive(pub.getPublic());
        expect(Buffer.from(shared.toArray("be", 32)).toString("hex")).toBe(BC_SHARED_X);
        expect(Buffer.from(shared.toString("hex", 2), "hex").toString("hex")).toBe(BC_SHARED_X);
    });
});

describe("NobleEc - genKeyPair", () => {
    it("generates a usable keypair (sign -> verify round-trip)", () => {
        const key = secp256k1.genKeyPair();
        expect((key.getPrivate() as BN).toArrayLike(Buffer, "be", 32).length).toBe(32);
        const sig = key.sign(MSG);
        expect(key.verify(MSG, { r: sig.r, s: sig.s })).toBe(true);
    });
});

describe("NobleEc - native provider hook", () => {
    it("routes sign / verify / derive through a registered provider, then restores noble", () => {
        const calls: string[] = [];
        const fake: NativeEcProvider = {
            sign: (_msg, _priv) => {
                calls.push("sign");
                return { r: Buffer.alloc(32, 0x11), s: Buffer.alloc(32, 0x22), recovery: 2 };
            },
            verify: (_msg, _sig, _pub) => {
                calls.push("verify");
                return true;
            },
            sharedKey: (_priv, _pub) => {
                calls.push("sharedKey");
                return Buffer.alloc(32, 0x33);
            },
        };
        const prev = getNativeEcProvider();
        try {
            setNativeEcProvider(fake);
            const key = keyA();
            const sig = key.sign(MSG);
            expect(sig.recoveryParam).toBe(2);
            expect(sig.r.toArrayLike(Buffer, "be", 32).toString("hex")).toBe("11".repeat(32));
            expect(key.verify(MSG, { r: "00", s: "00" })).toBe(true);
            const shared = key.derive(secp256k1.keyFromPublic(Buffer.from(C_PUB_UNCOMPRESSED, "hex")).getPublic());
            expect(Buffer.from(shared.toArray("be", 32)).toString("hex")).toBe("33".repeat(32));
            expect(calls).toEqual(["sign", "verify", "sharedKey"]);
        }
        finally {
            setNativeEcProvider(prev);
        }
        expect(forceNoble(() => compactSig(keyA(), MSG).toString("hex"))).toBe(A_COMPACT_SIG);
    });
});
