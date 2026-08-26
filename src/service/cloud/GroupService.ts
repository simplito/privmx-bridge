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
import type { GroupAddMemberModel, GroupCutEraModel, GroupGenerateNewKeyModel, GroupPruneArchiveModel, GroupRemoveMemberModel, RotatedAlreadyData } from "../../api/main/context/ContextApiTypes";
import type { GroupRotationRateLimiter } from "../../cluster/master/ipcServices/GroupRotationRateLimiter";
import { TreeValidator } from "./keytree/TreeValidator";
import { TreeTransitionValidator } from "./keytree/TreeTransitionValidator";
import { LadderMath } from "./keytree/LadderMath";
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
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, group.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupGet", ["groupId=" + groupId]);
            if (!this.policy.canReadContainer(user, context, group)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
        return group;
    }
    
    /** The group plus its out-of-document state. Separate from `getGroup` so callers that need only the
     *  document do not drag a tree and a full history along with it. */
    async getGroupWithState(executor: Executor, groupId: types.group.GroupId, type: types.group.GroupType|undefined, fromVersion?: number) {
        const group = await this.getGroup(executor, groupId, type);
        const state = await this.repositoryFactory.createGroupRepository().getFullState(group, fromVersion);
        return {group, state};
    }
    
    async getGroupsByContext(cloudUser: CloudUser, contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.group.Group) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupList", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const groups = await this.repositoryFactory.createGroupRepository().getPage(contextId, listParams, sortBy);
        return {user, groups};
    }
    
    async createGroup(cloudUser: CloudUser, resourceId: types.core.ClientResourceId|null, contextId: types.context.ContextId, type: types.group.GroupType|undefined,
        groupPubKey: types.cloud.GroupPubKey, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.group.GroupData,
        keyId: types.core.KeyId, policy: types.cloud.ContainerPolicy, tree: types.cloud.GroupTreeState,
        groupKeys?: Omit<types.cloud.GroupKeyEntrySet, "group">) {
        const allUsers = Utils.uniqueFromArrays(users, managers);
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        this.assertWithinMemberLimit(allUsers.length);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        if (allUsers.length === 0) {
            throw new AppException("INVALID_PARAMS", "there has to be at least one user or manager");
        }
        await this.cloudKeyService.checkUsersExistance(contextId, allUsers);
        const newGroupKeys = this.buildSelfAddressedKeysForNewGroup(groupKeys, keyId);
        // Epoch 1: a new group's first grant keypair.
        this.assertTreeIsValid(tree, {users, managers}, 1);
        try {
            // One transaction: the genesis history entry and the initial tree must not survive a failure that
            // leaves the group itself uncreated, or the other way round.
            const group = await this.repositoryFactory.withTransaction(session =>
                this.repositoryFactory.createGroupRepository(session)
                    .createGroup(contextId, resourceId, type, groupPubKey, user.userId, managers, users, data, keyId, policy, tree, newGroupKeys),
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
     * Updates the group's metadata: `data`, `keyId`, policy, resource id.
     *
     * Membership is deliberately not here — seating a member and re-keying their path is one operation on the
     * tree. `addMember`/`removeMember` are the only ways in.
     */
    async updateGroup(cloudUser: CloudUser, id: types.group.GroupId, data: types.group.GroupData, keyId: types.core.KeyId,
        version: types.group.GroupVersion, force: boolean, policy: types.cloud.ContainerPolicy|undefined,
        resourceId: types.core.ClientResourceId|null) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        const rGroup = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldGroup, oldGroup.managers, policy);
            if (oldGroup.version !== version && !force) {
                throw new AppException("GROUP_VERSION_MISMATCH", "version does not match");
            }
            if (oldGroup.clientResourceId && resourceId && oldGroup.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            // Metadata integrity is committed inside the opaque `data` (endpoint DIO) and verified client-side.
            try {
                const group = await groupRepository.updateGroup(oldGroup, user.userId, data, keyId, policy, resourceId);
                return group;
            }
            catch (err) {
                if (err instanceof DbDuplicateError) {
                    throw new AppException("DUPLICATE_RESOURCE_ID");
                }
                throw err;
            }
        });
        this.groupNotificationService.sendUpdatedGroup(rGroup, [], "updated");
        return rGroup;
    }
    
    /** Rotates the grant keypair without removing anybody: the epoch advances, the new grant key is wrapped to
     *  the unchanged root, the rungs keep the old epochs reachable. One edge, whatever the group's size. */
    async generateNewGroupKey(cloudUser: CloudUser, model: GroupGenerateNewKeyModel) {
        const rGroup = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            // Rotation is a container mutation, so it must pass the same manager/policy gate as updateGroup.
            // Rotation changes neither membership nor policy → reuse the existing managers and pass no policy.
            this.policy.makeUpdateContainerCheck(user, context, oldGroup, oldGroup.managers, undefined);
            await this.checkRotationRateLimit(model.id);
            const newKeyVersion = oldGroup.keyVersion + 1;
            await this.assertRotationGrantEdgeIsValid(groupRepository, oldGroup, model.grantEdge, newKeyVersion);
            this.assertRungsAreValid(model.rungs, newKeyVersion, oldGroup);
            const result = await groupRepository.generateNewGroupKey({
                oldGroup,
                modifier: user.userId,
                newGroupPubKey: model.groupPubKey,
                data: model.data,
                keyId: model.keyId,
                grantEdge: model.grantEdge,
                rungs: model.rungs,
                groupKeys: this.buildSelfAddressedKeys(oldGroup, model.groupKeys, model.keyId, newKeyVersion),
                ...(model.confirmationTag ? {confirmationTag: model.confirmationTag} : {}),
            });
            if (!result) {
                const winner = await groupRepository.get(model.id);
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(winner!));
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
     * Adds a member **without advancing the epoch**, so no container the group can read goes stale.
     *
     * The bridge's job is to confirm the client did not smuggle anything else into the same call — a moved
     * member, a node refreshed off the path, a bumped epoch.
     */
    async addMember(cloudUser: CloudUser, model: GroupAddMemberModel) {
        const {group} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            const managers = model.role === "manager" ? [...oldGroup.managers, model.userId] : oldGroup.managers;
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, managers, undefined);
            if (oldGroup.users.includes(model.userId) || oldGroup.managers.includes(model.userId)) {
                throw new AppException("INVALID_PARAMS", `user '${model.userId}' is already a member`);
            }
            this.assertWithinMemberLimit(Utils.uniqueFromArrays(oldGroup.users, oldGroup.managers, [model.userId]).length);
            await this.cloudKeyService.checkUsersExistance(oldGroup.contextId, [model.userId]);
            await this.assertAdditionTransitionIsAcceptable(groupRepository, oldGroup, model.transition, model.userId);
            // The newcomer gets no key entry of their own: they climb to the grant key and open the group's
            // single self-addressed metadata entry, the same way every other member does.
            const result = await groupRepository.addMemberWithTransition({
                oldGroup,
                transition: model.transition,
                modifier: user.userId,
                addedUser: model.userId,
                role: model.role,
                keyId: model.keyId,
                data: model.data,
            });
            if (!result) {
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!));
            }
            return {group: result, context: usedContext};
        });
        this.groupNotificationService.sendUpdatedGroup(group, [], "memberAdded");
        return group;
    }
    
    /**
     * Removes a member: blank the leaf, refresh its direct path, rotate the grant keypair, record the rungs.
     *
     * All four in one call, because any one alone is useless or unsafe. A refresh without a new epoch leaves
     * every container readable with the old grant key; a new epoch without rungs orphans the group's own
     * history; rungs pointing the wrong way would hand the departing member a later key.
     */
    async removeMember(cloudUser: CloudUser, model: GroupRemoveMemberModel) {
        const {group, context, removed} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            const managers = oldGroup.managers.filter(u => u !== model.userId);
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, managers, undefined);
            if (!oldGroup.users.includes(model.userId) && !oldGroup.managers.includes(model.userId)) {
                throw new AppException("INVALID_PARAMS", `user '${model.userId}' is not a member`);
            }
            if (oldGroup.users.length + oldGroup.managers.length <= 1) {
                throw new AppException("INVALID_PARAMS", "cannot remove the last member of a group");
            }
            // A removal advances the epoch, so it is charged against the same per-group budget as an explicit
            // rotation: the cost falls on every container the group can read, not on the caller.
            await this.checkRotationRateLimit(model.id);
            const newKeyVersion = oldGroup.keyVersion + 1;
            // The transition is checked against the stored path — `O(log n)` read, no whole tree on either side.
            await this.assertTransitionIsAcceptable(groupRepository, oldGroup, model.transition, model.userId);
            this.assertRungsAreValid(model.rungs, newKeyVersion, oldGroup);
            // The new epoch's metadata key travels as one self-addressed entry, not one wrap per survivor.
            const result = await groupRepository.removeMemberWithTransition({
                groupKeys: this.buildSelfAddressedKeys(oldGroup, model.groupKeys, model.keyId, newKeyVersion),
                oldGroup,
                modifier: user.userId,
                removedUser: model.userId,
                newGroupPubKey: model.groupPubKey,
                keyId: model.keyId,
                data: model.data,
                rungs: model.rungs,
                transition: model.transition,
                ...(model.confirmationTag ? {confirmationTag: model.confirmationTag} : {}),
            });
            if (!result) {
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!));
            }
            return {group: result, context: usedContext, removed: model.userId};
        });
        await this.groupRotationRateLimiter.record({key: this.rotationRateLimitKey(model.id)});
        // The removed member is notified too: their client needs to learn it can stop trying to climb.
        const additionalUsersToNotify = await this.getUsersWithStatus([removed], context.id, context.solution);
        this.groupNotificationService.sendUpdatedGroup(group, additionalUsersToNotify, "memberRemoved");
        return group;
    }
    
    /** Closes the current era: everything below the new floor becomes unreachable by descending. */
    async cutEra(cloudUser: CloudUser, model: GroupCutEraModel) {
        const {group} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
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
            const result = await groupRepository.cutEra(oldGroup, model.newFloor);
            if (!result) {
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!));
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
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, oldGroup.managers, undefined);
            const keyVersion = oldGroup.keyVersion;
            if (!Number.isInteger(model.belowEpoch) || model.belowEpoch < 1) {
                throw new AppException("INVALID_PARAMS", "belowEpoch must be a positive integer");
            }
            if (model.belowEpoch > keyVersion) {
                throw new AppException("INVALID_PARAMS", `belowEpoch cannot exceed the current epoch ${keyVersion}`);
            }
            const result = await groupRepository.pruneArchive(oldGroup, model.belowEpoch);
            if (!result) {
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!));
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
    
    /** Loads a group for a tree operation and rejects a caller working from a superseded epoch. */
    private async getGroupForTreeOperation(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        cloudUser: CloudUser,
        groupId: types.group.GroupId,
        expectedKeyVersion: number,
    ) {
        const group = await groupRepository.get(groupId);
        if (!group) {
            throw new AppException("GROUP_DOES_NOT_EXIST");
        }
        const currentKeyVersion = group.keyVersion;
        if (currentKeyVersion !== expectedKeyVersion) {
            // The client computed its wraps against a tree that no longer exists. Handing back the winner's
            // state lets it recompute instead of guessing — but only to somebody who belongs here: this runs
            // before the caller has passed any other gate, and the payload carries the group's key material.
            await this.cloudAccessValidator.getUserFromContext(cloudUser, group.contextId);
            throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(group));
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
     * Checks a removal delta against the stored path and copath — `O(log n)` documents.
     *
     * The preconditions in the transition are what make that sound: a delta computed against a state that has
     * since moved is refused rather than applied to a base it never saw.
     */
    private async assertTransitionIsAcceptable(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        group: db.group.Group,
        transition: types.cloud.GroupTreeTransition,
        removedUser: types.cloud.UserId,
    ) {
        const nodes = await groupRepository.getPathNodes(group, transition.blankedPosition);
        const problems = TreeTransitionValidator.validateRemoval({
            numLeaves: group.numLeaves,
            leafAssignment: group.leafAssignment,
            keyVersion: group.keyVersion,
            nodes: nodes,
        }, transition, removedUser);
        if (problems.length > 0) {
            throw new AppException("GROUP_TREE_INVALID", problems.map(problem => ({...problem})));
        }
    }
    
    private async assertAdditionTransitionIsAcceptable(
        groupRepository: ReturnType<RepositoryFactory["createGroupRepository"]>,
        group: db.group.Group,
        transition: types.cloud.GroupTreeAdditionTransition,
        addedUser: types.cloud.UserId,
    ) {
        const nodes = await groupRepository.getSeatNodes(group, transition.position);
        const problems = TreeTransitionValidator.validateAddition({
            numLeaves: group.numLeaves,
            leafAssignment: group.leafAssignment,
            keyVersion: group.keyVersion,
            nodes: nodes,
        }, transition, addedUser);
        if (problems.length > 0) {
            throw new AppException("GROUP_TREE_INVALID", problems.map(problem => ({...problem})));
        }
    }
    
    private assertTreeIsValid(tree: types.cloud.GroupTreeState, roster: {users: types.cloud.UserId[], managers: types.cloud.UserId[]}, keyVersion: number) {
        const problems = TreeValidator.validateState(tree, roster, keyVersion);
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
        }
    }
    
    // The rotation rate limit is keyed per GROUP (not per caller): BR-4 protects grantee containers from
    // epoch churn, which is a per-group cost regardless of which manager triggers it.
    private rotationRateLimitKey(groupId: types.group.GroupId): string {
        return groupId;
    }
    
    /**
     * Cross-worker rotation rate limit (BR-4) via the master-held IPC service. Peek only — the quota is
     * consumed by `record` after the rotation actually commits (see generateNewGroupKey).
     */
    private async checkRotationRateLimit(groupId: types.group.GroupId): Promise<void> {
        const {allowed} = await this.groupRotationRateLimiter.check({key: this.rotationRateLimitKey(groupId)});
        if (!allowed) {
            throw new AppException("GROUP_ROTATION_RATE_LIMIT");
        }
    }
    
    /** What a caller who lost the race needs to recompute against the winner. `winnerKeyEntry` is the group's
     *  own self-addressed entry at the winning epoch — whoever can climb to the new grant key can open it. */
    private buildRotatedAlreadyData(winner: db.group.Group): RotatedAlreadyData {
        const winnerKeyEntry = (winner.groupKeys ?? [])
            .flatMap(entry => entry.keys)
            .find(k => k.keyId === winner.keyId);
        return {
            keyVersion: winner.keyVersion,
            groupPubKey: winner.groupPubKey,
            winnerKeyEntry: winnerKeyEntry ?? {keyId: winner.keyId, data: "" as types.core.UserKeyData},
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
    
    async deleteGroupsByContext(contextId: types.context.ContextId) {
        const groupRepository = this.repositoryFactory.createGroupRepository();
        await groupRepository.deleteOneByOneByContext(contextId, async group => {
            this.groupNotificationService.sendDeletedGroup(group);
        });
    }
    
}

class GroupPolicy extends BasePolicy<db.group.Group, never> {
    
    protected isItemCreator(_user: db.context.ContextUser, _item: never) {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.group || {};
    }
}
