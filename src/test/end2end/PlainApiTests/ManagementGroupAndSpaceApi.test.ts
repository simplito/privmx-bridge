/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode, Test } from "../BaseTestSet";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { buildTree, creationStatement, registerUserKey, useRealNodeKeys } from "../../testUtils/TreeFixtures";
import { signSpaceStatement } from "../../testUtils/SpaceFixtures";
import { SpaceService } from "../../../service/cloud/SpaceService";
import { CommitStatement } from "../../../service/cloud/keytree/CommitStatement";

/**
 * What an application's backend reads of groups and spaces: enough to decide whether a write may be stored
 * (is the author a member, is the write under the current key), and nothing a member alone may read.
 */

const me = testData.userId;
const bob = "bob" as types.cloud.UserId;
const bobPub = ECUtils.generateKeyPair().pub58 as types.cloud.UserPubKey;
const myPub = testData.userPubKey as types.cloud.UserPubKey;
const page = {skip: 0, limit: 100, sortOrder: "asc" as const};

useRealNodeKeys();
registerUserKey(me, testData.userPrivKey as types.core.EccWif);

export class ManagementGroupAndSpaceApiTests extends BaseTestSet {
    
    private bobAdded = false;
    
    @Test()
    async shouldServeWhatABackendNeedsToDecideWhetherToStoreAWrite() {
        const groupId = await this.createGroup({addMembers: "members"});
        const spaceId = await this.createSpace(groupId);
        
        // The check a backend makes before it stores an envelope: is the author in, and is the epoch current.
        const mayStore = async (author: types.cloud.UserId, epoch: number) => {
            const {group} = await this.plainApis.groupApi.getGroup({groupId});
            return group.members.some(m => m.userId === author) && epoch === group.keyVersion;
        };
        assert(await mayStore(bob, 1), "a member writing under the current epoch is stored");
        assert(!await mayStore(bob, 2), "a write under another epoch is not");
        assert(!await mayStore("mallory" as types.cloud.UserId, 1), "nor a write of somebody outside the group");
        
        const {group} = await this.plainApis.groupApi.getGroup({groupId});
        assert(group.contextId === testData.contextId && group.creator === me, "identity mismatch");
        assert(group.keyVersion === 1 && group.rosterVersion === 1 && group.lastCommitSeq === 1, "counters of a new group");
        assert(JSON.stringify(group.members) === JSON.stringify([{userId: me, pubKey: myPub, role: "manager"}, {userId: bob, pubKey: bobPub, role: "user"}]), `members mismatch: ${JSON.stringify(group.members)}`);
        assert(JSON.stringify(group.rules) === JSON.stringify({...CommitStatement.DEFAULT_RULES, addMembers: "members"}), `rules mismatch: ${JSON.stringify(group.rules)}`);
        assert(group.visibleTo === "members" && group.publicMeta === "PUB", "visibility or public metadata mismatch");
        for (const field of ["privateMeta", "treeNodes", "treeEdges", "groupKeys", "data", "history", "policy"]) {
            assert(!(field in group), `group/getGroup must not serve '${field}'`);
        }
        
        // The same decision for a space: is the author a recipient, and is the write under the current key.
        const {space} = await this.plainApis.spaceApi.getSpace({spaceId});
        assert(space.keyVersion === 1 && !space.keyIsStale, "a new space is at key version 1 and fresh");
        assert(space.users.some(u => u.userId === me) && space.groups.some(g => g.groupId === groupId && g.groupKeyVersion === 1), "recipients mismatch");
        assert(space.publicMeta === "public", "public metadata mismatch");
        for (const field of ["keys", "privateMeta", "keyId"]) {
            assert(!(field in space), `space/getSpace must not serve '${field}'`);
        }
        const spaces = await this.plainApis.spaceApi.listSpaces({contextId: testData.contextId, ...page});
        assert(spaces.count >= 1 && spaces.list.some(s => s.id === spaceId), "space/listSpaces should list the space");
        
        // A space holds the group; with the space gone the group can go too.
        await shouldThrowErrorWithCode(() => this.plainApis.groupApi.deleteGroup({groupId}), "GROUP_IN_USE");
        assert(await this.plainApis.spaceApi.deleteSpace({spaceId}) === "OK", "space/deleteSpace did not return OK");
        await shouldThrowErrorWithCode(() => this.plainApis.spaceApi.getSpace({spaceId}), "SPACE_DOES_NOT_EXIST");
        assert(await this.plainApis.groupApi.deleteGroup({groupId}) === "OK", "group/deleteGroup did not return OK");
        await shouldThrowErrorWithCode(() => this.plainApis.groupApi.getGroup({groupId}), "GROUP_DOES_NOT_EXIST");
    }
    
    @Test()
    async shouldListGroupsTheirStatementsAndTheGroupsOfAUser() {
        const first = await this.createGroup();
        const second = await this.createGroup({}, false);
        const all = await this.plainApis.groupApi.listGroups({contextId: testData.contextId, ...page});
        assert(all.list.some(g => g.id === first) && all.list.some(g => g.id === second), "both groups should be listed");
        assert(all.list.find(g => g.id === first)!.members.length === 2, "a listed group carries its members");
        
        const ofBob = await this.plainApis.groupApi.listGroupsOfUser({contextId: testData.contextId, userId: bob, ...page});
        assert(JSON.stringify(ofBob.list.filter(g => [first, second].includes(g.groupId))) === JSON.stringify([{groupId: first, role: "user", isLastManager: false}]), `groups of bob mismatch: ${JSON.stringify(ofBob.list)}`);
        const ofMe = await this.plainApis.groupApi.listGroupsOfUser({contextId: testData.contextId, userId: me, ...page});
        assert(ofMe.list.filter(g => [first, second].includes(g.groupId)).every(g => g.role === "manager" && g.isLastManager), "janek is the only manager of both");
        
        const {commits} = await this.plainApis.groupApi.listGroupCommits({groupId: first, fromSeq: 0, limit: 10});
        assert(commits.length === 1 && commits[0].seq === 1 && commits[0].op === "create" && commits[0].committer === me, "the creation statement should be served");
        assert((await this.plainApis.groupApi.listGroupCommits({groupId: first, fromSeq: 1, limit: 10})).commits.length === 0, "nothing after the latest");
        
        const missing = "no-such-group" as types.group.GroupId;
        const {results} = await this.plainApis.groupApi.deleteManyGroups({groupIds: [first, missing, second]});
        assert(JSON.stringify(results) === JSON.stringify([{id: first, status: "OK"}, {id: missing, status: "GROUP_DOES_NOT_EXIST"}, {id: second, status: "OK"}]), `results mismatch: ${JSON.stringify(results)}`);
        await shouldThrowErrorWithCode(() => this.plainApis.groupApi.listGroups({contextId: "no-such-context" as types.context.ContextId, ...page}), "CONTEXT_DOES_NOT_EXIST");
    }
    
    private async createSpace(groupId: types.group.GroupId) {
        const data = Buffer.from("wrap").toString("base64") as types.core.Base64;
        const resourceId = this.helpers.generateResourceId();
        const group = (await this.apis.contextApi.groupGet({groupId, scope: "full"})).group;
        const res = await this.apis.contextApi.spaceCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            statement: signSpaceStatement({
                spaceId: SpaceService.spaceId(testData.contextId, resourceId), contextId: testData.contextId, seq: 1, prevDigest: "", op: "create",
                date: Date.now(), keyVersion: 1, keyCommit: "00".repeat(32),
                groups: [{groupId, role: "user", groupKeyVersion: group.keyVersion, groupPubKey: group.groupPubKey}],
                users: [{userId: me, pubKey: myPub, role: "manager"}],
                signer: me, signerPubKey: myPub, via: "",
            }, ECUtils.fromWIF(testData.userPrivKey as types.core.EccWif)!),
            recipients: [{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}],
            keyId: "space-key-1" as types.core.KeyId,
            keys: [
                {keyVersion: 1, recipient: {userId: me}, data: data, signature: data},
                {keyVersion: 1, recipient: {groupId, groupKeyVersion: 1}, data: data, signature: data},
            ],
            publicMeta: "public",
            privateMeta: "private",
        });
        return res.spaceId;
    }
    
    private async createGroup(changes: Partial<types.cloud.GroupRules> = {}, withBob = true): Promise<types.group.GroupId> {
        const policy = {...CommitStatement.DEFAULT_RULES, ...changes};
        this.helpers.authorizePlainApi();
        if (!this.bobAdded) {
            const res = await this.plainApis.contextApi.addUserToContext({contextId: testData.contextId, userId: bob, userPubKey: bobPub, acl: "ALLOW ALL" as types.cloud.ContextAcl});
            assert(res === "OK", "addUserToContext did not return OK");
            this.bobAdded = true;
        }
        const users = withBob ? [bob] : [];
        const managers = [me];
        const tree = buildTree(withBob ? ["janek", "bob"] : ["janek"], 1);
        const resourceId = this.helpers.generateResourceId();
        const groupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;
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
