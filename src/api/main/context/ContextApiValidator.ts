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
            // Required: the first commit statement names the group by it, before the bridge assigns an id.
            resourceId: this.tv.uuidv4,
            type: this.tv.optResourceType,
            groupPubKey: this.tv.groupPubKey,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS),
            // Three envelopes, one per plane: `data` carries the roster tag, each metadata plane its own DIO
            // and its own domain-separated tag.
            data: this.tv.groupData,
            publicMeta: this.tv.groupData,
            privateMeta: this.tv.groupData,
            keyId: this.tv.keyId,
            // One: the group is a grantee of itself and has exactly one grant key per epoch.
            groupKeys: this.builder.optional(this.tv.cloudGroupKeyEntrySetForNewGroup),
            // The policy is `commit.policy`, signed into the chain by `policyHash`.
            tree: this.tv.groupTreeState,
            commit: this.tv.groupTreeCommitStatementWithPolicy,
        }));
        // One plane per method, and `createObject` is strict — so a request here structurally cannot carry the
        // other plane's envelope or the policy. That is what makes the per-plane ACL entry bound the effect
        // rather than only the intent. Membership moves the tree, so it goes through
        // groupAddMembers/groupRemoveMembers.
        this.registerMethod("groupUpdatePublicMeta", this.builder.createObject({
            id: this.tv.groupId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            version: this.builder.int,
        }));
        this.registerMethod("groupUpdatePrivateMeta", this.builder.createObject({
            id: this.tv.groupId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            version: this.builder.int,
        }));
        // A policy change is a signed commit like any other (T4-10): the policy is `commit.policy`, CAS-ed on both
        // counters. The old `{id, policy}` shape is refused.
        this.registerMethod("groupUpdatePolicy", this.builder.createObject({
            id: this.tv.groupId,
            commit: this.tv.groupTreeCommitStatementWithPolicy,
            expectedKeyVersion: this.builder.int,
            expectedRosterVersion: this.builder.int,
        }));
        this.registerMethod("groupGenerateNewKey", this.builder.createObject({
            id: this.tv.groupId,
            groupPubKey: this.tv.groupPubKey,
            data: this.tv.groupData,
            keyId: this.tv.keyId,
            // A rotation touches no node keys: one new grant edge, and the rungs that keep the old epochs reachable.
            grantEdge: this.tv.groupTreeEdge,
            commit: this.tv.groupTreeCommitStatement,
            rungs: this.builder.createListWithMaxLength(this.tv.groupArchiveRung, 256),
            groupKeys: this.builder.optional(this.tv.cloudGroupKeyEntrySet),
            expectedKeyVersion: this.builder.int,
            expectedRosterVersion: this.builder.int,
        }));
        this.registerMethod("groupDelete", this.builder.createObject({
            groupId: this.tv.groupId,
        }));
        this.registerMethod("groupGet", this.builder.createObject({
            groupId: this.tv.groupId,
            type: this.tv.optResourceType,
            // Defaults to "path" — the caller's own climb. "plan" adds every node record, which planning a commit
            // needs. "full" is `O(n)` and only a client validating the whole structure for itself needs it.
            scope: this.builder.optional(this.builder.createEnum(["path", "plan", "full"])),
            // Resolves these members' seats, which a removal names.
            forUserIds: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_BATCH)),
            // Have the bridge allocate the seats instead, so the caller never needs `leafAssignment` to find one.
            forNewMembers: this.builder.optional(this.builder.range(this.builder.int, 1, TypesValidator.MAX_GROUP_BATCH)),
            // Roster history from this version on — the audit trail. Absent serves the head alone, which is all
            // a read needs. There is no metadata trail to ask for: the current entry is always served.
            fromRosterVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
        }));
        this.registerMethod("groupList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        this.registerMethod("groupAddMembers", this.builder.createObject({
            id: this.tv.groupId,
            // At least one, or the call is a no-op that still appends a history entry and bumps the version.
            members: this.builder.createListWithRangeLength(this.builder.createObject({
                userId: this.tv.cloudUserId,
                role: this.builder.createEnum(["user", "manager"]),
            }), 1, TypesValidator.MAX_GROUP_BATCH),
            keyId: this.tv.keyId,
            data: this.tv.groupData,
            transition: this.tv.groupTreeAdditionTransition,
            commit: this.tv.groupTreeCommitStatement,
            expectedKeyVersion: this.builder.int,
            expectedRosterVersion: this.builder.int,
        }));
        this.registerMethod("groupRemoveMembers", this.builder.createObject({
            id: this.tv.groupId,
            userIds: this.builder.createListWithRangeLength(this.tv.cloudUserId, 1, TypesValidator.MAX_GROUP_BATCH),
            groupPubKey: this.tv.groupPubKey,
            keyId: this.tv.keyId,
            data: this.tv.groupData,
            transition: this.tv.groupTreeTransition,
            commit: this.tv.groupTreeCommitStatement,
            // One epoch's worth of rungs: one mandatory unit rung plus the skip rungs, so O(log epoch) of them.
            rungs: this.builder.createListWithMaxLength(this.tv.groupArchiveRung, 256),
            // One: the group is a grantee of itself, and it has exactly one grant key per epoch.
            groupKeys: this.builder.optional(this.tv.cloudGroupKeyEntrySet),
            expectedKeyVersion: this.builder.int,
            expectedRosterVersion: this.builder.int,
            abandonHistory: this.builder.optional(this.builder.bool),
        }));
        this.registerMethod("groupSelfUpdate", this.builder.createObject({
            id: this.tv.groupId,
            transition: this.tv.groupTreeSelfUpdateTransition,
            commit: this.tv.groupTreeCommitStatement,
            expectedKeyVersion: this.builder.int,
        }));
        this.registerMethod("groupGetTreeCommits", this.builder.createObject({
            groupId: this.tv.groupId,
            fromSeq: this.tv.intNonNegative,
            toSeq: this.builder.optional(this.builder.min(this.builder.int, 1)),
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
        this.registerMethod("groupRepairRung", this.builder.createObject({
            id: this.tv.groupId,
            rung: this.tv.groupArchiveRung,
        }));
        this.registerMethod("groupGetKeyArchive", this.builder.createObject({
            id: this.tv.groupId,
            fromKeyVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
            toKeyVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
        }));
        this.registerMethod("groupSendCustomEvent", this.builder.createObject({
            groupId: this.tv.groupId,
            channel: this.tv.wsChannelName,
            data: this.tv.unknown16Kb,
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS)),
        }));
    }
}
