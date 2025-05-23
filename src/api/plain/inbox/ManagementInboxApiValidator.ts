/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../BaseValidator";
import { TypesValidator } from "../../TypesValidator";

export class ManagementInboxApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getInbox", this.builder.createObject({
            inboxId: this.tv.inboxId,
        }));
        
        this.registerMethod("listInboxes", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            from: this.builder.nullable(this.tv.inboxId),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("deleteInbox", this.builder.createObject({
            inboxId: this.tv.inboxId,
        }));
        
        this.registerMethod("deleteManyInboxes", this.builder.createObject({
            inboxIds: this.builder.createListWithMaxLength(this.tv.inboxId, 128),
        }));
    }
}
