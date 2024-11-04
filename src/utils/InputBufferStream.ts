/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { StreamInterface } from "../CommonTypes";

export class InputBufferStream implements StreamInterface {
    
    pos: number;
    
    constructor(private buffer: Buffer) {
        this.pos = 0;
    }
    
    eof(): boolean {
        return this.pos >= this.buffer.length;
    }
    
    getBuffer(): Buffer {
        return this.buffer;
    }
    
    getContentsAndClear(): Buffer {
        const buffer = this.buffer;
        this.buffer = Buffer.alloc(0);
        return buffer;
    }
    
    read(count: number): Buffer {
        const res = this.buffer.slice(this.pos, this.pos + count);
        this.pos += count;
        return res;
    }
    
    write(_buffer: Buffer): void {
        throw new Error("Method not implemented.");
    }
}
