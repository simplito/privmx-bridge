/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export class RWState {
    
    initialized: boolean;
    sequenceNumber: number;
    key: Buffer;
    macKey: Buffer;
    
    constructor(key?: Buffer, macKey?: Buffer) {
        this.key = key;
        this.macKey = macKey;
        this.initialized = (this.key != null) && (this.macKey != null);
        this.sequenceNumber = 0;
    }
}
