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
            tree: this.builder.optional(this.tv.groupTreeState),
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
        this.registerMethod("groupAddMember", this.builder.createObject({
            id: this.tv.groupId,
            userId: this.tv.cloudUserId,
            role: this.builder.createEnum(["user", "manager"]),
            position: this.tv.intNonNegative,
            keyId: this.tv.keyId,
            data: this.tv.groupData,
            tree: this.tv.groupTreeState,
            keys: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384)),
            expectedKeyVersion: this.builder.int,
        }));
        this.registerMethod("groupRemoveMember", this.builder.createObject({
            id: this.tv.groupId,
            userId: this.tv.cloudUserId,
            groupPubKey: this.tv.groupPubKey,
            keyId: this.tv.keyId,
            data: this.tv.groupData,
            tree: this.tv.groupTreeState,
            // One epoch's worth of rungs: one mandatory unit rung plus the skip rungs, so O(log epoch) of them.
            rungs: this.builder.createListWithMaxLength(this.tv.groupArchiveRung, 256),
            keys: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384)),
            // At most one: the group is a grantee of itself, and it has exactly one grant key per epoch.
            groupKeys: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudGroupKeyEntrySet, 4)),
            expectedKeyVersion: this.builder.int,
            confirmationTag: this.builder.optional(this.tv.base64),
        }));
        this.registerMethod("groupCutEra", this.builder.createObject({
            id: this.tv.groupId,
            newFloor: this.builder.min(this.builder.int, 1),
            expectedKeyVersion: this.builder.int,
        }));
        this.registerMethod("groupPruneArchive", this.builder.createObject({
            id: this.tv.groupId,
            belowEpoch: this.builder.min(this.builder.int, 1),
            expectedKeyVersion: this.builder.int,
        }));
        this.registerMethod("groupGetKeyArchive", this.builder.createObject({
            id: this.tv.groupId,
            fromKeyVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
            toKeyVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
        }));
    }
}
