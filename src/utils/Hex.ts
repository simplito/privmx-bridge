/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as BN from "bn.js";
import * as types from "../types";

export class Hex {
    
    static EMPTY = <types.core.Hex>"";
    
    static from(buffer: Buffer): types.core.Hex {
        return <types.core.Hex>buffer.toString("hex");
    }
    
    static toBuf(hex: types.core.Hex): Buffer {
        return Buffer.from(hex, "hex");
    }
    
    static fromBN(bn: BN): types.core.Hex {
        const hex = bn.toString("hex");
        return <types.core.Hex>(hex.length % 2 == 0 ? hex : "0" + hex);
    }
    
    static toBN(hex: types.core.Hex): BN {
        return new BN(hex, "hex");
    }
}
