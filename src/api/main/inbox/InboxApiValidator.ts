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

export class InboxApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("inboxCreate", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            type: this.tv.optResourceType,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.inboxData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            policy: this.builder.optional(this.tv.containerWithoutItemPolicy),
        }));
        this.registerMethod("inboxUpdate", this.builder.createObject({
            id: this.tv.inboxId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.inboxData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            version: this.tv.intNonNegative,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerWithoutItemPolicy),
        }));
        this.registerMethod("inboxDelete", this.builder.createObject({
            inboxId: this.tv.inboxId,
        }));
        this.registerMethod("inboxDeleteMany", this.builder.createObject({
            inboxIds: this.builder.createListWithMaxLength(this.tv.inboxId, 128),
        }));
        this.registerMethod("inboxGet", this.builder.createObject({
            id: this.tv.inboxId,
            type: this.tv.optResourceType,
        }));
        this.registerMethod("inboxGetPublicView", this.builder.createObject({
            id: this.tv.inboxId,
        }));
        this.registerMethod("inboxList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            scope: this.tv.optionalContainerAccessScope,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        this.registerMethod("inboxListAll", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        this.registerMethod("inboxSend", this.builder.createObject({
            inboxId: this.tv.inboxId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            message: this.tv.threadMessageData,
            requestId: this.builder.optional(this.tv.requestId),
            files: this.builder.createListWithMaxLength(this.builder.createObject({
                fileIndex: this.builder.int,
                thumbIndex: this.builder.optional(this.builder.int),
                meta: this.tv.storeFileMeta,
                resourceId: this.builder.optional(this.tv.uuidv4),
            }), 128),
            version: this.builder.int,
        }));
        this.registerMethod("inboxSendCustomEvent", this.builder.createObject({
            inboxId: this.tv.inboxId,
            channel: this.tv.wsChannelName,
            keyId: this.tv.keyId,
            data: this.tv.unknown16Kb,
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384)),
        }));
    }
}
