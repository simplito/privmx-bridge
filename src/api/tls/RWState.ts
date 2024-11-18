/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export class RWState {
    
    sequenceNumber: number;
    key?: Buffer;
    macKey?: Buffer;
    
    constructor(key?: Buffer, macKey?: Buffer) {
        this.key = key;
        this.macKey = macKey;
        this.sequenceNumber = 0;
    }
    
    isInitialized(): this is this&{key: Buffer, macKey:Buffer} {
        return this.key != null && this.macKey != null;
    }
}
