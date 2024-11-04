/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export class Max<T extends number = number> {
    
    constructor(public value: T = null) {
    }
    
    add(value: T) {
        if (this.value == null || value > this.value) {
            this.value = value;
        }
    }
}