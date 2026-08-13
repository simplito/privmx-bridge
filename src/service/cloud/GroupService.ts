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
import { TransitionProblem, TreeProblem, TreeValidator } from "./keytree/TreeValidator";
import { LadderMath } from "./keytree/LadderMath";
import { TreeMath } from "./keytree/TreeMath";

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
        keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerPolicy, tree?: types.cloud.GroupTreeState) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/groupCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        // A tree-backed group distributes the grant key by climbing, so it is not required to carry one key
        // entry per member. The tree takes over the job the `keys` list does for a flat group, and the
        // structural check below takes over from verifyThatOnlyGivenClientsHaveAccess.
        const newKeys = tree
            ? await this.checkKeysForTreeBackedGroup(contextId, keys, keyId, users, managers)
            : await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        if (tree) {
            // Epoch 1: a new group's first grant keypair.
            this.assertTreeIsValid(tree, {users, managers}, 1);
        }
        // Membership integrity (signature/chain) is committed inside the opaque `data` (endpoint DIO) and verified
        // client-side; the bridge only stores it. See documents/plan/10-endpoint-security-model-and-alignment.md.
        try {
            const group = await this.repositoryFactory.createGroupRepository().createGroup(contextId, resourceId, type, groupPubKey, user.userId, managers, users, data, keyId, newKeys, policy, tree);
            this.groupNotificationService.sendCreatedGroup(group, context.solution);
            return group;
        }
        catch (err) {
            if (err instanceof DbDuplicateError) {
                throw new AppException("DUPLICATE_RESOURCE_ID");
            }
            throw err;
        }
    }
    
    async updateGroup(cloudUser: CloudUser, id: types.group.GroupId, groupPubKey: types.cloud.GroupPubKey, users: types.cloud.UserId[], managers: types.cloud.UserId[],
        data: types.group.GroupData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.group.GroupVersion, force: boolean,
        policy: types.cloud.ContainerPolicy|undefined, resourceId: types.core.ClientResourceId|null) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        const {group: rGroup, context: usedContext, oldGroup: old} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldGroup, managers, policy);
            // updateGroup changes membership/metadata only — it must NOT rotate the group identity key (epoch).
            // Key rotation is a separate, narrowly-scoped operation: context.groupGenerateNewKey (which cannot
            // add/remove members). This keeps the two capabilities cleanly separable.
            if (groupPubKey !== oldGroup.groupPubKey) {
                throw new AppException("INVALID_PARAMS", "groupUpdate cannot rotate the group key; use generateNewGroupKey");
            }
            const currentVersion = oldGroup.history.length as types.group.GroupVersion;
            if (currentVersion !== version && !force) {
                throw new AppException("GROUP_VERSION_MISMATCH", "version does not match");
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldGroup.contextId, [...oldGroup.history.map(x => x.keyId), keyId], oldGroup.keys, keys, keyId, users, managers);
            if (oldGroup.clientResourceId && resourceId && oldGroup.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            // Membership integrity is committed inside the opaque `data` (endpoint DIO) and verified client-side.
            try {
                const group = await groupRepository.updateGroup(oldGroup, user.userId, groupPubKey, managers, users, data, keyId, newKeys, policy, resourceId);
                return {group, context, oldGroup};
            }
            catch (err) {
                if (err instanceof DbDuplicateError) {
                    throw new AppException("DUPLICATE_RESOURCE_ID");
                }
                throw err;
            }
        });
        const updatedUsers = rGroup.managers.concat(rGroup.users);
        const deletedUsers = old.managers.concat(old.users).filter(u => !updatedUsers.includes(u));
        const additionalUsersToNotify = await this.getUsersWithStatus(deletedUsers, usedContext.id, usedContext.solution);
        this.groupNotificationService.sendUpdatedGroup(rGroup, usedContext.solution, additionalUsersToNotify);
        return rGroup;
    }
    
    async generateNewGroupKey(cloudUser: CloudUser, model: GroupGenerateNewKeyModel) {
        const {group: rGroup, context: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await groupRepository.get(model.id);
            if (!oldGroup) {
                throw new AppException("GROUP_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            // Rotation is a container mutation, so it must pass the same manager/policy gate as updateGroup.
            // Rotation changes neither membership nor policy → reuse the existing managers and pass no policy.
            this.policy.makeUpdateContainerCheck(user, context, oldGroup, oldGroup.managers, undefined);
            await this.checkRotationRateLimit(model.id);
            const currentKeyVersion = groupRepository.getKeyVersion(oldGroup);
            if (currentKeyVersion !== model.expectedKeyVersion) {
                const winner = await groupRepository.get(model.id);
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(winner!, user.userId));
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(
                oldGroup.contextId,
                [...oldGroup.history.map(x => x.keyId), model.keyId],
                oldGroup.keys,
                model.keys,
                model.keyId,
                oldGroup.users,
                oldGroup.managers,
            );
            const result = await groupRepository.generateNewGroupKey(oldGroup, user.userId, model.groupPubKey, model.data, model.keyId, newKeys, model.confirmationTag);
            if (!result) {
                const winner = await groupRepository.get(model.id);
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(winner!, user.userId));
            }
            return {group: result, context};
        });
        // Charge the rotation rate-limit budget only on a committed rotation, so lost CAS races / version
        // mismatches (ROTATED_ALREADY) don't consume the group's quota.
        await this.groupRotationRateLimiter.record({key: this.rotationRateLimitKey(model.id)});
        this.groupNotificationService.sendUpdatedGroup(rGroup, usedContext.solution, []);
        return rGroup;
    }
    
    // ── Tree-backed membership (documents/nested_groups/09-hidden-key-tree.md) ───────────────────────────────
    
    /**
     * Adds a member to a tree-backed group **without advancing the epoch**.
     *
     * That is the operation the whole design exists to make cheap: no container the group can read goes stale,
     * so nobody else has to re-key. The bridge's job is to confirm the client did not smuggle anything else
     * into the same call — a moved member, a refreshed node, a bumped epoch.
     */
    async addMember(cloudUser: CloudUser, model: GroupAddMemberModel) {
        const {group, context} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            const managers = model.role === "manager" ? [...oldGroup.managers, model.userId] : oldGroup.managers;
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, managers, undefined);
            const oldTree = this.requireTree(oldGroup);
            if (oldGroup.users.includes(model.userId) || oldGroup.managers.includes(model.userId)) {
                throw new AppException("INVALID_PARAMS", `user '${model.userId}' is already a member`);
            }
            await this.cloudKeyService.checkUsersExistance(oldGroup.contextId, [model.userId]);
            const keyVersion = groupRepository.getKeyVersion(oldGroup);
            this.assertTransitionIsValid(TreeValidator.validateAddition(
                oldTree, model.tree, model.userId, model.position, keyVersion, model.tree.edges.find(e => e.isGrantEdge)?.parentGeneration ?? keyVersion,
            ));
            const users = model.role === "user" ? [...oldGroup.users, model.userId] : oldGroup.users;
            this.assertTreeIsValid(model.tree, {users, managers}, keyVersion);
            // One entry for the newcomer at the existing keyId — the group's metadata key, which the tree does
            // not carry. No rotation, so nobody else is disturbed.
            const newKeys = this.buildTreeGroupKeys(
                [...oldGroup.history.map(x => x.keyId), model.keyId], oldGroup.keys, model.keys ?? [], model.keyId,
                [...users, ...managers],
            );
            const result = await groupRepository.addMemberWithTree({
                oldGroup,
                modifier: user.userId,
                addedUser: model.userId,
                role: model.role,
                keyId: model.keyId,
                data: model.data,
                tree: model.tree,
                keys: newKeys,
            });
            if (!result) {
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!, user.userId));
            }
            return {group: result, context: usedContext};
        });
        this.groupNotificationService.sendUpdatedGroup(group, context.solution, []);
        return group;
    }
    
    /**
     * Removes a member from a tree-backed group: blank the leaf, refresh its direct path, rotate the grant
     * keypair, and record the rungs that keep the older epochs reachable.
     *
     * All four in one call, because any one of them alone is either useless or unsafe. A refresh without a new
     * epoch leaves every container readable with the old grant key; a new epoch without rungs orphans the
     * group's own history; rungs pointing the wrong way would hand the departing member a later key.
     */
    async removeMember(cloudUser: CloudUser, model: GroupRemoveMemberModel) {
        const {group, context, removed} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            const managers = oldGroup.managers.filter(u => u !== model.userId);
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, managers, undefined);
            const oldTree = this.requireTree(oldGroup);
            if (!oldGroup.users.includes(model.userId) && !oldGroup.managers.includes(model.userId)) {
                throw new AppException("INVALID_PARAMS", `user '${model.userId}' is not a member`);
            }
            if (oldGroup.users.length + oldGroup.managers.length <= 1) {
                throw new AppException("INVALID_PARAMS", "cannot remove the last member of a group");
            }
            // A removal advances the epoch, so it is charged against the same per-group budget as an explicit
            // rotation: the cost falls on every container the group can read, not on the caller.
            await this.checkRotationRateLimit(model.id);
            const oldKeyVersion = groupRepository.getKeyVersion(oldGroup);
            const newKeyVersion = oldKeyVersion + 1;
            this.assertTransitionIsValid(TreeValidator.validateRemoval(oldTree, model.tree, model.userId, oldKeyVersion, newKeyVersion));
            const users = oldGroup.users.filter(u => u !== model.userId);
            this.assertTreeIsValid(model.tree, {users, managers}, newKeyVersion);
            this.assertRungsAreValid(model.rungs, newKeyVersion, oldGroup);
            // Fresh metadata-key entries, if the caller supplied any. The departing member's own entries are
            // dropped by the repository either way, so they cannot read metadata written under a new keyId.
            const newKeys = this.buildTreeGroupKeys(
                [...oldGroup.history.map(x => x.keyId), model.keyId],
                oldGroup.keys.filter(k => k.user !== model.userId),
                model.keys ?? [], model.keyId, [...users, ...managers],
            );
            const newGroupKeys = this.buildSelfAddressedKeys(oldGroup, model.groupKeys ?? [], model.keyId, newKeyVersion);
            const result = await groupRepository.removeMemberWithTree({
                keys: newKeys,
                groupKeys: newGroupKeys,
                oldGroup,
                modifier: user.userId,
                removedUser: model.userId,
                newGroupPubKey: model.groupPubKey,
                keyId: model.keyId,
                data: model.data,
                tree: model.tree,
                rungs: model.rungs,
                ...(model.confirmationTag ? {confirmationTag: model.confirmationTag} : {}),
            });
            if (!result) {
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!, user.userId));
            }
            return {group: result, context: usedContext, removed: model.userId};
        });
        await this.groupRotationRateLimiter.record({key: this.rotationRateLimitKey(model.id)});
        // The removed member is notified too: their client needs to learn it can stop trying to climb.
        const additionalUsersToNotify = await this.getUsersWithStatus([removed], context.id, context.solution);
        this.groupNotificationService.sendUpdatedGroup(group, context.solution, additionalUsersToNotify);
        return group;
    }
    
    /**
     * Closes the current era. Everything below the new floor becomes unreachable by descending — deliberately,
     * as a policy decision that content older than the floor is no longer to be handed to newcomers.
     */
    async cutEra(cloudUser: CloudUser, model: GroupCutEraModel) {
        const {group, context} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, oldGroup.managers, undefined);
            const keyVersion = groupRepository.getKeyVersion(oldGroup);
            const currentFloor = oldGroup.eraFloor ?? 1;
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
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!, user.userId));
            }
            return {group: result, context: usedContext};
        });
        this.groupNotificationService.sendUpdatedGroup(group, context.solution, []);
        return group;
    }
    
    /**
     * Deletes rungs below a watermark. Unlike a cut era this is storage housekeeping, and it is recorded
     * separately so a client that cannot descend learns *why* — pruned, not tampered with.
     */
    async pruneArchive(cloudUser: CloudUser, model: GroupPruneArchiveModel) {
        const {group, context} = await this.repositoryFactory.withTransaction(async session => {
            const groupRepository = this.repositoryFactory.createGroupRepository(session);
            const oldGroup = await this.getGroupForTreeOperation(groupRepository, cloudUser, model.id, model.expectedKeyVersion);
            const {user, context: usedContext} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldGroup.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", ["groupId=" + model.id]);
            this.policy.makeUpdateContainerCheck(user, usedContext, oldGroup, oldGroup.managers, undefined);
            const keyVersion = groupRepository.getKeyVersion(oldGroup);
            if (!Number.isInteger(model.belowEpoch) || model.belowEpoch < 1) {
                throw new AppException("INVALID_PARAMS", "belowEpoch must be a positive integer");
            }
            if (model.belowEpoch > keyVersion) {
                throw new AppException("INVALID_PARAMS", `belowEpoch cannot exceed the current epoch ${keyVersion}`);
            }
            const result = await groupRepository.pruneArchive(oldGroup, model.belowEpoch);
            if (!result) {
                throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData((await groupRepository.get(model.id))!, user.userId));
            }
            return {group: result, context: usedContext};
        });
        this.groupNotificationService.sendUpdatedGroup(group, context.solution, []);
        return group;
    }
    
    /**
     * Serves the Epoch Ladder, optionally windowed.
     *
     * Read access is enough: every rung is a ciphertext only a holder of the epoch key above it can open, so
     * handing the archive to any member reveals nothing they could not already reach by descending.
     */
    async getKeyArchive(executor: Executor, groupId: types.group.GroupId, fromKeyVersion?: number, toKeyVersion?: number) {
        const group = await this.getGroup(executor, groupId, undefined);
        const rungs = (group.archiveRungs ?? []).filter(rung => {
            if (fromKeyVersion !== undefined && rung.atKeyVersion < fromKeyVersion) {
                return false;
            }
            if (toKeyVersion !== undefined && rung.atKeyVersion > toKeyVersion) {
                return false;
            }
            return true;
        });
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
        const currentKeyVersion = groupRepository.getKeyVersion(group);
        if (currentKeyVersion !== expectedKeyVersion) {
            // The client computed its wraps against a tree that no longer exists. Handing back the winner's
            // state lets it recompute instead of guessing.
            const {user} = await this.cloudAccessValidator.getUserFromContext(cloudUser, group.contextId);
            throw new AppException("ROTATED_ALREADY", this.buildRotatedAlreadyData(group, user.userId));
        }
        return group;
    }
    
    private requireTree(group: db.group.Group): types.cloud.GroupTreeState {
        if (!group.tree) {
            throw new AppException("GROUP_HAS_NO_TREE");
        }
        return group.tree;
    }
    
    /**
     * A tree-backed group still accepts per-member key entries — a group may carry both while migrating — but
     * it does not require one per member, because climbing the tree is how members reach the key.
     */
    private async checkKeysForTreeBackedGroup(
        contextId: types.context.ContextId,
        inserts: types.cloud.KeyEntrySet[],
        keyId: types.core.KeyId,
        users: types.cloud.UserId[],
        managers: types.cloud.UserId[],
    ) {
        const allUsers = [...new Set([...users, ...managers])];
        if (allUsers.length === 0) {
            throw new AppException("INVALID_PARAMS", "there has to be at least one user or manager");
        }
        await this.cloudKeyService.checkUsersExistance(contextId, allUsers);
        return this.buildTreeGroupKeys([keyId], [], inserts, keyId, allUsers);
    }
    
    /**
     * Builds the per-member key entries of a tree-backed group.
     *
     * Only one of the two directions `verifyThatOnlyGivenClientsHaveAccess` checks applies here. That no
     * outsider holds an entry still matters and is enforced. That *every* member holds one does not: the tree is
     * how members reach the grant key, and the entries only carry the group's metadata key, which a client may
     * legitimately leave untouched.
     */
    private buildTreeGroupKeys(
        availableKeyIds: types.core.KeyId[],
        oldKeys: types.cloud.UserKeysEntry[],
        inserts: types.cloud.KeyEntrySet[],
        keyId: types.core.KeyId,
        members: types.cloud.UserId[],
    ) {
        for (const insert of inserts) {
            // Checked on the submitted entries rather than only on the merged result, so an entry addressed to a
            // non-member is refused whichever keyId it names — including one the group used in an earlier epoch.
            if (!members.includes(insert.user)) {
                throw new AppException("INVALID_PARAMS", `user '${insert.user}' is not a member of this group`);
            }
        }
        const newKeys = this.cloudKeyService.buildKeys(availableKeyIds, oldKeys, inserts);
        for (const entry of newKeys) {
            const hasAccess = entry.keys.some(k => k.keyId === keyId);
            if (hasAccess && !members.includes(entry.user)) {
                throw new AppException("INVALID_PARAMS", `user '${entry.user}' should not have access to key '${keyId}'`);
            }
        }
        return newKeys;
    }
    
    /**
     * Merges the metadata key the group wrapped **to itself**.
     *
     * A tree-backed group does not need one metadata-key ciphertext per member: it can wrap the key once to its
     * own grant public key, exactly as a thread or store does when granting access to a group, and every member
     * opens it by climbing to a key they can already reach. That single entry is what keeps a removal from
     * costing O(n) wraps.
     *
     * The bridge checks only what it can: that the entry names *this* group, the epoch being created, and the
     * keyId being introduced. It cannot check what is inside — and does not need to, since a member who cannot
     * open it simply cannot read the metadata.
     */
    private buildSelfAddressedKeys(
        group: db.group.Group,
        inserts: types.cloud.GroupKeyEntrySet[],
        keyId: types.core.KeyId,
        newKeyVersion: number,
    ): types.cloud.GroupKeysEntry[] {
        const existing = group.groupKeys ?? [];
        if (inserts.length === 0) {
            return existing;
        }
        for (const insert of inserts) {
            if (insert.group !== group.id) {
                // Wrapping the group's metadata key to a *different* group would hand it to that group's
                // members, who are not members here.
                throw new AppException("INVALID_PARAMS", `groupKeys entry must be addressed to group '${group.id}'`);
            }
            if (insert.keyId !== keyId) {
                throw new AppException("INVALID_PARAMS", `groupKeys entry must name the new keyId '${keyId}'`);
            }
            if (insert.groupEpoch !== newKeyVersion) {
                // An entry wrapped to an earlier epoch's grant key would still open for the member being
                // removed, since that is the key they hold.
                throw new AppException("INVALID_PARAMS", `groupKeys entry must name epoch ${newKeyVersion}`);
            }
            if (!insert.data) {
                throw new AppException("INVALID_PARAMS", "groupKeys entry carries no data");
            }
        }
        // Kept per epoch rather than replaced: an older `data` entry stays readable to whoever can descend the
        // ladder to the epoch it was written at.
        return [
            ...existing,
            ...inserts.map(insert => ({
                group: insert.group,
                keys: [{keyId: insert.keyId, data: insert.data, groupEpoch: insert.groupEpoch}],
            })),
        ];
    }
    
    private assertTreeIsValid(tree: types.cloud.GroupTreeState, roster: {users: types.cloud.UserId[], managers: types.cloud.UserId[]}, keyVersion: number) {
        const problems = TreeValidator.validateState(tree, roster, keyVersion);
        if (problems.length > 0) {
            throw new AppException("GROUP_TREE_INVALID", this.describeTreeProblems(problems));
        }
    }
    
    private assertTransitionIsValid(problems: TransitionProblem[]) {
        if (problems.length > 0) {
            throw new AppException("GROUP_TREE_INVALID", problems.map(p => p.kind));
        }
    }
    
    /**
     * Validates the rungs submitted with a new epoch.
     *
     * `target < at` on every rung is the load-bearing check: a rung pointing upwards would encrypt a *later*
     * epoch's key under an earlier one, handing anyone with an old key everything that came after. The bridge
     * is the only party positioned to enforce that for all clients, so it does, on every write.
     */
    private assertRungsAreValid(rungs: types.cloud.GroupArchiveRung[], newKeyVersion: number, group: db.group.Group) {
        const spans = rungs.map(rung => ({at: rung.atKeyVersion, target: rung.targetKeyVersion}));
        const result = LadderMath.validateRungSet(spans, newKeyVersion, group.eraFloor ?? 1, group.archivePrunedBelow);
        if (!result.ok) {
            throw new AppException("GROUP_ARCHIVE_INVALID", result.problem);
        }
        for (const rung of rungs) {
            if (!rung.data) {
                throw new AppException("GROUP_ARCHIVE_INVALID", {kind: "EMPTY_RUNG_DATA", at: rung.atKeyVersion, target: rung.targetKeyVersion});
            }
        }
    }
    
    private describeTreeProblems(problems: TreeProblem[]) {
        return problems.map(problem => ({...problem}));
    }
    
    /** The caller's own leaf, so the client does not have to know its user id to find its seat. */
    ownLeafPosition(group: db.group.Group, userId: types.cloud.UserId): number|undefined {
        if (!group.tree) {
            return undefined;
        }
        const position = group.tree.leafAssignment.indexOf(userId);
        return position < 0 ? undefined : position;
    }
    
    /** Lowest free leaf position, growing the tree only when every existing seat is taken. */
    nextFreePosition(group: db.group.Group): number {
        const tree = this.requireTree(group);
        const blank = tree.leafAssignment.indexOf("" as types.cloud.UserId);
        if (blank >= 0) {
            return blank;
        }
        return TreeMath.numLeavesToSeat(tree.numLeaves, tree.numLeaves) - 1;
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
    
    private buildRotatedAlreadyData(winner: db.group.Group, callerId: types.cloud.UserId): RotatedAlreadyData {
        const callerEntry = winner.keys.find(k => k.user === callerId);
        const winnerKeyEntry = callerEntry?.keys.find(k => k.keyId === winner.keyId);
        return {
            keyVersion: winner.keyVersion ?? 0,
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
        this.groupNotificationService.sendDeletedGroup(result.oldGroup, result.context.solution);
        return result.oldGroup;
    }
    
    async deleteGroupsByContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const groupRepository = this.repositoryFactory.createGroupRepository();
        await groupRepository.deleteOneByOneByContext(contextId, async group => {
            this.groupNotificationService.sendDeletedGroup(group, solutionId);
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
