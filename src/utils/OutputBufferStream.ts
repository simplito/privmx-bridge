/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { StreamInterface } from "../CommonTypes";

export class OutputBufferStream implements StreamInterface {
    
    buffers: Buffer[];
    
    constructor() {
        this.buffers = [];
    }
    
    eof(): boolean {
        throw new Error("Method not implemented.");
    }
    
    getBuffer(): Buffer {
        return Buffer.concat(this.buffers);
    }
    
    getContentsAndClear(): Buffer {
        const result = Buffer.concat(this.buffers);
        this.buffers = [];
        return result;
    }
    
    read(_count: number): Buffer {
        throw new Error("Method not implemented.");
    }
    
    write(buffer: Buffer): void {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error("Given argument is not a buffer, get " + typeof(buffer));
        }
        this.buffers.push(buffer);
    }
}
