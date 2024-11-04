/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as base58 from "bs58";
import * as base58check from "bs58check";
import * as types from "../../types";

export class Base58 {
    
    static decode(b58: types.core.Base58): Buffer {
        return base58.decode(b58);
    }
    
    static decodeWithChecksum(b58: types.core.Base58): Buffer {
        return base58check.decode(b58);
    }
    
    static encode(bin: Buffer): types.core.Base58 {
        return <types.core.Base58>base58.encode(bin);
    }
    
    static encodeWithChecksum(bin: Buffer): types.core.Base58 {
        return <types.core.Base58>base58check.encode(bin);
    }
}
