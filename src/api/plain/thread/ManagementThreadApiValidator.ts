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

export class ManagementThreadApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getThread", this.builder.createObject({
            threadId: this.tv.threadId,
        }));
        
        this.registerMethod("listThreads", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            from: this.builder.nullable(this.tv.threadId),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("deleteThread", this.builder.createObject({
            threadId: this.tv.threadId,
        }));
        
        this.registerMethod("deleteManyThreads", this.builder.createObject({
            threadIds: this.builder.createListWithMaxLength(this.tv.threadId, 128),
        }));
        
        this.registerMethod("getThreadMessage", this.builder.createObject({
            threadMessageId: this.tv.threadMessageId,
        }));
        
        this.registerMethod("listThreadMessages", this.builder.createObject({
            threadId: this.tv.threadId,
            from: this.builder.nullable(this.tv.threadMessageId),
            limit: this.tv.limit,
            sortOrder: this.tv.sortOrder,
        }));
        
        this.registerMethod("deleteThreadMessage", this.builder.createObject({
            threadMessageId: this.tv.threadMessageId,
        }));
        
        this.registerMethod("deleteManyThreadMessages", this.builder.createObject({
            messageIds: this.builder.createListWithMaxLength(this.tv.threadMessageId, 128),
        }));
        
        this.registerMethod("deleteThreadMessagesOlderThan", this.builder.createObject({
            threadId: this.tv.threadId,
            timestamp: this.tv.timestamp,
        }));
    }
}
