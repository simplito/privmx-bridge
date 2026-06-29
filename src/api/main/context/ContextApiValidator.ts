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

export class ContextApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("contextGet", this.builder.createObject({
            id: this.tv.cloudContextId,
        }));
        this.registerMethod("contextList", this.builder.addFields(this.tv.listModel, {
            appPubKey: this.builder.optional(this.tv.eccPub),
        }));
        this.registerMethod("contextSendCustomEvent", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            channel: this.tv.wsChannelName,
            data: this.tv.unknown16Kb,
            users: this.builder.createList(this.builder.createObject({
                id: this.tv.cloudUserId,
                key: this.tv.userKeyData,
            })),
        }));
        this.registerMethod("contextGetUsers", this.builder.createObject({
            contextId: this.tv.cloudContextId,
        }));
        this.registerMethod("contextListUsers", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
        }));
        this.registerMethod("groupCreate", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            type: this.tv.optResourceType,
            groupPubKey: this.tv.groupPubKey,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        this.registerMethod("groupUpdate", this.builder.createObject({
            id: this.tv.groupId,
            groupPubKey: this.tv.groupPubKey,
            resourceId: this.builder.optional(this.tv.uuidv4),
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            version: this.builder.int,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerPolicy),
            expectedKeyVersion: this.builder.optional(this.builder.int),
            confirmationTag: this.builder.optional(this.tv.base64),
        }));
        this.registerMethod("groupGenerateNewKey", this.builder.createObject({
            id: this.tv.groupId,
            groupPubKey: this.tv.groupPubKey,
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            expectedKeyVersion: this.builder.int,
            confirmationTag: this.builder.optional(this.tv.base64),
        }));
        this.registerMethod("groupDelete", this.builder.createObject({
            groupId: this.tv.groupId,
        }));
        this.registerMethod("groupGet", this.builder.createObject({
            groupId: this.tv.groupId,
            type: this.tv.optResourceType,
        }));
        this.registerMethod("groupList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
    }
}
