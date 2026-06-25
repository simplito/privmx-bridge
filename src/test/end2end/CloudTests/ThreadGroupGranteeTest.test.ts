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
import { ThreadApiClient } from "../../../api/main/thread/ThreadApiClient";

const groupIdentity = ECUtils.generateKeyPair();
const groupPubKey = groupIdentity.pub58 as unknown as types.cloud.GroupPubKey;

// A second context user ("alice") created at runtime — she will get access to a thread ONLY through a group.
const aliceIdentity = ECUtils.generateKeyPair();
const aliceId = "alice" as types.cloud.UserId;
const alicePubKey = aliceIdentity.pub58 as types.cloud.UserPubKey;
const aliceWif = aliceIdentity.privWif as string;

const groupKeyId = "group-key" as types.core.KeyId;
const threadKeyId = "thread-key" as types.core.KeyId;
const rotatedGroupKeyId = "group-key-2" as types.core.KeyId;

export class ThreadGroupGranteeTests extends BaseTestSet {
    
    private groupId?: types.group.GroupId;
    private threadId?: types.thread.ThreadId;
    private aliceThreadApi?: ThreadApiClient;
    
    @Test()
    async shouldGrantThreadAccessThroughGroupAndRevokeOnRemoval() {
        await this.addAliceToContext();
        await this.createGroupWithAlice();
        await this.createThreadGrantingGroup();
        await this.connectAsAlice();
        await this.aliceCanGetThreadViaGroup();
        await this.aliceCanListThreadViaGroup();
        await this.removeAliceFromGroup();
        await this.aliceCanNoLongerGetThread();
        await this.aliceCanNoLongerListThread();
    }
    
    @Test()
    async shouldBlockGroupDeletionWhileGrantedToThread() {
        await this.addAliceToContext();
        await this.createGroupWithAlice();
        await this.createThreadGrantingGroup();
        const groupId = this.requireGroupId();
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupDelete({groupId}), "GROUP_IN_USE");
    }
    
    private async addAliceToContext() {
        this.helpers.authorizePlainApi();
        const res = await this.plainApis.contextApi.addUserToContext({
            contextId: testData.contextId,
            userId: aliceId,
            userPubKey: alicePubKey,
            acl: "ALLOW ALL" as types.cloud.ContextAcl,
        });
        assert(res === "OK", "addUserToContext did not return OK");
    }
    
    private async createGroupWithAlice() {
        const users = [testData.userId, aliceId];
        const managers = [testData.userId];
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            data: "AAAA" as types.group.GroupData,
            keyId: groupKeyId,
            keys: [
                {user: testData.userId, keyId: groupKeyId, data: "AAAA" as types.core.UserKeyData},
                {user: aliceId, keyId: groupKeyId, data: "BBBB" as types.core.UserKeyData},
            ],
        });
        this.groupId = res.groupId;
    }
    
    private async createThreadGrantingGroup() {
        const groupId = this.requireGroupId();
        const res = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: threadKeyId,
            keys: [{user: testData.userId, keyId: threadKeyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            groups: [{groupId: groupId, role: "user"}],
            groupKeys: [{group: groupId, keyId: threadKeyId, data: "CCCC" as types.core.UserKeyData}],
        });
        this.threadId = res.threadId;
    }
    
    private async connectAsAlice() {
        const conn = await this.helpers.createNewConnection(aliceWif, testData.solutionId);
        this.aliceThreadApi = new ThreadApiClient(conn);
    }
    
    private async aliceCanGetThreadViaGroup() {
        const threadId = this.requireThreadId();
        const res = await this.requireAliceThreadApi().threadGet({threadId});
        assert(res.thread.id === threadId, "alice should be able to get the thread via the group");
        assert(res.thread.groups.some(g => g.groupId === this.requireGroupId()), "thread should list the granted group");
    }
    
    private async aliceCanListThreadViaGroup() {
        const threadId = this.requireThreadId();
        const res = await this.requireAliceThreadApi().threadList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc", scope: "MEMBER"});
        assert(res.threads.some(t => t.id === threadId), "alice should see the thread in her MEMBER list via the group");
    }
    
    private async removeAliceFromGroup() {
        // Removal via full-replace groupUpdate; membership integrity is committed inside `data` by the endpoint,
        // not verified by the bridge. modifyMembers (delta) is deferred — see documents/plan/08-future-plans.md.
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId});
        const res = await this.apis.contextApi.groupUpdate({
            id: groupId,
            groupPubKey: groupPubKey,
            users: [testData.userId],
            managers: [testData.userId],
            data: "AAAA" as types.group.GroupData,
            keyId: rotatedGroupKeyId,
            keys: [{user: testData.userId, keyId: rotatedGroupKeyId, data: "AAAA" as types.core.UserKeyData}],
            version: group.version,
            force: false,
        });
        assert(res === "OK", "groupUpdate did not return OK");
    }
    
    private async aliceCanNoLongerGetThread() {
        const threadId = this.requireThreadId();
        await shouldThrowErrorWithCode2(() => this.requireAliceThreadApi().threadGet({threadId}), "ACCESS_DENIED");
    }
    
    private async aliceCanNoLongerListThread() {
        const threadId = this.requireThreadId();
        const res = await this.requireAliceThreadApi().threadList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc", scope: "MEMBER"});
        assert(!res.threads.some(t => t.id === threadId), "alice should no longer see the thread after being removed from the group");
    }
    
    private requireGroupId(): types.group.GroupId {
        if (!this.groupId) {
            throw new Error("groupId not initialized yet");
        }
        return this.groupId;
    }
    
    private requireThreadId(): types.thread.ThreadId {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        return this.threadId;
    }
    
    private requireAliceThreadApi(): ThreadApiClient {
        if (!this.aliceThreadApi) {
            throw new Error("alice connection not initialized yet");
        }
        return this.aliceThreadApi;
    }
}
