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

// The bridge stores group data opaquely; signing/verification is the endpoint's job (committed inside `data`).
// These tests exercise CRUD, listing, version-CAS and referential integrity only.
const groupIdentity = ECUtils.generateKeyPair();
const groupPubKey = groupIdentity.pub58 as unknown as types.cloud.GroupPubKey;

export class GroupApiTests extends BaseTestSet {
    
    private groupId?: types.group.GroupId;
    
    @Test()
    async shouldCreateGetAndListGroup() {
        await this.createGroup();
        await this.getGroupAndVerify();
        await this.listGroupsAndVerify();
    }
    
    @Test()
    async shouldListOnlyTheRequestedGroupIds() {
        await this.createGroup();
        await this.listGroupsByIdAndVerify();
    }
    
    @Test()
    async shouldUpdateGroupAndEnforceVersion() {
        await this.createGroup();
        await this.updateGroup();
        await this.tryUpdateWithStaleVersionAndFail();
    }
    
    @Test()
    async shouldRejectDeletingGroupReferencedByThread() {
        await this.createGroup();
        const groupId = this.requireGroupId();
        await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            groups: [{groupId: groupId, role: "user"}],
            groupKeys: [{group: groupId, groupEpoch: 0, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
        });
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupDelete({groupId}), "GROUP_IN_USE");
    }
    
    private async createGroup() {
        this.groupId = await this.createGroupIn(testData.contextId);
    }
    
    private async createGroupIn(contextId: types.context.ContextId): Promise<types.group.GroupId> {
        const users = [testData.userId];
        const managers = [testData.userId];
        const res = await this.apis.contextApi.groupCreate({
            contextId: contextId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            data: "AAAA" as types.group.GroupData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
        });
        assert(!!res.groupId, "groupCreate did not return a groupId");
        return res.groupId;
    }
    
    private async getGroupAndVerify() {
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.id === groupId, "groupId mismatch");
        assert(group.groupPubKey === groupPubKey, "groupPubKey mismatch");
        assert(group.users.length === 1 && group.users[0] === testData.userId, "users mismatch");
        assert(group.managers.length === 1 && group.managers[0] === testData.userId, "managers mismatch");
        assert(group.version === 1, `version should be 1, got ${group.version}`);
        assert(group.history.length === 1, "history should have a single genesis entry");
        assert(group.history[0].author === testData.userId, "genesis author mismatch");
    }
    
    private async listGroupsAndVerify() {
        const res = await this.apis.contextApi.groupList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(res.count === 1 && res.groups.length === 1, `expected 1 group, got ${res.count}`);
        assert(res.groups[0].id === this.requireGroupId(), "listed groupId mismatch");
        assert(res.groups[0].version === 1, `listed version should be 1, got ${res.groups[0].version}`);
        // A listing must grow as `groups × roster`, not `groups × state`.
        const served = res.groups[0] as unknown as Record<string, unknown>;
        for (const field of ["data", "history", "keys", "groupKeys", "treeNodes", "treeEdges", "leafAssignment", "numLeaves", "archiveRungs"]) {
            assert(!(field in served), `groupList must not serve '${field}'`);
        }
    }
    
    /**
     * `groupList` filtered by id — the call a client makes after reading `staleGroups` off a container, to learn
     * those groups' `groupPubKey` and `keyVersion` without one `groupGet` per grant.
     *
     * The two ids that must *not* come back are the point of the test: one belongs to another context, one does
     * not exist. Both are skipped rather than raising, because the id list a client filters by comes from a
     * container payload that may already be out of date.
     */
    private async listGroupsByIdAndVerify() {
        const mine = this.requireGroupId();
        const elsewhere = await this.createGroupIn(testData.contextId2);
        const missing = "000000000000000000000000" as types.group.GroupId;
        const res = await this.apis.contextApi.groupList({
            contextId: testData.contextId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {"#id": {$in: [mine, elsewhere, missing]}},
        });
        assert(res.count === 1 && res.groups.length === 1, `expected 1 group, got ${res.count}`);
        assert(res.groups[0].id === mine, "the filter served a group that was not asked for");
        assert(res.groups[0].groupPubKey === groupPubKey, "the summary must carry the pubkey a re-key wraps to");
        assert(res.groups[0].keyVersion !== undefined, "the summary must carry the epoch a re-key declares");
        // Unfiltered, the context still serves its own group and nothing from the other one.
        const all = await this.apis.contextApi.groupList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(all.count === 1 && all.groups[0].id === mine, `expected 1 group unfiltered, got ${all.count}`);
    }
    
    private async updateGroup() {
        const groupId = this.requireGroupId();
        const res = await this.apis.contextApi.groupUpdate({
            id: groupId,
            groupPubKey: groupPubKey,
            users: [testData.userId],
            managers: [testData.userId],
            data: "AAAAB" as types.group.GroupData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            version: 1 as types.group.GroupVersion,
            force: false,
        });
        assert(res === "OK", "groupUpdate did not return OK");
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.version === 2, `version should be 2 after update, got ${group.version}`);
    }
    
    private async tryUpdateWithStaleVersionAndFail() {
        const groupId = this.requireGroupId();
        // current version is now 2; submitting version 1 without force must be rejected (optimistic concurrency).
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupUpdate({
            id: groupId,
            groupPubKey: groupPubKey,
            users: [testData.userId],
            managers: [testData.userId],
            data: "AAAAC" as types.group.GroupData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            version: 1 as types.group.GroupVersion,
            force: false,
        }), "GROUP_VERSION_MISMATCH");
    }
    
    private requireGroupId(): types.group.GroupId {
        if (!this.groupId) {
            throw new Error("groupId not initialized yet");
        }
        return this.groupId;
    }
}
