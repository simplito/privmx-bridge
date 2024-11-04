/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as BN from "bn.js";
import { Hex } from "../Hex";
import * as types from "../../types";
import { SrpHelper } from "./SrpHelper";

export interface SrpConfig {
    N: BN;
    g: BN;
    k: BN;
}

export class SrpLogic {
    
    static get_k(N: BN, g: BN): BN {
        return SrpHelper.HBN(Buffer.concat([SrpHelper.PAD(N, N), SrpHelper.PAD(g, N)]));
    }
    
    static get_b(): BN {
        return new BN(SrpHelper.randomBytes(64));
    }
    
    static get_big_B(g: BN, N: BN, k: BN, b: BN, v: BN): BN {
        const red = BN.red(N);
        k = k.toRed(red);
        v = v.toRed(red);
        g = g.toRed(red);
        return k.redMul(v).redAdd(g.redPow(b)).fromRed();
    }
    
    static get_u(A: BN, B: BN, N: BN): BN {
        return SrpHelper.HBN(Buffer.concat([SrpHelper.PAD(A, N), SrpHelper.PAD(B, N)]));
    }
    
    static getServer_S(A: BN, v: BN, u: BN, b: BN, N: BN): BN {
        const red = BN.red(N);
        A = A.toRed(red);
        v = v.toRed(red);
        return A.redMul(v.redPow(u)).redPow(b).fromRed();
    }
    
    static get_M1(A: BN, B: BN, S: BN, N: BN): BN {
        return SrpHelper.HBN(Buffer.concat([SrpHelper.PAD(A, N), SrpHelper.PAD(B, N), SrpHelper.PAD(S, N)]));
    }
    
    static get_M2(A: BN, M1: BN, S: BN, N: BN): BN {
        return SrpHelper.HBN(Buffer.concat([SrpHelper.PAD(A, N), SrpHelper.PAD(M1, N), SrpHelper.PAD(S, N)]));
    }
    
    static get_big_K(S: BN, N: BN) {
        return SrpHelper.H(SrpHelper.PAD(S, N));
    }
    
    static valid_A(A: BN, N: BN): boolean {
        return A.mod(N).eqn(0) === false;
    }
    
    static getConfig(): SrpConfig {
        const conf: SrpConfig = {
            N: Hex.toBN(<types.core.Hex>"eeaf0ab9adb38dd69c33f80afa8fc5e86072618775ff3c0b9ea2314c9c256576d674df7496ea81d3383b4813d692c6e0e0d5d8e250b98be48e495c1d6089dad15dc7d7b46154d6b6ce8ef4ad69b15d4982559b297bcf1885c529f566660e57ec68edbc3c05726cc02fd4cbf4976eaa9afd5138fe8376435b9fc61d2fc0eb06e3"),
            g: Hex.toBN(<types.core.Hex>"02"),
            k: null
        };
        conf.k = SrpLogic.get_k(conf.N, conf.g);
        return conf;
    }
    
    static valid_B(B: BN, N: BN): boolean {
        return B.mod(N).eqn(0) === false;
    }
    
    static get_x(s: Buffer, I: string, P: string): BN {
        const hash = SrpHelper.H(Buffer.from(I + ":" + P, "utf8"));
        return SrpHelper.HBN(Buffer.concat([s, hash]));
    }
    
    static get_v(g: BN, N: BN, x: BN): BN {
        const red = BN.red(N);
        return g.toRed(red).redPow(x).fromRed();
    }
    
    static get_A(g: BN, N: BN, a: BN): BN {
        const red = BN.red(N);
        g = g.toRed(red);
        return g.redPow(a).fromRed();
    }
    
    static getClient_S(B: BN, k: BN, v: BN, a: BN, u: BN, x: BN, N: BN): BN {
        const red = BN.red(N);
        B = B.toRed(red);
        k = k.toRed(red);
        v = v.toRed(red);
        return B.redSub(k.redMul(v)).redPow(a.add(u.mul(x))).fromRed();
    }
    
    static get_small_a(): BN {
        return new BN(SrpHelper.randomBytes(64));
    }
}
