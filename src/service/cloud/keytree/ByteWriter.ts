/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * The byte encoding both sides hash and sign: big-endian integers and length-prefixed UTF-8. Every field has a
 * fixed position and an explicit length, so two different values can never encode to the same bytes.
 */
export class ByteWriter {
    
    private parts: Buffer[] = [];
    
    u8(value: number): this {
        const b = Buffer.alloc(1);
        b.writeUInt8(value);
        return this.raw(b);
    }
    
    u32(value: number): this {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(value);
        return this.raw(b);
    }
    
    /** Up to `Number.MAX_SAFE_INTEGER`, which covers every seq, epoch, version and millisecond timestamp. */
    u64(value: number): this {
        const b = Buffer.alloc(8);
        b.writeBigUInt64BE(BigInt(value));
        return this.raw(b);
    }
    
    /** `u32(byte length) || bytes`, the string as UTF-8. */
    lp(value: string): this {
        const bytes = Buffer.from(value, "utf8");
        return this.u32(bytes.length).raw(bytes);
    }
    
    /** A NUL-terminated domain tag, so a hash of one kind can never be read as a hash of another. */
    tag(value: string): this {
        return this.raw(Buffer.from(value + "\0", "utf8"));
    }
    
    raw(bytes: Buffer): this {
        this.parts.push(bytes);
        return this;
    }
    
    bytes(): Buffer {
        return Buffer.concat(this.parts);
    }
}
