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
import { applyRemoval, buildTree, withNodeKeys } from "../../testUtils/TreeFixtures";
import { LadderMath } from "../../../service/cloud/keytree/LadderMath";

const groupIdentity = ECUtils.generateKeyPair();
const groupPubKey = groupIdentity.pub58 as unknown as types.cloud.GroupPubKey;

// A second context user ("alice") created at runtime — she will get access to a thread ONLY through a group.
const aliceIdentity = ECUtils.generateKeyPair();
const aliceId = "alice" as types.cloud.UserId;
const alicePubKey = aliceIdentity.pub58 as types.cloud.UserPubKey;
const aliceWif = aliceIdentity.privWif as string;

// A third context user ("bob") — a DIRECT member of the thread who is in no granted group. He is the control for
// `groupKeys` narrowing: he must see that the grant exists and none of the key material wrapped to it.
const bobIdentity = ECUtils.generateKeyPair();
const bobId = "bob" as types.cloud.UserId;
const bobPubKey = bobIdentity.pub58 as types.cloud.UserPubKey;
const bobWif = bobIdentity.privWif as string;

const groupKeyId = "group-key" as types.core.KeyId;
const threadKeyId = "thread-key" as types.core.KeyId;
const rotatedGroupKeyId = "group-key-2" as types.core.KeyId;
const rotatedGroupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;

/** Real ECC keys, memoized per `(nodeIndex, generation)`: the validator refuses placeholder public keys. */
const nodeKeys = new Map<string, types.core.EccPubKey>();
function nodeKey(nodeIndex: number, generation: number): types.core.EccPubKey {
    const cacheKey = `${nodeIndex}/${generation}`;
    const existing = nodeKeys.get(cacheKey);
    if (existing) {
        return existing;
    }
    const generated = ECUtils.generateKeyPair().pub58 as types.core.EccPubKey;
    nodeKeys.set(cacheKey, generated);
    return generated;
}

export class ThreadGroupGranteeTests extends BaseTestSet {
    
    private groupId?: types.group.GroupId;
    private threadId?: types.thread.ThreadId;
    private aliceThreadApi?: ThreadApiClient;
    private bobThreadApi?: ThreadApiClient;
    private aliceMessageId?: types.thread.ThreadMessageId;
    
    @Test()
    async shouldNarrowGroupKeysToTheCallersOwnGroups() {
        await this.addAliceToContext();
        await this.addBobToContext();
        await this.createGroupWithAlice();
        await this.createThreadGrantingGroup();
        await this.addBobAsDirectThreadUser();
        await this.connectAsAlice();
        await this.connectAsBob();
        await this.aliceGetsTheBlobWrappedToHerGroup();
        await this.bobSeesTheGrantButNoneOfItsKeyMaterial();
    }
    
    @Test()
    async shouldGrantThreadAccessThroughGroupAndRevokeOnRemoval() {
        await this.addAliceToContext();
        await this.createGroupWithAlice();
        await this.createThreadGrantingGroup();
        await this.connectAsAlice();
        await this.aliceCanGetThreadViaGroup();
        await this.aliceCanListThreadViaGroup();
        await this.aliceCanSendMessageViaGroup();
        await this.aliceCanGetMessagesViaGroup();
        await this.removeAliceFromGroup();
        await this.aliceCanNoLongerGetThread();
        await this.aliceCanNoLongerListThread();
        await this.aliceCanNoLongerSendMessage();
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
            tree: withNodeKeys(buildTree(users, 1), nodeKey),
        });
        this.groupId = res.groupId;
    }
    
    private async createThreadGrantingGroup() {
        const groupId = this.requireGroupId();
        // Read the epoch rather than assume one: a grant must name the group's current keyVersion (BR-5).
        const {group} = await this.apis.contextApi.groupGet({groupId});
        const res = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: threadKeyId,
            keys: [{user: testData.userId, keyId: threadKeyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            groups: [{groupId: groupId, role: "user"}],
            groupKeys: [{group: groupId, groupEpoch: group.keyVersion, keyId: threadKeyId, data: "CCCC" as types.core.UserKeyData}],
        });
        this.threadId = res.threadId;
    }
    
    private async addBobToContext() {
        this.helpers.authorizePlainApi();
        const res = await this.plainApis.contextApi.addUserToContext({
            contextId: testData.contextId,
            userId: bobId,
            userPubKey: bobPubKey,
            acl: "ALLOW ALL" as types.cloud.ContextAcl,
        });
        assert(res === "OK", "addUserToContext did not return OK");
    }
    
    /** Bob joins as a plain user of the thread. The group grant is carried over untouched. */
    private async addBobAsDirectThreadUser() {
        const groupId = this.requireGroupId();
        const res = await this.apis.threadApi.threadUpdate({
            id: this.requireThreadId(),
            data: "AAAA" as types.thread.ThreadData,
            keyId: threadKeyId,
            keys: [
                {user: testData.userId, keyId: threadKeyId, data: "AAAA" as types.core.UserKeyData},
                {user: bobId, keyId: threadKeyId, data: "DDDD" as types.core.UserKeyData},
            ],
            managers: [testData.userId],
            users: [testData.userId, bobId],
            groups: [{groupId: groupId, role: "user"}],
            // Empty: the stored entry at this keyId already covers the grant, and re-sending it would have to
            // carry a fresh epoch. Nothing about the grant changes here.
            groupKeys: [],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        });
        assert(res === "OK", "threadUpdate did not return OK");
    }
    
    private async connectAsAlice() {
        const conn = await this.helpers.createNewConnection(aliceWif, testData.solutionId);
        this.aliceThreadApi = new ThreadApiClient(conn);
    }
    
    private async connectAsBob() {
        const conn = await this.helpers.createNewConnection(bobWif, testData.solutionId);
        this.bobThreadApi = new ThreadApiClient(conn);
    }
    
    /** Alice reaches the thread only through the group, so the blob wrapped to it has to reach her. */
    private async aliceGetsTheBlobWrappedToHerGroup() {
        const groupId = this.requireGroupId();
        const res = await this.requireAliceThreadApi().threadGet({threadId: this.requireThreadId()});
        assert(res.thread.groupKeys.length === 1, `alice should get exactly her group's entry, got ${res.thread.groupKeys.length}`);
        assert(res.thread.groupKeys[0].group === groupId, "and it should be the group she belongs to");
        assert(res.thread.groupKeys[0].keys.some(k => k.keyId === threadKeyId), "carrying the blob at the thread's current key");
        assert(res.thread.keys.length === 0, "while she holds no per-user key — the group is her only way in");
    }
    
    /**
     * Bob is a direct user of the thread and in no granted group. He still sees *that* the group is granted — a
     * manager needs that list — but none of the key material wrapped to it, and an empty `groupKeys` is how he
     * knows not to attempt a group descent at all.
     */
    private async bobSeesTheGrantButNoneOfItsKeyMaterial() {
        const groupId = this.requireGroupId();
        const res = await this.requireBobThreadApi().threadGet({threadId: this.requireThreadId()});
        assert(res.thread.groups.some(g => g.groupId === groupId), "bob should still see which groups are granted");
        assert(res.thread.groupKeys.length === 0, `bob belongs to no granted group, so no blobs are his: got ${res.thread.groupKeys.length}`);
        assert(res.thread.keys.length > 0, "he reads the thread through his own per-user key instead");
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
    
    private async aliceCanSendMessageViaGroup() {
        const threadId = this.requireThreadId();
        const res = await this.requireAliceThreadApi().threadMessageSend({
            threadId,
            data: "hello-from-alice" as types.thread.ThreadMessageData,
            keyId: threadKeyId,
        });
        this.aliceMessageId = res.messageId;
    }
    
    private async aliceCanGetMessagesViaGroup() {
        const threadId = this.requireThreadId();
        const res = await this.requireAliceThreadApi().threadMessagesGet({threadId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(res.messages.some(m => m.id === this.requireAliceMessageId()), "alice should see the message she sent via the group-granted thread");
    }
    
    private async removeAliceFromGroup() {
        // The only way a member leaves: blanking the seat, re-keying the path and advancing the epoch happen in
        // one call, so alice cannot keep reading through a key the group still hands out.
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId, scope: "full"});
        const current: types.cloud.GroupTreeState = {
            numLeaves: group.numLeaves,
            leafAssignment: group.leafAssignment,
            nodes: group.treeNodes,
            edges: group.treeEdges,
        };
        const alicePosition = group.leafAssignment.indexOf(aliceId);
        assert(alicePosition >= 0, "alice should hold a seat before she is removed");
        const newEpoch = group.keyVersion + 1;
        const res = await this.apis.contextApi.groupRemoveMember({
            id: groupId,
            userId: aliceId,
            groupPubKey: rotatedGroupPubKey,
            keyId: rotatedGroupKeyId,
            data: "AAAA" as types.group.GroupData,
            tree: withNodeKeys(applyRemoval(current, alicePosition, newEpoch), nodeKey),
            rungs: LadderMath.rungSpansFor(newEpoch, 1).map(span => ({
                atKeyVersion: span.at,
                targetKeyVersion: span.target,
                recipientKind: "epoch" as const,
                data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
            })),
            groupKeys: {
                group: groupId,
                groupEpoch: newEpoch,
                keyId: rotatedGroupKeyId,
                data: `metadata-key@${newEpoch}` as types.core.UserKeyData,
            },
            expectedKeyVersion: group.keyVersion,
        });
        assert(res === "OK", "groupRemoveMember did not return OK");
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
    
    private async aliceCanNoLongerSendMessage() {
        const threadId = this.requireThreadId();
        await shouldThrowErrorWithCode2(() => this.requireAliceThreadApi().threadMessageSend({
            threadId,
            data: "should-fail" as types.thread.ThreadMessageData,
            keyId: threadKeyId,
        }), "ACCESS_DENIED");
    }
    
    private requireAliceMessageId(): types.thread.ThreadMessageId {
        if (!this.aliceMessageId) {
            throw new Error("aliceMessageId not initialized yet");
        }
        return this.aliceMessageId;
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
    
    private requireBobThreadApi(): ThreadApiClient {
        if (!this.bobThreadApi) {
            throw new Error("bob connection not initialized yet");
        }
        return this.bobThreadApi;
    }
}
