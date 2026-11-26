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
import { SpaceService } from "../../../service/cloud/SpaceService";

export class ContextApiValidator extends BaseValidator {
    
    /** Spans per `groupGetKeyArchive` call: a descent path is at most ~66 spans (2 log2 + 2 over 32-bit epochs),
     *  with room for the alternatives a client asks for when one rung on it is broken. */
    static readonly MAX_ARCHIVE_SPANS = 128;
    /** keyIds, and grant keys, per `groupGetEpochKeys` call. */
    static readonly MAX_EPOCH_KEY_LOOKUPS = 32;
    /** Wrapped keys per space call. Adding recipients sends every key version for each of them, so this is what
     *  bounds recipients times versions in one `spaceAddRecipients`. An entry is at most ~5.2 KB of JSON (4 KB of
     *  data, 1 KB of signature), so a call stays near 21 MB: well under the WebSocket's 100 MiB message limit,
     *  which is the only bound a request body has (HTTP reads it whole). 16384 came to ~85 MB, at that limit.
     *  ponytail: a space rotated more often than this divided by the recipients added cannot take them in one
     *  call; serve the old versions from a ladder, as groups do, when a space gets that old. */
    static readonly MAX_SPACE_KEY_ENTRIES = 4096;
    
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
            resourceId: this.tv.groupResourceId,
            type: this.tv.optResourceType,
            groupPubKey: this.tv.groupPubKey,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS),
            visibleTo: this.builder.optional(this.builder.createEnum(["members", "context"])),
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
        // A policy change is a signed commit like any other: the policy is `commit.policy`, CAS-ed on both
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
        const removal = this.builder.createObject({
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
        });
        this.registerMethod("groupRemoveMembers", removal);
        // A reseat is a removal that keeps its subjects: the same request, another statement op.
        this.registerMethod("groupReseat", removal);
        this.registerMethod("groupSetRoles", this.builder.createObject({
            id: this.tv.groupId,
            changes: this.builder.createListWithRangeLength(this.builder.createObject({
                userId: this.tv.cloudUserId,
                role: this.builder.createEnum(["user", "manager"]),
            }), 1, TypesValidator.MAX_GROUP_BATCH),
            keyId: this.tv.keyId,
            data: this.tv.groupData,
            commit: this.tv.groupTreeCommitStatement,
            expectedKeyVersion: this.builder.int,
            expectedRosterVersion: this.builder.int,
        }));
        this.registerMethod("groupSelfUpdate", this.builder.createObject({
            id: this.tv.groupId,
            transition: this.tv.groupTreeSelfUpdateTransition,
            commit: this.tv.groupTreeCommitStatement,
            expectedKeyVersion: this.builder.int,
        }));
        this.registerMethod("groupGetMany", this.builder.createObject({
            groupIds: this.builder.createListWithMaxLength(this.tv.groupId, TypesValidator.MAX_GROUP_BATCH),
        }));
        this.registerMethod("groupGetPublicKey", this.builder.createObject({
            groupId: this.tv.groupId,
        }));
        this.registerMethod("groupSetVisibility", this.builder.createObject({
            groupId: this.tv.groupId,
            visibleTo: this.builder.createEnum(["members", "context"]),
        }));
        this.registerMethod("groupGetTreeCommits", this.builder.createObject({
            groupId: this.tv.groupId,
            fromSeq: this.tv.intNonNegative,
            toSeq: this.builder.optional(this.builder.min(this.builder.int, 1)),
        }));
        this.registerMethod("groupRepairRung", this.builder.createObject({
            id: this.tv.groupId,
            rung: this.tv.groupArchiveRung,
        }));
        this.registerMethod("groupGetKeyArchive", this.builder.createObject({
            id: this.tv.groupId,
            fromKeyVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
            toKeyVersion: this.builder.optional(this.builder.min(this.builder.int, 1)),
            spans: this.builder.optional(this.builder.createListWithMaxLength(this.builder.createObject({
                at: this.builder.min(this.builder.int, 1),
                target: this.builder.min(this.builder.int, 1),
            }), ContextApiValidator.MAX_ARCHIVE_SPANS)),
        }));
        this.registerMethod("groupGetEpochKeys", this.builder.createObject({
            id: this.tv.groupId,
            keyIds: this.builder.optional(this.builder.createListWithMaxLength(this.tv.keyId, ContextApiValidator.MAX_EPOCH_KEY_LOOKUPS)),
            groupPubKeys: this.builder.optional(this.builder.createListWithMaxLength(this.tv.groupPubKey, ContextApiValidator.MAX_EPOCH_KEY_LOOKUPS)),
        }));
        this.registerMethod("groupSendCustomEvent", this.builder.createObject({
            groupId: this.tv.groupId,
            channel: this.tv.wsChannelName,
            data: this.tv.unknown16Kb,
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, TypesValidator.MAX_GROUP_MEMBERS)),
        }));
        // A recipient is a group or a user, never both: the two shapes are told apart by which id they carry.
        const role = this.builder.createEnum(["user", "manager"]);
        const spaceRecipient = this.builder.createOneOf([
            this.builder.createObject({groupId: this.tv.groupId, role: role}),
            this.builder.createObject({userId: this.tv.cloudUserId, pubKey: this.tv.cloudUserPubKey, role: role}),
        ]);
        const spaceKeyEntry = this.builder.createObject({
            keyVersion: this.builder.min(this.builder.int, 1),
            recipient: this.builder.createOneOf([
                this.builder.createObject({groupId: this.tv.groupId, groupKeyVersion: this.builder.min(this.builder.int, 1)}),
                this.builder.createObject({userId: this.tv.cloudUserId}),
            ]),
            data: this.builder.maxLength(this.tv.base64, 4096),
            signature: this.builder.maxLength(this.tv.base64, 1024),
        });
        const hash32 = this.builder.createCustom(value => {
            if (typeof(value) !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
                throw new Error("Expected 32 bytes as lowercase hex");
            }
        });
        const signature = this.builder.rangeLength(this.tv.base64, 65, 65);
        const spaceStatement = this.builder.createObject({
            spaceId: this.tv.spaceId,
            contextId: this.tv.cloudContextId,
            seq: this.builder.min(this.builder.int, 1),
            prevDigest: this.builder.createOneOf([this.builder.createConst(""), hash32]),
            op: this.builder.createEnum(["create", "add", "remove", "rotate"]),
            date: this.tv.intNonNegative,
            keyVersion: this.builder.min(this.builder.int, 1),
            keyCommit: hash32,
            groups: this.builder.createListWithMaxLength(this.builder.createObject({
                groupId: this.tv.groupId, role: role, groupKeyVersion: this.builder.min(this.builder.int, 1), groupPubKey: this.tv.groupPubKey,
            }), SpaceService.MAX_RECIPIENTS),
            users: this.builder.createListWithMaxLength(this.builder.createObject({
                userId: this.tv.cloudUserId, pubKey: this.tv.cloudUserPubKey, role: role,
            }), SpaceService.MAX_RECIPIENTS),
            signer: this.tv.cloudUserId,
            signerPubKey: this.tv.cloudUserPubKey,
            via: this.builder.createOneOf([this.builder.createConst(""), this.tv.groupId]),
            signature: signature,
            viaSignature: this.builder.createOneOf([this.builder.createConst(""), signature]),
        });
        const spaceRecipients = this.builder.createListWithRangeLength(spaceRecipient, 1, SpaceService.MAX_RECIPIENTS);
        const spaceKeys = this.builder.createListWithRangeLength(spaceKeyEntry, 1, ContextApiValidator.MAX_SPACE_KEY_ENTRIES);
        const spaceId = this.builder.createObject({id: this.tv.spaceId});
        this.registerMethod("spaceCreate", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            resourceId: this.tv.groupResourceId,
            recipients: spaceRecipients,
            keyId: this.tv.keyId,
            keys: spaceKeys,
            publicMeta: this.tv.groupData,
            privateMeta: this.tv.groupData,
            statement: spaceStatement,
        }));
        this.registerMethod("spaceGet", spaceId);
        this.registerMethod("spaceGetStatements", this.builder.createObject({
            id: this.tv.spaceId,
            fromSeq: this.tv.intNonNegative,
            limit: this.builder.range(this.builder.int, 1, 100),
        }));
        this.registerMethod("spaceDelete", spaceId);
        this.registerMethod("spaceList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        this.registerMethod("spaceAddRecipients", this.builder.createObject({
            id: this.tv.spaceId,
            recipients: spaceRecipients,
            keys: spaceKeys,
            statement: spaceStatement,
        }));
        const rotation = {
            id: this.tv.spaceId,
            keyId: this.tv.keyId,
            keys: spaceKeys,
            expectedKeyVersion: this.builder.min(this.builder.int, 1),
            statement: spaceStatement,
        };
        this.registerMethod("spaceRotateKey", this.builder.createObject(rotation));
        this.registerMethod("spaceRemoveRecipients", this.builder.createObject({
            ...rotation,
            groups: this.builder.optional(this.builder.createListWithMaxLength(this.tv.groupId, SpaceService.MAX_RECIPIENTS)),
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, SpaceService.MAX_RECIPIENTS)),
        }));
        const metaUpdate = this.builder.createObject({
            id: this.tv.spaceId,
            meta: this.tv.groupData,
            version: this.builder.min(this.builder.int, 1),
        });
        this.registerMethod("spaceUpdatePublicMeta", metaUpdate);
        this.registerMethod("spaceUpdatePrivateMeta", metaUpdate);
    }
}
