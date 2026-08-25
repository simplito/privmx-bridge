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
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS),
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            // One: the group is a grantee of itself and has exactly one grant key per epoch.
            groupKeys: this.builder.optional(this.tv.cloudGroupKeyEntrySetForNewGroup),
            policy: this.builder.optional(this.tv.containerPolicy),
            tree: this.tv.groupTreeState,
        }));
        // Metadata only. Membership moves the tree, so it goes through groupAddMember/groupRemoveMember.
        this.registerMethod("groupUpdate", this.builder.createObject({
            id: this.tv.groupId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            version: this.builder.int,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerPolicy),
        }));
        this.registerMethod("groupGenerateNewKey", this.builder.createObject({
            id: this.tv.groupId,
            groupPubKey: this.tv.groupPubKey,
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            // A rotation touches no node keys: one new grant edge, and the rungs that keep the old epochs reachable.
            grantEdge: this.tv.groupTreeEdge,
            rungs: this.builder.createListWithMaxLength(this.tv.groupArchiveRung, 256),
            groupKeys: this.builder.optional(this.tv.cloudGroupKeyEntrySet),
            expectedKeyVersion: this.builder.int,
            confirmationTag: this.builder.optional(this.tv.base64),
        }));
        this.registerMethod("groupDelete", this.builder.createObject({
            groupId: this.tv.groupId,
        }));
        this.registerMethod("groupGet", this.builder.createObject({
            groupId: this.tv.groupId,
            type: this.tv.optResourceType,
            // Defaults to "path" — the caller's own climb. "full" is `O(n)` and only a client validating the whole
            // structure for itself needs it.
            scope: this.builder.optional(this.builder.createEnum(["path", "full"])),
            // Serves the view needed to plan an operation on this member's seat, on top of the caller's own.
            forUserId: this.builder.optional(this.tv.cloudUserId),
            // The same, for a seat nobody holds yet — what an addition plans against.
            forPosition: this.builder.optional(this.builder.range(this.builder.int, 0, TypesValidator.MAX_GROUP_MEMBERS - 1)),
            // History from this version on: a warm client asks for what it has not verified yet.
            fromVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
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
            // Exactly one of the two; the service refuses a call that brings neither.
            transition: this.builder.optional(this.tv.groupTreeAdditionTransition),
            tree: this.builder.optional(this.tv.groupTreeState),
            expectedKeyVersion: this.builder.int,
        }));
        this.registerMethod("groupRemoveMember", this.builder.createObject({
            id: this.tv.groupId,
            userId: this.tv.cloudUserId,
            groupPubKey: this.tv.groupPubKey,
            keyId: this.tv.keyId,
            data: this.tv.groupData,
            // Exactly one of the two; the service refuses a call that brings neither. `transition` is the delta,
            // `tree` the whole new state a client may still send.
            transition: this.builder.optional(this.tv.groupTreeTransition),
            tree: this.builder.optional(this.tv.groupTreeState),
            // One epoch's worth of rungs: one mandatory unit rung plus the skip rungs, so O(log epoch) of them.
            rungs: this.builder.createListWithMaxLength(this.tv.groupArchiveRung, 256),
            // One: the group is a grantee of itself, and it has exactly one grant key per epoch.
            groupKeys: this.builder.optional(this.tv.cloudGroupKeyEntrySet),
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
