/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Crypto } from "./Crypto";
import * as BN from "bn.js";

export class SrpHelper {
    
    static H(bytes: Buffer): Buffer {
        return Crypto.sha256(bytes);
    }
    
    static HBN(x: Buffer): BN {
        return new BN(SrpHelper.H(x));
    }
    
    static PAD(x: BN, N: BN): Buffer {
        return x.toArrayLike(Buffer, "be", N.byteLength());
    }
    
    static randomBytes(length: number): Buffer {
        return Crypto.randomBytes(length);
    }
}