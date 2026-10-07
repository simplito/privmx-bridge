/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import * as types from "../../types";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { CloudUser, Executor } from "../../CommonTypes";
import { CloudKeyService } from "./CloudKeyService";
import { GroupNotificationService } from "./GroupNotificationService";
import { CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { BasePolicy } from "./BasePolicy";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbDuplicateError } from "../../error/DbDuplicateError";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { BaseContainerService } from "./BaseContainerService";
import type { GroupAddMembersModel, GroupCutEraModel, GroupGenerateNewKeyModel, GroupPruneArchiveModel, GroupRemoveMembersModel, GroupSelfUpdateModel, GroupUpdatePolicyModel, GroupUpdatePrivateMetaModel, GroupUpdatePublicMetaModel, RotatedAlreadyData } from "../../api/main/context/ContextApiTypes";
import type { GroupRotationRateLimiter } from "../../cluster/master/ipcServices/GroupRotationRateLimiter";
import { TreeValidator } from "./keytree/TreeValidator";
import { CommitOp, SubmittedCommit, TreeCommit, TreeTransitionValidator } from "./keytree/TreeTransitionValidator";
import { LadderMath } from "./keytree/LadderMath";
import { CommitStatement, ExpectedStatement } from "./keytree/CommitStatement";
import { HashableTree, TreeHash } from "./keytree/TreeHash";
import { DateUtils } from "../../utils/DateUtils";
import { TreeMath } from "./keytree/TreeMath";
import { Config } from "../../cluster/common/ConfigUtils";
import { Utils } from "../../utils/Utils";

export class GroupService extends BaseContainerService {
    
    private policy: GroupPolicy;
    
    constructor(
        repositoryFactory: RepositoryFactory,
        activeUsersMap: ActiveUsersMap,
        host: types.core.Host,
        private cloudKeyService: CloudKeyService,
        private groupNotificationService: GroupNotificationService,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
        private groupRotationRateLimiter: GroupRotationRateLimiter,
        private config: Config,
    ) {
        super(repositoryFactory, activeUsersMap, host);
        this.policy = new GroupPolicy(this.policyService);
    }
    
    async getGroup(executor: Executor, groupId: types.group.GroupId, type: types.group.GroupType|undefined) {
        const group = await this.repositoryFactory.createGroupRepository().get(groupId);
        if (!group || (type && group.type !== type)) {
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        await this.checkCanRead(executor, group);
        return group;
    }
    
    private async checkCanRead(executor: Executor, group: db.group.Group) {
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, group.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupGet", ["groupId=" + group.id]);
            if (!this.policy.canReadContainer(user, context, group)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
    }
    
    /** The group plus its out-of-document state, read consistently with each other (`getFullState`). Separate
     *  from `getGroup` so callers that need only the document do not drag a tree and a full history along with it. */
    async getGroupWithState(executor: Executor, groupId: types.group.GroupId, type: types.group.GroupType|undefined, fromRosterVersion?: number) {
        const group = await this.getGroup(executor, groupId, type);
        const result = await this.repositoryFactory.createGroupRepository().getFullState(group, fromRosterVersion);
        if (result.group !== group) {
            // A commit landed during the read and `getFullState` served the newer document; it may have removed the caller.
            await this.checkCanRead(executor, result.group);
        }
        return result;
    }
    
    /** The statements at `seqs` — what vouches for the node records a `groupGet` response serves. For a caller
     *  that has already passed `getGroupWithState`'s read check; it checks nothing itself. */
    async getTreeCommitsAt(group: db.group.Group, seqs: number[]) {
        return this.repositoryFactory.createGroupRepository().getTreeCommitsAt(group.id, seqs);
    }
    
    /**
     * A page of the group's commit statements, `fromSeq < seq <= toSeq` (default: the latest). Readable by whoever
     * may read the group: every statement is signed, and clients check each one themselves.
     */
    async getTreeCommits(executor: Executor, groupId: types.group.GroupId, fromSeq: number, toSeq?: number) {
        const groupRepository = this.repositoryFactory.createGroupRepository();
        const group = await groupRepository.get(groupId);
        if (!group) {
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, group.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupGetTreeCommits", ["groupId=" + groupId]);
            if (!this.policy.canReadContainer(user, context, group)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        const latest = group.treeCommitSeq ?? 0;
        const upTo = Math.min(toSeq ?? latest, latest);
        const commits = upTo > fromSeq ? await groupRepository.getTreeCommitRange(groupId, fromSeq, upTo) : [];
        return {group, commits};
    }
    
    /**
     * A page of the context's groups.
     *
     * A group's roster is the membership graph of the context, and a summary carries it — so unless the policy
     * says the caller may see every group here, the page is narrowed to the groups they belong to. `listMy` is
     * what allows that narrowed view, `listAll` the unnarrowed one, the same split threads and stores use.
     *
     * Each group comes with its latest commit statement, all of them out of one lookup.
     */
    async getGroupsByContext(cloudUser: CloudUser, contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.group.Group) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupList", []);
        const all = this.policy.canListAllContainers(user, context);
        if (!all && !this.policy.canListMyContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const groupRepository = this.repositoryFactory.createGroupRepository();
        const groups = await groupRepository.getPage(contextId, listParams, sortBy, all ? undefined : user.userId);
        const treeCommits = await groupRepository.getLatestTreeCommits(groups.list);
        return {user, groups, treeCommits};
    }
    
    async createGroup(cloudUser: CloudUser, resourceId: types.core.ClientResourceId, contextId: types.context.ContextId, type: types.group.GroupType|undefined,
        groupPubKey: types.cloud.GroupPubKey, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.group.GroupData,
        publicMeta: types.group.GroupData, privateMeta: types.group.GroupData, keyId: types.core.KeyId,
        policy: types.cloud.ContainerPolicy, tree: types.cloud.GroupTreeState, statement: types.cloud.GroupTreeCommitStatement,
        groupKeys?: Omit<types.cloud.GroupKeyEntrySet, "group">) {
        const allUsers = Utils.uniqueFromArrays(users, managers);
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        this.assertWithinMemberLimit(allUsers.length);
        this.assertWithinSeatLimit(tree.numLeaves);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        if (allUsers.length === 0) {
            throw new AppException("INVALID_PARAMS", "there has to be at least one user or manager");
        }
        await this.cloudKeyService.checkUsersExistance(contextId, allUsers);
        const newGroupKeys = this.buildSelfAddressedKeysForNewGroup(groupKeys, keyId);
        const commit = this.assertCreatedTreeIsValid(tree, {users, managers}, user.userId);
        // The group has no id yet, so the creator signs the resourceId it chose instead.
        this.assertStatementIsValid(statement, user, {
            seq: 1,
            op: "create",
            groupId: resourceId,
            keyVersion: 1,
            groupPubKey: groupPubKey,
            rosterVersion: 1,
            users: users,
            managers: managers,
            tree: TreeHash.afterCommit([], commit, 1),
            path: commit.refreshed,
            // The roster is bound by `rosterHash` alone: no chain replay starts below seq 1.
            addedUsers: [],
            addedManagers: [],
            removed: [],
        });
        try {
            // One transaction: the genesis history entry and the initial tree must not survive a failure that
            // leaves the group itself uncreated, or the other way round.
            const group = await this.repositoryFactory.withTransaction(session =>
                this.repositoryFactory.createGroupRepository(session)
                    .createGroup(contextId, resourceId, type, groupPubKey, user.userId, managers, users, data, publicMeta, privateMeta, keyId, policy, tree, statement, newGroupKeys),
            );
            this.groupNotificationService.sendCreatedGroup(group);
            return group;
        }
        catch (err) {
            if (err instanceof DbDuplicateError) {
                throw new AppException("DUPLICATE_RESOURCE_ID");
            }
            throw err;
        }
    }
    
    /**
     * Rewrites the public metadata plane.
     *
     * Structurally cannot carry the private plane's envelope or the policy — the model has no field for either —
     * which is what makes `context/groupUpdatePublicMeta` bound what the call can *do* rather than only what it
     * is meant for.
     *
     * Membership is deliberately not here — seating a member and re-keying their path is one operation on the
     * tree. `addMembers`/`removeMembers` are the only ways in.
     */
    async updatePublicMeta(cloudUser: CloudUser, model: GroupUpdatePublicMetaModel) {
        const rGroup = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(model.id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdatePublicMeta", ["groupId=" + model.id]);
            // `canUpdateContainer` rather than `makeUpdateContainerCheck`: nothing here changes the managers
            // list, so that helper's two manager checks reduce to `P && !P` and cannot fire, and its policy
            // branch is unreachable because this call has no policy parameter.
            if (!this.policy.canUpdateContainer(user, context, oldGroup)) {
                throw new AppException("ACCESS_DENIED", "policy is not met");
            }
            // Its own counter and only its own — a concurrent private-metadata write must not make this lose.
            // Unconditional, unlike the other containers: the entry commits the version it lands at, so letting
            // a stale write through would publish a tag no client can verify.
            if (oldGroup.publicMetaVersion !== model.version) {
                throw new AppException("GROUP_VERSION_MISMATCH", "publicMetaVersion does not match");
            }
            // Metadata must be written under the current epoch's key, or a member removed at the next rotation
            // would keep the key to everything written after they left.
            if (model.keyId !== oldGroup.keyId) {
                throw new AppException("GROUP_META_KEY_MISMATCH");
            }
            if (oldGroup.clientResourceId && model.resourceId && oldGroup.clientResourceId !== model.resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            // Metadata integrity is committed inside the opaque `data` (endpoint DIO) and verified client-side.
            try {
                const group = await groupRepository.updatePublicMeta(
                    oldGroup, user.userId, model.data, model.keyId, model.resourceId || null,
                );
                if (!group) {
                    // The CAS lost: another public-metadata write landed between the read above and the write.
                    throw new AppException("GROUP_VERSION_MISMATCH", "publicMetaVersion does not match");
                }
                return group;
            }
            catch (err) {
                if (err instanceof DbDuplicateError) {
                    throw new AppException("DUPLICATE_RESOURCE_ID");
                }
                throw err;
            }
        });
        this.groupNotificationService.sendUpdatedGroup(rGroup, [], "publicMetaUpdated");
        return rGroup;
    }
    
    /**
     * Rewrites the private metadata plane — the mirror of `updatePublicMeta`, against its own counter and its
     * own ACL entry.
     *
     * Kept as its own body rather than a helper parameterised by plane: the two counters would then sit one
     * variable apart, which is exactly the slip the split exists to prevent.
     */
    async updatePrivateMeta(cloudUser: CloudUser, model: GroupUpdatePrivateMetaModel) {
        const rGroup = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(model.id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdatePrivateMeta", ["groupId=" + model.id]);
            if (!this.policy.canUpdateContainer(user, context, oldGroup)) {
                throw new AppException("ACCESS_DENIED", "policy is not met");
            }
            if (oldGroup.privateMetaVersion !== model.version) {
                throw new AppException("GROUP_VERSION_MISMATCH", "privateMetaVersion does not match");
            }
            if (model.keyId !== oldGroup.keyId) {
                throw new AppException("GROUP_META_KEY_MISMATCH");
            }
            if (oldGroup.clientResourceId && model.resourceId && oldGroup.clientResourceId !== model.resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            try {
                const group = await groupRepository.updatePrivateMeta(
                    oldGroup, user.userId, model.data, model.keyId, model.resourceId || null,
                );
                if (!group) {
                    throw new AppException("GROUP_VERSION_MISMATCH", "privateMetaVersion does not match");
                }
                return group;
            }
            catch (err) {
                if (err instanceof DbDuplicateError) {
                    throw new AppException("DUPLICATE_RESOURCE_ID");
                }
                throw err;
            }
        });
        this.groupNotificationService.sendUpdatedGroup(rGroup, [], "privateMetaUpdated");
        return rGroup;
    }
    
    /**
     * Sets the group's policy, and nothing else.
     *
     * No version, no CAS and no epoch guard: the policy lives outside the client's signed envelope, so there is
     * no counter a client could know, no key to write it under and nothing for a reader to re-verify. It moves
     * neither metadata counter and appends no entry — deliberately, or a policy change would strand the epoch of
     * a plane it did not rewrite.
     *
     * No transaction either: one document, one `updateOne`, nothing appended anywhere. `withTransaction` would
     * buy nothing a single-document write does not already give and only add a retry surface.
     */
    async updatePolicy(cloudUser: CloudUser, model: GroupUpdatePolicyModel) {
        this.policyService.validateContainerPolicyForContainer("policy", model.policy);
        const groupRepository = this.repositoryFactory.createGroupRepository();
        const oldGroup = await groupRepository.get(model.id);
        if (!oldGroup) {
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdatePolicy", ["groupId=" + model.id]);
        // The `updatePolicy` gate and the context-level veto, and NOT `update`. Follows generateNewGroupKey and
        // threadRotateKeys: riding on `update` meant an operator who widened `update` handed out policy
        // rewriting along with it.
        if (!this.policy.canOverwriteContextPolicy(context) || !this.policy.canUpdateContainerPolicy(user, context, oldGroup)) {
            throw new AppException("ACCESS_DENIED", "cannot update policy");
        }
        const group = await groupRepository.updatePolicy(oldGroup, user.userId, model.policy);
        if (!group) {
            // No CAS to lose: the only way the filter misses is the group going away between the read and here.
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        this.groupNotificationService.sendUpdatedGroup(group, [], "policyUpdated");
        return group;
    }
    
    /** Rotates the grant keypair without removing anybody: the epoch advances, the new grant key is wrapped to
     *  the unchanged root, the rungs keep the old epochs reachable. One edge, whatever the group's size. */
    async generateNewGroupKey(cloudUser: CloudUser, model: GroupGenerateNewKeyModel) {
        const rGroup = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion, model.expectedRosterVersion);
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupRotateKeys", ["groupId=" + model.id]);
            // Gated by the `rotateKeys` policy, same as every other container's rotate endpoint. It defaults to
            // "manager" for groups (the siblings default to "user") because rotating a group's grant key stales
            // every container granted to it, not just this one document.
            if (!this.policy.canRotateContainerKeys(user, context, oldGroup)) {
                throw new AppException("ACCESS_DENIED");
            }
            await this.checkRateLimit(this.rotationRateLimitKey(model.id));
            const newKeyVersion = oldGroup.keyVersion + 1;
            await this.assertRotationGrantEdgeIsValid(groupRepository, oldGroup, model.grantEdge, newKeyVersion);
            this.assertRungsAreValid(model.rungs, newKeyVersion, oldGroup);
            // A rotation moves no node, so the statement vouches for the tree exactly as it stands.
            this.assertTreeCommitsSupported(oldGroup);
            const nodes = await groupRepository.getNodes(oldGroup);
            this.assertStatementIsValid(model.commit, user, {
                ...this.unchangedStatement(oldGroup, "rotate", TreeHash.of({...oldGroup, nodes}), []),
                keyVersion: newKeyVersion,
                groupPubKey: model.groupPubKey,
                rosterVersion: oldGroup.rosterVersion + 1,
            });
            const result = await groupRepository.generateNewGroupKey({
                oldGroup,
                modifier: user.userId,
                newGroupPubKey: model.groupPubKey,
                data: model.data,
                keyId: model.keyId,
                grantEdge: model.grantEdge,
                statement: model.commit,
                rungs: model.rungs,
                groupKeys: this.buildSelfAddressedKeys(oldGroup, model.groupKeys, model.keyId, newKeyVersion),
                ...(model.confirmationTag ? {confirmationTag: model.confirmationTag} : {}),
            });
            if (!result) {
                const winner = await groupRepository.get(model.id);
                throw new AppException("ROTATED_ALREADY", await this.buildRotatedAlreadyData(groupRepository, winner!));
            }
            return result;
        });
        // Charge the rotation rate-limit budget only on a committed rotation, so lost CAS races / version
        // mismatches (ROTATED_ALREADY) don't consume the group's quota.
        await this.groupRotationRateLimiter.record({key: this.rotationRateLimitKey(model.id)});
        this.groupNotificationService.sendUpdatedGroup(rGroup, [], "keyRotated");
        return rGroup;
    }
    
    // ── Tree-backed membership ──────────────────────────────────────────────────────────────────────────────
    
    /**
     * Adds members **without advancing the epoch**, so no container the group can read goes stale.
     *
     * The bridge's job is to confirm the client did not smuggle anything else into the same call — a moved
     * member, a node re-keyed off the adder's own path, a bumped epoch. The newcomers' paths are blanked, not
     * re-keyed, and the adder must hold a seat.
     *
     * A batch is one delta, not `k` additions applied in turn, and lands under a single CAS or not at all.
     */
    async addMembers(cloudUser: CloudUser, model: GroupAddMembersModel) {
        const {group} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion, model.expectedRosterVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupAddMembers", ["groupId=" + model.id]);
            // An addition does not rotate the epoch, so it must not rotate the content key either — the roster
            // head has to stay at the current epoch for a metadata write to resolve the right key off it.
            if (model.keyId !== oldGroup.keyId) {
                throw new AppException("GROUP_META_KEY_MISMATCH");
            }
            const addedUserIds = model.members.map(member => member.userId);
            const managers = [...oldGroup.managers, ...model.members.filter(member => member.role === "manager").map(member => member.userId)];
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, managers, undefined);
            for (const userId of addedUserIds) {
                if (oldGroup.users.includes(userId) || oldGroup.managers.includes(userId)) {
                    throw new AppException("INVALID_PARAMS", `user '${userId}' is already a member`);
                }
            }
            this.assertWithinMemberLimit(Utils.uniqueFromArrays(oldGroup.users, oldGroup.managers, addedUserIds).length);
            this.assertWithinSeatLimit(TreeMath.numLeavesToSeatAll(model.transition.positions, oldGroup.numLeaves));
            await this.cloudKeyService.checkUsersExistance(oldGroup.contextId, addedUserIds);
            const {commit, nodes} = await this.assertCommitIsAcceptable(groupRepository, oldGroup, {
                kind: "add", committer: user.userId, addedUsers: addedUserIds, positions: model.transition.positions,
            }, {...model.transition, refreshedNodes: model.transition.seatedNodes});
            const newUsers = model.members.filter(member => member.role === "user").map(member => member.userId);
            const newManagers = model.members.filter(member => member.role === "manager").map(member => member.userId);
            this.assertStatementIsValid(model.commit, user, {
                ...this.unchangedStatement(oldGroup, "add", TreeHash.afterCommit(nodes, commit, (oldGroup.treeCommitSeq ?? 0) + 1), commit.refreshed),
                rosterVersion: oldGroup.rosterVersion + 1,
                users: [...oldGroup.users, ...newUsers],
                managers: [...oldGroup.managers, ...newManagers],
                addedUsers: newUsers,
                addedManagers: newManagers,
            });
            // The newcomers get no key entries of their own: they climb to the grant key and open the group's
            // single self-addressed metadata entry, the same way every other member does.
            const result = await groupRepository.addMembersWithTransition({
                oldGroup,
                commit,
                statement: model.commit,
                modifier: user.userId,
                addedMembers: model.members.map(member => ({userId: member.userId, role: member.role})),
                keyId: model.keyId,
                data: model.data,
            });
            if (!result) {
                throw new AppException("ROTATED_ALREADY", await this.buildRotatedAlreadyData(groupRepository, (await groupRepository.get(model.id))!));
            }
            return {group: result, context: usedContext};
        });
        this.groupNotificationService.sendUpdatedGroup(group, [], "memberAdded");
        return group;
    }
    
    /**
     * Removes members: blank their leaves and keyed paths, re-key the remover's own path, rotate the grant
     * keypair, record the rungs.
     *
     * All of it in one call, because any part alone is useless or unsafe. A refresh without a new epoch leaves
     * every container readable with the old grant key; a new epoch without rungs orphans the group's own
     * history; rungs pointing the wrong way would hand the departing member a later key.
     */
    async removeMembers(cloudUser: CloudUser, model: GroupRemoveMembersModel) {
        const {group, context} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion, model.expectedRosterVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupRemoveMembers", ["groupId=" + model.id]);
            if (model.abandonHistory) {
                // It cuts the era as `groupCutEra` would, so it needs that permission too.
                this.cloudAclChecker.verifyAccess(user.acl, "context/groupCutEra", ["groupId=" + model.id]);
            }
            if (model.userIds.includes(user.userId)) {
                // The remover mints the new grant key, so the member supposed to lose the epoch would be the one
                // choosing it. Leaving is somebody else's removal of you.
                throw new AppException("INVALID_PARAMS", "cannot remove yourself");
            }
            const leaving = new Set(model.userIds);
            const managers = oldGroup.managers.filter(u => !leaving.has(u));
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, managers, undefined);
            for (const userId of model.userIds) {
                if (!oldGroup.users.includes(userId) && !oldGroup.managers.includes(userId)) {
                    throw new AppException("INVALID_PARAMS", `user '${userId}' is not a member`);
                }
            }
            // Counted over the distinct roster rather than `users.length + managers.length`: somebody on both
            // lists would otherwise be counted twice, and a batch can empty the group in one call.
            const remaining = Utils.uniqueFromArrays(oldGroup.users, oldGroup.managers).filter(u => !leaving.has(u));
            if (remaining.length < 1) {
                throw new AppException("INVALID_PARAMS", "cannot remove the last member of a group");
            }
            // A removal advances the epoch, so it is charged against the same per-group budget as an explicit
            // rotation: the cost falls on every container the group can read, not on the caller. One batch is
            // one epoch, so it is charged once however many members it removes.
            await this.checkRateLimit(this.rotationRateLimitKey(model.id));
            const newKeyVersion = oldGroup.keyVersion + 1;
            const {commit, nodes} = await this.assertCommitIsAcceptable(groupRepository, oldGroup, {
                kind: "remove", committer: user.userId, removedUsers: model.userIds, blankedPositions: model.transition.blankedPositions,
            }, model.transition);
            this.assertStatementIsValid(model.commit, user, {
                ...this.unchangedStatement(oldGroup, "remove", TreeHash.afterCommit(nodes, commit, (oldGroup.treeCommitSeq ?? 0) + 1), commit.refreshed),
                keyVersion: newKeyVersion,
                groupPubKey: model.groupPubKey,
                rosterVersion: oldGroup.rosterVersion + 1,
                users: oldGroup.users.filter(u => !leaving.has(u)),
                managers: managers,
                removed: model.userIds,
            });
            if (!model.abandonHistory) {
                this.assertRungsAreValid(model.rungs, newKeyVersion, oldGroup);
            }
            else if (model.rungs.length > 0) {
                // Nobody could recover the old grant key, so nothing can point down to it: the era closes here.
                throw new AppException("GROUP_ARCHIVE_INVALID", {kind: "RUNGS_WITH_ABANDONED_HISTORY", count: model.rungs.length});
            }
            // The new epoch's metadata key travels as one self-addressed entry, not one wrap per survivor.
            const result = await groupRepository.removeMembersWithTransition({
                groupKeys: this.buildSelfAddressedKeys(oldGroup, model.groupKeys, model.keyId, newKeyVersion),
                oldGroup,
                modifier: user.userId,
                removedUsers: model.userIds,
                newGroupPubKey: model.groupPubKey,
                keyId: model.keyId,
                data: model.data,
                rungs: model.rungs,
                commit,
                statement: model.commit,
                ...(model.confirmationTag ? {confirmationTag: model.confirmationTag} : {}),
                ...(model.abandonHistory ? {abandonHistory: true} : {}),
            });
            if (!result) {
                throw new AppException("ROTATED_ALREADY", await this.buildRotatedAlreadyData(groupRepository, (await groupRepository.get(model.id))!));
            }
            return {group: result, context: usedContext};
        });
        await this.groupRotationRateLimiter.record({key: this.rotationRateLimitKey(model.id)});
        // The removed members are notified too: their clients need to learn they can stop trying to climb.
        const additionalUsersToNotify = await this.getUsersWithStatus(model.userIds, context.id, context.solution);
        this.groupNotificationService.sendUpdatedGroup(group, additionalUsersToNotify, "memberRemoved");
        if (model.abandonHistory) {
            this.groupNotificationService.sendUpdatedGroup(group, [], "eraCut");
        }
        return group;
    }
    
    /**
     * Re-keys the caller's own keyed path — the only way a blank left by a removal or an addition is filled
     * again, and only by somebody seated under it.
     *
     * Deliberately quiet: no epoch, no roster version, no history entry, no notification. Nothing a reader has
     * cached goes stale — the grant key is the same, only the route to it changed — so there is nothing to tell
     * anybody. Any seated member may do it for themselves; it is rate-limited per member instead of gated by
     * policy, because refusing it only leaves the group's paths blank for longer.
     */
    async selfUpdate(cloudUser: CloudUser, model: GroupSelfUpdateModel) {
        const {group, userId} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupSelfUpdate", ["groupId=" + model.id]);
            if (!oldGroup.leafAssignment.includes(user.userId)) {
                throw new AppException("ACCESS_DENIED");
            }
            await this.checkRateLimit(this.selfUpdateRateLimitKey(model.id, user.userId));
            const {commit, nodes} = await this.assertCommitIsAcceptable(groupRepository, oldGroup, {kind: "selfUpdate", committer: user.userId}, model.transition);
            this.assertStatementIsValid(model.commit, user, this.unchangedStatement(
                oldGroup, "selfUpdate", TreeHash.afterCommit(nodes, commit, (oldGroup.treeCommitSeq ?? 0) + 1), commit.refreshed,
            ));
            if (!await groupRepository.selfUpdateWithTransition(oldGroup, commit, model.commit)) {
                throw new AppException("ROTATED_ALREADY", await this.buildRotatedAlreadyData(groupRepository, (await groupRepository.get(model.id))!));
            }
            return {group: oldGroup, userId: user.userId};
        });
        await this.groupRotationRateLimiter.record({key: this.selfUpdateRateLimitKey(model.id, userId)});
        return group;
    }
    
    /** Closes the current era: everything below the new floor becomes unreachable by descending. */
    async cutEra(cloudUser: CloudUser, model: GroupCutEraModel) {
        const {group} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupCutEra", ["groupId=" + model.id]);
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, oldGroup.managers, undefined);
            const keyVersion = oldGroup.keyVersion;
            const currentFloor = oldGroup.eraFloor;
            if (!Number.isInteger(model.newFloor) || model.newFloor < 1) {
                throw new AppException("INVALID_PARAMS", "newFloor must be a positive integer");
            }
            if (model.newFloor <= currentFloor) {
                // Lowering a floor would resurrect epochs a previous cut deliberately abandoned.
                throw new AppException("INVALID_PARAMS", `newFloor must be above the current floor ${currentFloor}`);
            }
            if (model.newFloor > keyVersion) {
                throw new AppException("INVALID_PARAMS", `newFloor cannot exceed the current epoch ${keyVersion}`);
            }
            await this.assertMetaSurvivesFloor(groupRepository, model.id, model.newFloor);
            const result = await groupRepository.cutEra(oldGroup, model.newFloor);
            if (!result) {
                throw new AppException("ROTATED_ALREADY", await this.buildRotatedAlreadyData(groupRepository, (await groupRepository.get(model.id))!));
            }
            return {group: result, context: usedContext};
        });
        this.groupNotificationService.sendUpdatedGroup(group, [], "eraCut");
        return group;
    }
    
    /** Deletes rungs below a watermark. Recorded separately from a cut era so a client that cannot descend
     *  learns why — pruned, not tampered with. */
    async pruneArchive(cloudUser: CloudUser, model: GroupPruneArchiveModel) {
        const {group} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupPruneArchive", ["groupId=" + model.id]);
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, oldGroup.managers, undefined);
            const keyVersion = oldGroup.keyVersion;
            if (!Number.isInteger(model.belowEpoch) || model.belowEpoch < 1) {
                throw new AppException("INVALID_PARAMS", "belowEpoch must be a positive integer");
            }
            if (model.belowEpoch > keyVersion) {
                throw new AppException("INVALID_PARAMS", `belowEpoch cannot exceed the current epoch ${keyVersion}`);
            }
            await this.assertMetaSurvivesFloor(groupRepository, model.id, model.belowEpoch);
            const result = await groupRepository.pruneArchive(oldGroup, model.belowEpoch);
            if (!result) {
                throw new AppException("ROTATED_ALREADY", await this.buildRotatedAlreadyData(groupRepository, (await groupRepository.get(model.id))!));
            }
            return {group: result, context: usedContext};
        });
        this.groupNotificationService.sendUpdatedGroup(group, [], "archivePruned");
        return group;
    }
    
    /**
     * Serves the Epoch Ladder, optionally windowed.
     *
     * Read access is enough: every rung is a ciphertext only a holder of the epoch key above it can open.
     */
    async getKeyArchive(executor: Executor, groupId: types.group.GroupId, fromKeyVersion?: number, toKeyVersion?: number) {
        const group = await this.getGroup(executor, groupId, undefined);
        // The window is applied by the query, not to a loaded array: a client descending twenty epochs reads
        // twenty documents off the index, whatever the size of the group's archive.
        const rungs = await this.repositoryFactory.createGroupRepository().getArchiveRungs(groupId, fromKeyVersion, toKeyVersion);
        return {group, rungs};
    }
    
    /**
     * Refuses to strand either metadata plane below a floor.
     *
     * Each plane's entry stays at the epoch it was written under — that is what stops a membership change from
     * rewriting it — so cutting or pruning below that epoch would take away the only route to its key and make
     * that plane unreadable for everyone, permanently. Before the planes were split this could not happen: every
     * removal republished the metadata at the new epoch.
     *
     * One lookup by derived id per plane. The two planes move independently, so they may sit at different
     * epochs and only one may be stranded. The message therefore names the stranded planes and the endpoint
     * that lifts each one rather than leaving the caller to guess: it is a per-plane fix, and rewriting the
     * wrong plane costs the client a signed envelope for nothing. It deliberately does not name
     * `groupUpdatePolicy` — a policy write moves no counter and appends no entry, so it lifts no epoch, and
     * advertising it would send the operator into a loop that can never clear the refusal.
     */
    private async assertMetaSurvivesFloor(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        groupId: types.group.GroupId,
        floor: number,
    ) {
        const heads = await groupRepository.getMetaHeadKeyVersions(groupId);
        const stranded = ([
            {plane: "public", at: heads.publicMeta, fix: "context.groupUpdatePublicMeta"},
            {plane: "private", at: heads.privateMeta, fix: "context.groupUpdatePrivateMeta"},
        ] as const).filter(entry => entry.at !== null && entry.at < floor);
        if (stranded.length > 0) {
            const where = stranded.map(entry => `${entry.plane} metadata sits at epoch ${entry.at}`).join(" and ");
            const how = stranded.map(entry => entry.fix).join(" and ");
            throw new AppException("GROUP_META_UNREACHABLE",
                `${where}, below the requested floor ${floor}; call ${how} first to rewrite ${stranded.length > 1 ? "them" : "it"} at the current epoch`);
        }
    }
    
    /** Loads a group for a tree operation and rejects a caller working from a superseded epoch. */
    private async getGroupForTreeOperation(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        cloudUser: CloudUser,
        groupId: types.group.GroupId,
        expectedKeyVersion: number,
        expectedRosterVersion?: number,
    ) {
        const group = await groupRepository.get(groupId);
        if (!group) {
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        // The roster plane's precondition, checked first because it is the cheaper answer: the caller can
        // re-read and re-plan without adopting a new epoch. Only the operations that write a roster entry pass
        // one — a cut or a prune touches neither plane's counter, so a concurrent addition is no conflict.
        if (expectedRosterVersion !== undefined && group.rosterVersion !== expectedRosterVersion) {
            await this.cloudAccessValidator.getUserFromContext(cloudUser, group.contextId);
            throw new AppException("GROUP_ROSTER_VERSION_MISMATCH", {rosterVersion: group.rosterVersion, expected: expectedRosterVersion});
        }
        const currentKeyVersion = group.keyVersion;
        if (currentKeyVersion !== expectedKeyVersion) {
            // The client computed its wraps against a tree that no longer exists. Handing back the winner's
            // state lets it recompute instead of guessing — but only to somebody who belongs here: this runs
            // before the caller has passed any other gate, and the payload carries the group's key material.
            await this.cloudAccessValidator.getUserFromContext(cloudUser, group.contextId);
            throw new AppException("ROTATED_ALREADY", await this.buildRotatedAlreadyData(groupRepository, group));
        }
        return group;
    }
    
    /**
     * Checks the one edge a rotation is allowed to write: the grant edge, at the epoch being created, addressed
     * to the current root.
     *
     * `childGeneration` is the load-bearing check — an edge planned against a superseded root would wrap the new
     * grant key to a node key nobody can reach, locking every member out of the epoch.
     */
    private async assertRotationGrantEdgeIsValid(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        group: db.group.Group,
        edge: types.cloud.GroupTreeEdge,
        newKeyVersion: number,
    ) {
        const problems: {kind: string, expected?: string|number, got?: string|number}[] = [];
        if (!edge.isGrantEdge) {
            problems.push({kind: "NOT_A_GRANT_EDGE"});
        }
        if (edge.parentGeneration !== newKeyVersion) {
            problems.push({kind: "GRANT_EDGE_WRONG_EPOCH", expected: newKeyVersion, got: edge.parentGeneration});
        }
        const rootIndex = TreeMath.root(group.numLeaves);
        if (edge.childKind !== "node" || edge.childIndex !== rootIndex) {
            problems.push({kind: "GRANT_EDGE_WRONG_CHILD", expected: `node:${rootIndex}`, got: `${edge.childKind}:${edge.childUserId ?? edge.childIndex}`});
        }
        else {
            const root = await groupRepository.getRootNode(group);
            if (!root) {
                throw new AppException("GROUP_HAS_NO_TREE");
            }
            if (edge.childGeneration !== root.generation) {
                problems.push({kind: "STALE_CHILD_GENERATION", expected: root.generation, got: edge.childGeneration ?? -1});
            }
        }
        if (!edge.data) {
            problems.push({kind: "EMPTY_EDGE_DATA"});
        }
        if (problems.length > 0) {
            throw new AppException("GROUP_TREE_INVALID", problems);
        }
    }
    
    /** The one self-addressed entry a new group may carry: its own metadata key at epoch 1. No `group` to check
     *  against — the id does not exist yet, and the repository files the entry against the group it generates. */
    private buildSelfAddressedKeysForNewGroup(
        insert: Omit<types.cloud.GroupKeyEntrySet, "group">|undefined,
        keyId: types.core.KeyId,
    ): Omit<types.cloud.GroupKeysEntry, "group">[] {
        if (!insert) {
            return [];
        }
        GroupService.assertSelfAddressedEntry(insert, keyId, 1);
        return [{keys: [{keyId: insert.keyId, data: insert.data, groupEpoch: insert.groupEpoch}]}];
    }
    
    /** All the bridge can check about a self-addressed metadata key: that it names the keyId being introduced,
     *  the epoch being created, and carries something. */
    private static assertSelfAddressedEntry(insert: Omit<types.cloud.GroupKeyEntrySet, "group">, keyId: types.core.KeyId, epoch: number) {
        if (insert.keyId !== keyId) {
            throw new AppException("INVALID_PARAMS", `groupKeys entry must name the new keyId '${keyId}'`);
        }
        if (insert.groupEpoch !== epoch) {
            // An entry wrapped to an earlier epoch's grant key would still open for the member being removed,
            // since that is the key they hold.
            throw new AppException("INVALID_PARAMS", `groupKeys entry must name epoch ${epoch}`);
        }
        if (!insert.data) {
            throw new AppException("INVALID_PARAMS", "groupKeys entry carries no data");
        }
    }
    
    /** Checked before anything else, so exceeding it reads as "too many members" rather than as whichever
     *  field happens to overflow first. */
    private assertWithinMemberLimit(requested: number) {
        const limit = this.config.maxGroupMembers;
        if (requested > limit) {
            throw new AppException("GROUP_MEMBER_LIMIT_EXCEEDED", {limit, requested});
        }
    }
    
    /**
     * The same limit applied to *seats* rather than members.
     *
     * Members alone do not bound the tree: a removal leaves a blank, and an addition may append past it, so
     * remove/add cycles grow `numLeaves` and `leafAssignment` without ever growing the roster. Unchecked, that
     * is an array on the group document with no ceiling — and eventually seats `groupGet.forPosition` can no
     * longer name.
     */
    private assertWithinSeatLimit(requestedNumLeaves: number) {
        const limit = this.config.maxGroupMembers;
        if (requestedNumLeaves > limit) {
            throw new AppException("GROUP_MEMBER_LIMIT_EXCEEDED", {limit, requested: requestedNumLeaves, seats: true});
        }
    }
    
    private buildSelfAddressedKeys(
        group: db.group.Group,
        insert: types.cloud.GroupKeyEntrySet|undefined,
        keyId: types.core.KeyId,
        newKeyVersion: number,
    ): types.cloud.GroupKeysEntry[] {
        const existing = group.groupKeys ?? [];
        if (!insert) {
            return existing;
        }
        if (insert.group !== group.id) {
            // Wrapping the group's metadata key to a *different* group would hand it to that group's members,
            // who are not members here.
            throw new AppException("INVALID_PARAMS", `groupKeys entry must be addressed to group '${group.id}'`);
        }
        GroupService.assertSelfAddressedEntry(insert, keyId, newKeyVersion);
        // Kept per epoch rather than replaced: an older `data` entry stays readable to whoever can descend the
        // ladder to the epoch it was written at.
        return [...existing, {group: insert.group, keys: [{keyId: insert.keyId, data: insert.data, groupEpoch: insert.groupEpoch}]}];
    }
    
    /**
     * Runs a commit through `TreeTransitionValidator.validateCommit` against every node record of the group, and
     * returns what storage applies. The committer is the caller, never anything the request names.
     */
    private async assertCommitIsAcceptable(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        group: db.group.Group,
        op: CommitOp,
        submitted: SubmittedCommit,
    ): Promise<{commit: TreeCommit, nodes: types.cloud.GroupTreeNode[]}> {
        this.assertTreeCommitsSupported(group);
        const nodes = await groupRepository.getNodes(group);
        const result = TreeTransitionValidator.validateCommit({
            numLeaves: group.numLeaves,
            leafAssignment: group.leafAssignment,
            keyVersion: group.keyVersion,
            nodes: nodes,
        }, op, submitted);
        if (!result.ok) {
            throw new AppException("GROUP_TREE_INVALID", result.rejections.map(problem => ({...problem})));
        }
        return {commit: result.commit, nodes};
    }
    
    /**
     * A group written under the earlier layout had node keys minted outside their owners' paths, and one written
     * before commit statements has no chain to extend; no commit makes either sound, so none is accepted. Those
     * groups are recreated, not migrated.
     */
    private assertTreeCommitsSupported(group: db.group.Group) {
        if (group.treeVersion !== TreeMath.TREE_VERSION || group.treeCommitSeq === undefined) {
            throw new AppException("GROUP_TREE_INVALID", [{kind: "UNSUPPORTED_TREE_VERSION", treeVersion: group.treeVersion ?? null}]);
        }
    }
    
    /** A new tree: seating checked against the roster, keys and edges checked as the creator's first commit. */
    private assertCreatedTreeIsValid(tree: types.cloud.GroupTreeState, roster: {users: types.cloud.UserId[], managers: types.cloud.UserId[]}, creator: types.cloud.UserId): TreeCommit {
        const problems: {kind: string}[] = TreeValidator.validateLeaves(tree, roster);
        if (problems.length === 0) {
            const result = TreeTransitionValidator.validateCommit(
                {numLeaves: tree.numLeaves, leafAssignment: tree.leafAssignment, keyVersion: 0, nodes: []},
                {kind: "create", committer: creator},
                {baseKeyVersion: 0, refreshedNodes: tree.nodes.map(node => ({...node, publicKey: node.publicKey ?? "" as types.core.EccPubKey})), edges: tree.edges},
            );
            if (result.ok) {
                return result.commit;
            }
            problems.push(...result.rejections);
        }
        throw new AppException("GROUP_TREE_INVALID", problems.map(problem => ({...problem})));
    }
    
    /** What the statement of a commit that leaves the epoch, the grant key and the roster alone must say;
     *  callers override what their operation moves. */
    private unchangedStatement(group: db.group.Group, op: types.cloud.GroupTreeCommitOp,
        tree: HashableTree, path: types.cloud.GroupTreeRefreshedNode[]): StatementExpectation {
        return {
            seq: (group.treeCommitSeq ?? 0) + 1,
            op: op,
            groupId: group.id,
            keyVersion: group.keyVersion,
            groupPubKey: group.groupPubKey,
            rosterVersion: group.rosterVersion,
            users: group.users,
            managers: group.managers,
            tree: tree,
            path: path,
            addedUsers: [],
            addedManagers: [],
            removed: [],
        };
    }
    
    /**
     * Checks a commit statement against what the bridge derives — the next seq, the post-commit epoch, grant key,
     * roster and tree, the caller and its seat — and its signature against the caller's context key.
     *
     * The bridge cannot make a statement trustworthy; clients check the signature themselves. What this buys is
     * that the latest stored statement always matches the stored state, so an honest bridge never serves a group
     * its own members would reject, and a client's refusal always means somebody tampered.
     */
    private assertStatementIsValid(statement: types.cloud.GroupTreeCommitStatement, caller: db.context.ContextUser, expected: StatementExpectation) {
        const seat = expected.tree.leafAssignment.indexOf(caller.userId);
        if (seat < 0) {
            // Only a rotation can get here with an unseated caller: every other commit has been refused already.
            throw new AppException("GROUP_TREE_INVALID", [{kind: "BAD_COMMIT_STATEMENT", field: "committerSeat"}]);
        }
        const full: ExpectedStatement = {
            seq: expected.seq,
            op: expected.op,
            groupId: expected.groupId,
            treeVersion: TreeMath.TREE_VERSION,
            keyVersion: expected.keyVersion,
            groupPubKey: expected.groupPubKey,
            rosterVersion: expected.rosterVersion,
            rosterHash: TreeHash.rosterHash(expected.users, expected.managers),
            treeHash: TreeHash.treeHash(expected.tree),
            committer: caller.userId,
            committerPubKey: caller.userPubKey,
            committerSeat: seat,
            path: expected.path,
            addedUsers: expected.addedUsers,
            addedManagers: expected.addedManagers,
            removed: expected.removed,
        };
        // The statement names the caller's key as it is now, so a stored statement verifies on its own even after
        // that key changes; whether a key was its committer's at the time is the client's check.
        const problems = CommitStatement.validate(statement, full, DateUtils.now());
        if (problems.length > 0) {
            throw new AppException("GROUP_TREE_INVALID", problems.map(problem => ({...problem})));
        }
    }
    
    /**
     * Validates the rungs submitted with a new epoch. `target < at` is the load-bearing check: an upward rung
     * would encrypt a later epoch's key under an earlier one, handing anyone with an old key everything after.
     */
    private assertRungsAreValid(rungs: types.cloud.GroupArchiveRung[], newKeyVersion: number, group: db.group.Group) {
        const spans = rungs.map(rung => ({at: rung.atKeyVersion, target: rung.targetKeyVersion}));
        const result = LadderMath.validateRungSet(spans, newKeyVersion, group.eraFloor, group.archivePrunedBelow);
        if (!result.ok) {
            throw new AppException("GROUP_ARCHIVE_INVALID", result.problem);
        }
        for (const rung of rungs) {
            if (!rung.data) {
                throw new AppException("GROUP_ARCHIVE_INVALID", {kind: "EMPTY_RUNG_DATA", at: rung.atKeyVersion, target: rung.targetKeyVersion});
            }
            // `recipientKind`/`recipient` go into the rung's derived id, so a pairing that does not match the
            // kind is a coordinate the next submission of the same span would not land on. An `epoch` rung is
            // addressed to the grant key at `atKeyVersion` and names nobody — that is what makes it one
            // ciphertext for the whole group; the two era-crossing kinds must name who they are for.
            const namesRecipient = rung.recipientKind === "user" || rung.recipientKind === "group";
            if (namesRecipient !== (rung.recipient !== undefined)) {
                throw new AppException("GROUP_ARCHIVE_INVALID", {
                    kind: "RECIPIENT_MISMATCH",
                    at: rung.atKeyVersion,
                    target: rung.targetKeyVersion,
                    recipientKind: rung.recipientKind ?? null,
                });
            }
        }
    }
    
    // The rotation rate limit is keyed per GROUP (not per caller): BR-4 protects grantee containers from
    // epoch churn, which is a per-group cost regardless of which manager triggers it.
    private rotationRateLimitKey(groupId: types.group.GroupId): string {
        return groupId;
    }
    
    // A self-update moves no epoch, so it costs the grantee containers nothing; what it does cost is tree writes,
    // and those are the caller's own doing — hence per member, in its own namespace so it never eats the
    // group's rotation budget.
    private selfUpdateRateLimitKey(groupId: types.group.GroupId, userId: types.cloud.UserId): string {
        return `selfUpdate|${groupId}|${userId}`;
    }
    
    /**
     * Cross-worker rate limit via the master-held IPC service. Peek only — the quota is consumed by `record`
     * after the operation actually commits (see generateNewGroupKey).
     */
    private async checkRateLimit(key: string): Promise<void> {
        const {allowed} = await this.groupRotationRateLimiter.check({key});
        if (!allowed) {
            throw new AppException("GROUP_ROTATION_RATE_LIMIT");
        }
    }
    
    /**
     * What a loser of a CAS race needs to adopt the winner's epoch instead of retrying blind.
     *
     * The confirmation tag comes from the winning *version's* history entry, not from the group document — that
     * is the only place it is stored. One extra read, on an error path, and without it the loser cannot tell an
     * honest winner from a bridge steering it onto an epoch of the bridge's choosing: the tag is
     * `HMAC(winner's metadata key, ...)`, which only a member could have produced.
     *
     * Absent when the winner was written by a client that sent none. The loser then refuses to adopt, which is
     * the right way round — an unverifiable epoch is not a smaller answer, it is one that cannot be checked.
     */
    private async buildRotatedAlreadyData(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        winner: db.group.Group,
    ): Promise<RotatedAlreadyData> {
        const winnerKeyEntry = (winner.groupKeys ?? [])
            .flatMap(entry => entry.keys)
            .find(k => k.keyId === winner.keyId);
        // `fromRosterVersion` is a lower bound, so asking from the head roster version returns exactly the head
        // entry. The roster plane's counter, because that is the plane `groupHistoryEntry` records: this used to
        // pass the metadata counter, which lags it and so read the wrong window whenever the two had drifted
        // apart, returning the oldest trailing entry and handing the loser a tag from a superseded epoch. Both
        // were plain `number` before the metadata planes were split, so nothing caught it.
        const [headEntry] = await groupRepository.getHistory(winner.id, winner.rosterVersion);
        return {
            keyVersion: winner.keyVersion,
            groupPubKey: winner.groupPubKey,
            winnerKeyEntry: winnerKeyEntry ?? {keyId: winner.keyId, data: "" as types.core.UserKeyData},
            ...(headEntry?.confirmationTag ? {confirmationTag: headEntry.confirmationTag} : {}),
        };
    }
    
    async deleteGroup(executor: Executor, id: types.group.GroupId) {
        const result = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, oldGroup.contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "context/groupDelete", ["groupId=" + id]);
                if (!this.policy.canDeleteContainer(user, context, oldGroup)) {
                    throw new AppException("ACCESS_DENIED");
                }
            });
            // Phase 2 referential integrity: refuse deletion while the group is still a member of a container.
            const referenced =
                await this.repositoryFactory.createThreadRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createStoreRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createInboxRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createKvdbRepository(session).isGroupReferenced(oldGroup.id) ||
                await this.repositoryFactory.createStreamRoomRepository(session).isGroupReferenced(oldGroup.id);
            if (referenced) {
                throw new AppException("GROUP_IN_USE");
            }
            await groupRepository.deleteGroup(oldGroup.id);
            return {oldGroup, context: usedContext};
        });
        this.groupNotificationService.sendDeletedGroup(result.oldGroup);
        return result.oldGroup;
    }
    
    /**
     * Relays an ephemeral notification to the group's members. The payload is already sealed with the group's own
     * key, so the bridge only decides *who* — never *what*, and never a key per recipient.
     *
     * The sender's epoch is deliberately not checked. A member who has not caught up with a rotation still seals
     * with a `keyId` the others can resolve, and refusing here would mean you cannot say "I am typing" until you
     * have re-keyed. Durable writes are the ones that need `checkGroupEpochs`.
     */
    async sendCustomNotification(cloudUser: CloudUser, groupId: types.group.GroupId, data: unknown, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        const group = await this.repositoryFactory.createGroupRepository().get(groupId);
        if (!group) {
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, group.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupSendCustomEvent", ["groupId=" + groupId]);
        if (!this.policy.canSendCustomNotification(user, context, group)) {
            throw new AppException("ACCESS_DENIED");
        }
        const members = [...group.users, ...group.managers];
        // The ACL above is context-scoped, so membership is a separate gate — unlike containers, where the
        // policy check already reads the roster.
        if (!members.includes(user.userId)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (users && users.some(element => !members.includes(element))) {
            throw new AppException("USER_DOES_NOT_HAVE_ACCESS_TO_CONTAINER");
        }
        this.groupNotificationService.sendGroupCustomEvent(group, data, {id: user.userId, pub: user.userPubKey}, customChannelName, users);
        return group;
    }
    
    async deleteGroupsByContext(contextId: types.context.ContextId) {
        const groupRepository = this.repositoryFactory.createGroupRepository();
        await groupRepository.deleteOneByOneByContext(contextId, async group => {
            this.groupNotificationService.sendDeletedGroup(group);
        });
    }
    
}

/** The parts of an expected statement that differ per operation; the rest is derived from them. */
type StatementExpectation = Omit<ExpectedStatement, "treeVersion"|"rosterHash"|"treeHash"|"committer"|"committerPubKey"|"committerSeat">
    & {users: types.cloud.UserId[], managers: types.cloud.UserId[], tree: HashableTree};

class GroupPolicy extends BasePolicy<db.group.Group, never> {
    
    protected isItemCreator(_user: db.context.ContextUser, _item: never) {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.group || {};
    }
}
