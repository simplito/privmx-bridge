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

export class ThreadApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("threadCreate", this.builder.createObject({
            resourceId: this.builder.optional(this.tv.uuidv4),
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.threadData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        
        this.registerMethod("threadUpdate", this.builder.createObject({
            id: this.tv.threadId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.threadData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            version: this.tv.intNonNegative,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        
        this.registerMethod("threadDelete", this.builder.createObject({
            threadId: this.tv.threadId,
        }));
        
        this.registerMethod("threadDeleteMany", this.builder.createObject({
            threadIds: this.builder.createListWithMaxLength(this.tv.threadId, 128),
        }));
        
        this.registerMethod("threadGet", this.builder.createObject({
            threadId: this.tv.threadId,
            type: this.tv.optResourceType,
        }));
        
        this.registerMethod("threadList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate", "lastMsgDate"])),
        }));
        
        this.registerMethod("threadListAll", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate", "lastMsgDate"])),
        }));
        
        this.registerMethod("threadMessageSend", this.builder.createObject({
            threadId: this.tv.threadId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            data: this.tv.threadMessageData,
            keyId: this.tv.keyId,
        }));
        
        this.registerMethod("threadMessageUpdate", this.builder.createObject({
            messageId: this.tv.threadMessageId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            data: this.tv.threadMessageData,
            keyId: this.tv.keyId,
            version: this.builder.optional(this.tv.intNonNegative),
            force: this.builder.optional(this.builder.bool),
        }));
        
        this.registerMethod("threadMessageDelete", this.builder.createObject({
            messageId: this.tv.threadMessageId,
        }));
        
        this.registerMethod("threadMessageDeleteMany", this.builder.createObject({
            messageIds: this.builder.createListWithMaxLength(this.tv.threadMessageId, 128),
        }));
        
        this.registerMethod("threadMessageDeleteOlderThan", this.builder.createObject({
            threadId: this.tv.threadId,
            timestamp: this.tv.timestamp,
        }));
        
        this.registerMethod("threadMessageGet", this.builder.createObject({
            messageId: this.tv.threadMessageId,
        }));
        
        this.registerMethod("threadMessagesGet", this.builder.addFields(this.tv.listModel, {
            threadId: this.tv.threadId,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "updates"])),
        }));
        
        this.registerMethod("threadMessagesGetMy", this.builder.addFields(this.tv.listModel, {
            threadId: this.tv.threadId,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "updates"])),
        }));
        
        this.registerMethod("threadSendCustomEvent", this.builder.createObject({
            threadId: this.tv.threadId,
            channel: this.tv.wsChannelName,
            keyId: this.tv.keyId,
            data: this.tv.unknown16Kb,
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384)),
        }));
    }
}
