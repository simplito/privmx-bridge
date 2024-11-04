/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";

export class Base64 {
    
    static EMPTY = <types.core.Base64>"";
    
    static from(buffer: Buffer): types.core.Base64 {
        return <types.core.Base64>buffer.toString("base64");
    }
    
    static toBuf(base64: types.core.Base64): Buffer {
        return Buffer.from(base64, "base64");
    }
}
