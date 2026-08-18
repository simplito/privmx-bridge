/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../BaseValidator";

export class LockApiValidator extends BaseValidator {
    
    // resourceId and uuid become part of a namespaced storage key (host:resourceId),
    // so their charset is restricted to a safe, delimiter-free alphabet. Keeping ":"
    // out of resourceId guarantees the (host, resourceId) -> key mapping is unambiguous.
    private static readonly ID_REGEX = /^[a-zA-Z0-9_-]{1,60}$/;
    private lockId = this.builder.error(this.builder.createCustom(value => {
        if (typeof value !== "string" || !LockApiValidator.ID_REGEX.test(value)) {
            throw new Error("Expected a 1-60 character id matching [a-zA-Z0-9_-]");
        }
    }), "INVALID_PARAMS");
    
    constructor() {
        super();
        
        this.registerMethod("lockLock", this.builder.createObject({
            resourceId: this.lockId,
            uuid: this.lockId,
            lockLevel: this.builder.createEnum(["shared", "reserved", "pending", "exclusive"]),
        }));
        this.registerMethod("lockUnlock", this.builder.createObject({
            resourceId: this.lockId,
            uuid: this.lockId,
            lockLevel: this.builder.createEnum(["none", "shared"]),
        }));
        this.registerMethod("lockCheckReservedLock", this.builder.createObject({
            resourceId: this.lockId,
            uuid: this.lockId,
        }));
    }
}
