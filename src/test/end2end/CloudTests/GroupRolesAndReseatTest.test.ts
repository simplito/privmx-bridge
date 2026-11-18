/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode2, Test } from "../BaseTestSet";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { ContextApiClient } from "../../../api/main/context/ContextApiClient";
import {
    additionOf, buildTree, commitAgainst, creationStatement, PlanOp, registerUserKey, removalOf, rolesCommitAgainst, rungsFor, ServedGroup, useRealNodeKeys,
} from "../../testUtils/TreeFixtures";
import { TreeMath } from "../../../service/cloud/keytree/TreeMath";

/**
 * The roster commits that are not an addition or a removal: a change of role, and a reseat. And the two rules that
 * split `update` for the roster, each tried by a member the rule allows and by one it does not.
 */

const SEATING = ["janek", "bob", "carol"];
const me = testData.userId;
const bob = "bob" as types.cloud.UserId;
const carol = "carol" as types.cloud.UserId;
const dave = "dave" as types.cloud.UserId;

useRealNodeKeys();
registerUserKey(me, testData.userPrivKey as types.core.EccWif);
// Bob signs for himself, so his key is one the tests hold.
const bobIdentity = ECUtils.generateKeyPair();
registerUserKey(bob, bobIdentity.privWif as types.core.EccWif);

function newGroupKey() {
    return ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;
}

export class GroupRolesAndReseatTests extends BaseTestSet {
    
    private bobApi?: ContextApiClient;
    private usersAdded = false;
    
    @Test()
    async shouldMoveAMemberBetweenTheListsWithoutMovingAKey() {
        const groupId = await this.createGroup();
        await this.setRoles(groupId, me, [bob], []);
        const promoted = await this.read(groupId);
        assert(promoted.managers.includes(bob) && !promoted.users.includes(bob), "bob should be a manager, and only that");
        assert(promoted.rosterVersion === 2, `a role change moves the roster version, got ${promoted.rosterVersion}`);
        assert(promoted.keyVersion === 1, "a role change opens no epoch");
        assert(promoted.treeCommit!.op === "roles" && promoted.treeCommit!.seq === 2, "the latest statement should be the role change");
        assert(JSON.stringify(promoted.treeCommit!.addedManagers) === JSON.stringify([bob]), "the statement names who became a manager");
        assert(promoted.treeCommit!.path.length === 0, "no node moves");
        
        await this.setRoles(groupId, me, [], [bob]);
        const demoted = await this.read(groupId);
        assert(demoted.users.includes(bob) && !demoted.managers.includes(bob), "bob should be a user again");
        assert(JSON.stringify(demoted.treeCommit!.addedUsers) === JSON.stringify([bob]), "the statement names who became a user");
    }
    
    @Test()
    async shouldKeepAtLeastOneManager() {
        const groupId = await this.createGroup();
        await shouldThrowErrorWithCode2(() => this.setRoles(groupId, me, [], [me]), "GROUP_LAST_MANAGER");
        assert((await this.read(groupId)).managers.includes(me), "a refused change must change nothing");
        // With a second manager the first can go: by the other's hand, since nobody demotes themselves by default.
        await this.setRoles(groupId, me, [bob], []);
        await shouldThrowErrorWithCode2(() => this.setRoles(groupId, me, [], [me]), "ACCESS_DENIED");
        await this.setRoles(groupId, bob, [], [me]);
        await shouldThrowErrorWithCode2(() => this.setRoles(groupId, bob, [], [bob]), "GROUP_LAST_MANAGER");
        const group = await this.read(groupId);
        assert(JSON.stringify(group.managers) === JSON.stringify([bob]), `bob should be the only manager, got ${JSON.stringify(group.managers)}`);
    }
    
    @Test()
    async shouldRefuseARoleChangeTheRulesDoNotAllow() {
        const groupId = await this.createGroup();
        // Bob is a user, and the rules leave roles to managers.
        await shouldThrowErrorWithCode2(() => this.setRoles(groupId, bob, [bob], []), "ACCESS_DENIED");
        // Naming nobody who changes lists is refused before anything is signed for.
        await shouldThrowErrorWithCode2(() => this.setRoles(groupId, me, [me], []), "INVALID_PARAMS");
        await shouldThrowErrorWithCode2(() => this.setRoles(groupId, me, [dave], []), "INVALID_PARAMS");
        // The statement must say what the request does.
        const served = await this.read(groupId, me, "plan");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupSetRoles({
            id: groupId,
            changes: [{userId: bob, role: "manager"}],
            keyId: `group-key-${served.keyVersion}` as types.core.KeyId,
            data: "roster" as types.group.GroupData,
            commit: rolesCommitAgainst(served as unknown as ServedGroup, me, [], [carol]),
            expectedKeyVersion: served.keyVersion,
            expectedRosterVersion: served.rosterVersion,
        }), "GROUP_TREE_INVALID");
        assert((await this.read(groupId)).rosterVersion === 1, "nothing refused may land");
    }
    
    @Test()
    async shouldReseatAMemberKeepingTheSeatAndTheRoster() {
        const groupId = await this.createGroup();
        const before = await this.read(groupId, me, "full");
        await this.removeOrReseat(groupId, me, "reseat", [bob]);
        const after = await this.read(groupId, me, "full");
        assert(after.keyVersion === before.keyVersion + 1, "a reseat opens an epoch");
        assert(after.groupPubKey !== before.groupPubKey, "with a new grant key");
        assert(after.users.includes(bob), "bob stays on the roster");
        assert(JSON.stringify(after.leafAssignment) === JSON.stringify(before.leafAssignment), "and in his seat");
        assert(after.treeCommit!.op === "reseat", `the statement's op should be reseat, got ${after.treeCommit!.op}`);
        assert(JSON.stringify(after.treeCommit!.removed) === JSON.stringify([bob]), "the statement names who was reseated");
        // Every keyed node above bob's seat is either blank or one this commit set: nothing he could open before.
        const seq = after.treeCommit!.seq;
        for (const nodeIndex of TreeMath.keyedPath(after.leafAssignment.indexOf(bob), after.numLeaves)) {
            const node = after.treeNodes!.find(x => x.nodeIndex === nodeIndex);
            assert(!node?.publicKey || node.setBy === seq, `node ${nodeIndex} above the reseated seat kept a key from before`);
        }
        await shouldThrowErrorWithCode2(() => this.removeOrReseat(groupId, me, "reseat", [me]), "INVALID_PARAMS");
    }
    
    @Test()
    async shouldLetTheRulesSplitAddingFromRemoving() {
        // Anybody in the group may add; removing (and reseating) stays with managers.
        const groupId = await this.createGroup({addMembers: "user" as types.cloud.PolicyEntry, removeMembers: "manager" as types.cloud.PolicyEntry});
        await this.add(groupId, bob, dave);
        assert((await this.read(groupId)).users.includes(dave), "a user should have added dave");
        await shouldThrowErrorWithCode2(() => this.removeOrReseat(groupId, bob, "remove", [carol]), "ACCESS_DENIED");
        await shouldThrowErrorWithCode2(() => this.removeOrReseat(groupId, bob, "reseat", [carol]), "ACCESS_DENIED");
        await this.removeOrReseat(groupId, me, "remove", [carol]);
        assert(!(await this.read(groupId)).users.includes(carol), "a manager should have removed carol");
    }
    
    @Test()
    async shouldFollowUpdateWhenTheRosterRulesAreNotSet() {
        const groupId = await this.createGroup();
        await shouldThrowErrorWithCode2(() => this.add(groupId, bob, dave), "ACCESS_DENIED");
        // The other way round: adding closed to everybody, removing open to users.
        const closed = await this.createGroup({addMembers: "none" as types.cloud.PolicyEntry, removeMembers: "user" as types.cloud.PolicyEntry});
        await shouldThrowErrorWithCode2(() => this.add(closed, me, dave), "ACCESS_DENIED");
        await this.removeOrReseat(closed, bob, "remove", [carol]);
        assert(!(await this.read(closed)).users.includes(carol), "a user should have removed carol");
    }
    
    private async setRoles(groupId: types.group.GroupId, as: types.cloud.UserId, toManagers: types.cloud.UserId[], toUsers: types.cloud.UserId[]) {
        const served = await this.read(groupId, as, "plan");
        const res = await (await this.apiOf(as)).groupSetRoles({
            id: groupId,
            changes: [...toManagers.map(userId => ({userId, role: "manager" as const})), ...toUsers.map(userId => ({userId, role: "user" as const}))],
            keyId: `group-key-${served.keyVersion}` as types.core.KeyId,
            data: "roster" as types.group.GroupData,
            commit: rolesCommitAgainst(served as unknown as ServedGroup, as, toUsers, toManagers),
            expectedKeyVersion: served.keyVersion,
            expectedRosterVersion: served.rosterVersion,
        });
        assert(res === "OK", "groupSetRoles did not return OK");
    }
    
    private async removeOrReseat(groupId: types.group.GroupId, as: types.cloud.UserId, kind: "remove"|"reseat", userIds: types.cloud.UserId[]) {
        const served = await this.read(groupId, as, "full");
        const newEpoch = served.keyVersion + 1;
        const groupPubKey = newGroupKey();
        const op: PlanOp = {kind, committer: as, removed: userIds};
        const {plan, commit} = commitAgainst(served as unknown as ServedGroup, op, groupPubKey);
        const keyId = `group-key-${newEpoch}` as types.core.KeyId;
        const model = {
            id: groupId,
            userIds: userIds,
            groupPubKey: groupPubKey,
            keyId: keyId,
            data: "roster" as types.group.GroupData,
            transition: removalOf(plan, served.keyVersion),
            commit: commit,
            rungs: rungsFor(newEpoch, served.eraFloor),
            groupKeys: {group: groupId, groupEpoch: newEpoch, keyId: keyId, data: `metadata-key@${newEpoch}` as types.core.UserKeyData},
            expectedKeyVersion: served.keyVersion,
            expectedRosterVersion: served.rosterVersion,
        };
        const api = await this.apiOf(as);
        const res = await (kind === "reseat" ? api.groupReseat(model) : api.groupRemoveMembers(model));
        assert(res === "OK", `${kind} did not return OK`);
    }
    
    private async add(groupId: types.group.GroupId, as: types.cloud.UserId, newcomer: types.cloud.UserId) {
        const api = await this.apiOf(as);
        const {group: served} = await api.groupGet({groupId, scope: "plan", forNewMembers: 1});
        const positions = served.nextFreeSeats!;
        const {plan, commit} = commitAgainst(served as unknown as ServedGroup, {kind: "add", committer: as, members: [newcomer], positions});
        const res = await api.groupAddMembers({
            id: groupId,
            members: [{userId: newcomer, role: "user"}],
            keyId: `group-key-${served.keyVersion}` as types.core.KeyId,
            data: "roster" as types.group.GroupData,
            transition: additionOf(plan, served.keyVersion, positions),
            commit: commit,
            expectedKeyVersion: served.keyVersion,
            expectedRosterVersion: served.rosterVersion,
        });
        assert(res === "OK", "groupAddMembers did not return OK");
    }
    
    private async read(groupId: types.group.GroupId, as: types.cloud.UserId = me, scope: "path"|"plan"|"full" = "path") {
        return (await (await this.apiOf(as)).groupGet({groupId, scope})).group;
    }
    
    private async apiOf(userId: types.cloud.UserId): Promise<ContextApiClient> {
        if (userId === me) {
            return this.apis.contextApi;
        }
        assert(userId === bob, `the tests hold no key for ${userId}`);
        if (!this.bobApi) {
            this.bobApi = new ContextApiClient(await this.helpers.createNewConnection(bobIdentity.privWif as string, testData.solutionId));
        }
        return this.bobApi;
    }
    
    private async createGroup(policy: types.cloud.ContainerPolicy = {}): Promise<types.group.GroupId> {
        if (!this.usersAdded) {
            this.helpers.authorizePlainApi();
            for (const [userId, userPubKey] of [[bob, bobIdentity.pub58], [carol, ECUtils.generateKeyPair().pub58], [dave, ECUtils.generateKeyPair().pub58]] as const) {
                const res = await this.plainApis.contextApi.addUserToContext({
                    contextId: testData.contextId,
                    userId: userId,
                    userPubKey: userPubKey as types.cloud.UserPubKey,
                    acl: "ALLOW ALL" as types.cloud.ContextAcl,
                });
                assert(res === "OK", `addUserToContext(${userId}) did not return OK`);
            }
            this.usersAdded = true;
        }
        const users = [bob, carol];
        const managers = [me];
        const tree = buildTree(SEATING, 1);
        const resourceId = this.helpers.generateResourceId();
        const groupPubKey = newGroupKey();
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            data: "roster" as types.group.GroupData,
            publicMeta: "PUB" as types.group.GroupData,
            privateMeta: "PRIV" as types.group.GroupData,
            keyId: "group-key-1" as types.core.KeyId,
            tree: tree,
            commit: creationStatement(tree, me, {groupId: resourceId, groupPubKey, users, managers, policy}),
        });
        return res.groupId;
    }
}
