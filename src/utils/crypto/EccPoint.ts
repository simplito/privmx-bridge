/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { getEcEngine } from "./EcEngineRegistry";

/**
 * An engine-neutral secp256k1 point. Holds the canonical SEC1 uncompressed encoding and
 * delegates every curve operation to the active engine, so no curve-library object leaks here.
 */
export class EccPoint {
    /** @param bytes canonical SEC1 uncompressed encoding (0x04 || X || Y). */
    constructor(private readonly bytes: Buffer) {}
    
    /** Uncompressed encoding: 0x04 || X || Y */
    encode(): Buffer {
        return getEcEngine().pointToBytes(this.bytes, false);
    }
    
    /** Compressed encoding: 0x02/0x03 || X */
    encodeCompressed(): Buffer {
        return getEcEngine().pointToBytes(this.bytes, true);
    }
    
    eq(other: EccPoint): boolean {
        return getEcEngine().pointsEqual(this.bytes, other.bytes);
    }
    
    /** @internal canonical SEC1 uncompressed bytes */
    rawBytes(): Buffer {
        return this.bytes;
    }
}
