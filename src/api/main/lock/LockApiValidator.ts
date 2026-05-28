/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../BaseValidator";
import { TypesValidator } from "../../TypesValidator";

export class LockApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("lockLock", this.builder.createObject({
            resourceId: this.tv.id,
            uuid: this.tv.id,
            lockLevel: this.builder.createEnum(["shared", "reserved", "pending", "exclusive"]),
        }));
        this.registerMethod("lockUnlock", this.builder.createObject({
            resourceId: this.tv.id,
            uuid: this.tv.id,
            lockLevel: this.builder.createEnum(["none", "shared"]),
        }));
        this.registerMethod("lockCheckReservedLock", this.builder.createObject({
            resourceId: this.tv.id,
            uuid: this.tv.id,
        }));
    }
}
