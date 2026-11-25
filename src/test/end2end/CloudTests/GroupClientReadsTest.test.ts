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
import { buildTree, creationStatement, registerUserKey } from "../../testUtils/TreeFixtures";
import * as types from "../../../types";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { ContextApiClient } from "../../../api/main/context/ContextApiClient";
import { ERROR_CODES } from "../../../api/AppException";

// What a client reads beside `groupGet`: several groups at once, and - from outside a group - the key to seal to.
const groupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;

// A second context user, in none of the groups created here.
const outsiderIdentity = ECUtils.generateKeyPair();
const outsiderId = "outsider" as types.cloud.UserId;
const outsiderPubKey = outsiderIdentity.pub58 as types.cloud.UserPubKey;
const outsiderWif = outsiderIdentity.privWif as string;

export class GroupClientReadsTests extends BaseTestSet {
    
    private outsiderApi?: ContextApiClient;
    
    @Test()
    async shouldServeTheIdentityKeyToAMemberWithTheStatementThatVouchesForIt() {
        const groupId = await this.createGroup();
        const {group} = await this.apis.contextApi.groupGetPublicKey({groupId});
        assert(group.id === groupId, "id mismatch");
        assert(group.contextId === testData.contextId, "contextId mismatch");
        assert(group.groupPubKey === groupPubKey, "groupPubKey mismatch");
        assert(group.keyVersion === 1, `keyVersion should be 1, got ${group.keyVersion}`);
        assert(group.visibleTo === "members", `a group is visible to its members by default, got ${group.visibleTo}`);
        assert(group.users.length === 1 && group.users[0] === testData.userId, "roster mismatch");
        assert(group.managers.length === 1 && group.managers[0] === testData.userId, "managers mismatch");
        // The statement is what a client checks the key against: it has to be the latest, and name this key.
        assert(group.treeCommit.seq === 1, `the latest statement of a new group is its first, got ${group.treeCommit.seq}`);
        assert(group.treeCommit.groupPubKey === groupPubKey, "the statement names another key");
        assert(group.treeCommit.keyVersion === group.keyVersion, "the statement names another epoch");
        assert(group.treeCommit.committer === testData.userId, "the statement names another committer");
        // Nothing a member alone may read comes along.
        for (const field of ["treeNodes", "treeEdges", "groupKeys", "publicMeta", "privateMeta", "history", "data"]) {
            assert(!(field in group), `groupGetPublicKey must not serve '${field}'`);
        }
    }
    
    @Test()
    async shouldHideAGroupFromANonMemberUntilItIsVisibleToTheContext() {
        const groupId = await this.createGroup();
        const outsider = await this.connectOutsider();
        // Not "access denied": to somebody outside, a group they may not see does not exist.
        await shouldThrowErrorWithCode2(() => outsider.groupGetPublicKey({groupId}), "GROUP_DOES_NOT_EXIST");
        
        assert(await this.apis.contextApi.groupSetVisibility({groupId, visibleTo: "context"}) === "OK", "groupSetVisibility did not return OK");
        const {group} = await outsider.groupGetPublicKey({groupId});
        assert(group.groupPubKey === groupPubKey, "groupPubKey mismatch");
        assert(group.visibleTo === "context", "visibleTo should be context");
        assert(group.treeCommit.seq === 1, "the statement should come along");
        
        // Visible is not readable: the tree, the keys and the metadata stay the members'.
        await shouldThrowErrorWithCode2(() => outsider.groupGet({groupId}), "ACCESS_DENIED");
        // The signed chain is public info, though: a client that pinned the group replays it to catch up.
        const chain = await outsider.groupGetTreeCommits({groupId, fromSeq: 0});
        assert(chain.commits.length === 1 && chain.commits[0].seq === 1, "the chain should be served");
        assert(Object.keys(chain).every(k => ["commits", "genesisUsers", "genesisManagers"].includes(k)), `unexpected fields: ${Object.keys(chain).join(",")}`);
        
        await this.apis.contextApi.groupSetVisibility({groupId, visibleTo: "members"});
        await shouldThrowErrorWithCode2(() => outsider.groupGetTreeCommits({groupId, fromSeq: 0}), "ACCESS_DENIED");
        await shouldThrowErrorWithCode2(() => outsider.groupGetPublicKey({groupId}), "GROUP_DOES_NOT_EXIST");
    }
    
    @Test()
    async shouldLetOnlyAManagerChangeVisibility() {
        const groupId = await this.createGroup();
        const outsider = await this.connectOutsider();
        await shouldThrowErrorWithCode2(() => outsider.groupSetVisibility({groupId, visibleTo: "context"}), "ACCESS_DENIED");
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.visibleTo === "members", "a refused call must change nothing");
        await shouldThrowErrorWithCode2(
            () => this.apis.contextApi.groupSetVisibility({groupId: "no-such-group" as types.group.GroupId, visibleTo: "context"}),
            "GROUP_DOES_NOT_EXIST",
        );
    }
    
    @Test()
    async shouldCreateAGroupVisibleToTheContext() {
        const groupId = await this.createGroup("context");
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.visibleTo === "context", `visibleTo should be context, got ${group.visibleTo}`);
        const listed = await this.apis.contextApi.groupList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(listed.groups.find(x => x.id === groupId)?.visibleTo === "context", "the listing should carry visibleTo");
        const outsider = await this.connectOutsider();
        assert((await outsider.groupGetPublicKey({groupId})).group.groupPubKey === groupPubKey, "a visible group serves its key");
    }
    
    @Test()
    async shouldReadSeveralGroupsAndReportEachOnItsOwn() {
        const first = await this.createGroup();
        const second = await this.createGroup();
        const missing = "no-such-group" as types.group.GroupId;
        const {results} = await this.apis.contextApi.groupGetMany({groupIds: [first, missing, second]});
        assert(results.length === 3, `one result per id, got ${results.length}`);
        assert("group" in results[0] && results[0].group.id === first, "the first result should be the first group");
        assert("error" in results[1] && results[1].error.code === ERROR_CODES.GROUP_DOES_NOT_EXIST.code, "a missing group reports its own error");
        assert("group" in results[2] && results[2].group.id === second, "and does not take the next one with it");
        // Each is exactly the read `groupGet` gives in the path scope.
        const single = (await this.apis.contextApi.groupGet({groupId: first})).group;
        assert("group" in results[0] && JSON.stringify(results[0].group) === JSON.stringify(single), "an entry should equal what groupGet serves");
        assert(single.ownLeafPosition !== undefined, "the caller's seat should be served");
        
        // What the caller may not read is an error entry, not a failed request.
        const outsider = await this.connectOutsider();
        const asOutsider = await outsider.groupGetMany({groupIds: [first]});
        assert("error" in asOutsider.results[0] && asOutsider.results[0].error.code === ERROR_CODES.ACCESS_DENIED.code, "a non-member gets an error entry");
        
        assert((await this.apis.contextApi.groupGetMany({groupIds: []})).results.length === 0, "no ids, no results");
        await shouldThrowErrorWithCode2(
            () => this.apis.contextApi.groupGetMany({groupIds: new Array(129).fill(first)}),
            "INVALID_PARAMS",
        );
    }
    
    private async createGroup(visibleTo?: "members"|"context"): Promise<types.group.GroupId> {
        const users = [testData.userId];
        const managers = [testData.userId];
        const tree = buildTree(users, 1);
        registerUserKey(testData.userId, testData.userPrivKey as types.core.EccWif);
        const resourceId = this.helpers.generateResourceId();
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            ...(visibleTo ? {visibleTo} : {}),
            data: "AAAA" as types.group.GroupData,
            publicMeta: "PUB" as types.group.GroupData,
            privateMeta: "PRIV" as types.group.GroupData,
            keyId: testData.keyId,
            tree: tree,
            commit: creationStatement(tree, testData.userId, {groupId: resourceId, groupPubKey, users, managers}),
        });
        return res.groupId;
    }
    
    private async connectOutsider(): Promise<ContextApiClient> {
        if (!this.outsiderApi) {
            this.helpers.authorizePlainApi();
            const res = await this.plainApis.contextApi.addUserToContext({
                contextId: testData.contextId,
                userId: outsiderId,
                userPubKey: outsiderPubKey,
                acl: "ALLOW ALL" as types.cloud.ContextAcl,
            });
            assert(res === "OK", "addUserToContext did not return OK");
            this.outsiderApi = new ContextApiClient(await this.helpers.createNewConnection(outsiderWif, testData.solutionId));
        }
        return this.outsiderApi;
    }
}
