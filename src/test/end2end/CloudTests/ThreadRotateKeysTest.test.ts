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

// A second context user ("alice") used to prove the rotateKeys POLICY gate (not just the ACL) is enforced.
const aliceIdentity = ECUtils.generateKeyPair();
const aliceId = "alice" as types.cloud.UserId;
const alicePubKey = aliceIdentity.pub58 as types.cloud.UserPubKey;
const aliceWif = aliceIdentity.privWif as string;

const threadKeyId = "thread-key" as types.core.KeyId;
const rotatedThreadKeyId = "thread-key-2" as types.core.KeyId;

/**
 * Covers the Phase 2 thread key-rotation method (`threadRotateKeys`) and its policy gate
 * (`canRotateContainerKeys` / the `rotateKeys` container policy). Thread only.
 */
export class ThreadRotateKeysTests extends BaseTestSet {
    
    private threadId?: types.thread.ThreadId;
    private aliceThreadApi?: ThreadApiClient;
    
    @Test()
    async shouldRotateThreadKeysWithoutChangingMembership() {
        await this.createOwnerOnlyThread();
        const threadId = this.requireThreadId();
        const before = await this.apis.threadApi.threadGet({threadId});
        const res = await this.apis.threadApi.threadRotateKeys({
            id: threadId,
            keyId: rotatedThreadKeyId,
            keys: [{user: testData.userId, keyId: rotatedThreadKeyId, data: "DDDD" as types.core.UserKeyData}],
            version: before.thread.version,
            force: false,
        });
        assert(res === "OK", "threadRotateKeys did not return OK");
        const after = await this.apis.threadApi.threadGet({threadId});
        assert(after.thread.keyId === rotatedThreadKeyId, "thread should report the rotated keyId");
        assert((after.thread.version as number) === (before.thread.version as number) + 1, "rotation should bump the version by one");
        assert(after.thread.users.length === before.thread.users.length && after.thread.users.every(u => before.thread.users.includes(u)), "a key rotation must NOT change the user set");
        assert(after.thread.managers.length === before.thread.managers.length && after.thread.managers.every(m => before.thread.managers.includes(m)), "a key rotation must NOT change the manager set");
    }
    
    @Test()
    async shouldRejectRotateKeysWithStaleVersionAndNoForce() {
        await this.createOwnerOnlyThread();
        const threadId = this.requireThreadId();
        // The caller may rotate — it lost the version check, which on this method means the thread moved under
        // it. CONTAINER_ROTATED_ALREADY, not ACCESS_DENIED, so a client can retry instead of giving up.
        await shouldThrowErrorWithCode2(() => this.apis.threadApi.threadRotateKeys({
            id: threadId,
            keyId: rotatedThreadKeyId,
            keys: [{user: testData.userId, keyId: rotatedThreadKeyId, data: "DDDD" as types.core.UserKeyData}],
            version: 999 as types.thread.ThreadVersion,
            force: false,
        }), "CONTAINER_ROTATED_ALREADY");
    }
    
    @Test()
    async shouldEnforceRotateKeysPolicyForNonManagers() {
        await this.addAliceToContext();
        await this.createThreadWithManagerOnlyRotatePolicy();
        await this.connectAsAlice();
        const threadId = this.requireThreadId();
        // alice is a USER of the thread (can read it) but NOT a manager; the thread's rotateKeys policy is
        // "manager", so the policy gate — not the ACL (she has ALLOW ALL) — must deny the rotation.
        const before = await this.requireAliceThreadApi().threadGet({threadId});
        await shouldThrowErrorWithCode2(() => this.requireAliceThreadApi().threadRotateKeys({
            id: threadId,
            keyId: rotatedThreadKeyId,
            keys: [
                {user: testData.userId, keyId: rotatedThreadKeyId, data: "DDDD" as types.core.UserKeyData},
                {user: aliceId, keyId: rotatedThreadKeyId, data: "EEEE" as types.core.UserKeyData},
            ],
            version: before.thread.version,
            force: false,
        }), "ACCESS_DENIED");
    }
    
    private async createOwnerOnlyThread() {
        const res = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: threadKeyId,
            keys: [{user: testData.userId, keyId: threadKeyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        this.threadId = res.threadId;
    }
    
    private async createThreadWithManagerOnlyRotatePolicy() {
        const res = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: threadKeyId,
            keys: [
                {user: testData.userId, keyId: threadKeyId, data: "AAAA" as types.core.UserKeyData},
                {user: aliceId, keyId: threadKeyId, data: "BBBB" as types.core.UserKeyData},
            ],
            managers: [testData.userId],
            users: [testData.userId, aliceId],
            policy: {rotateKeys: "manager"} as types.cloud.ContainerPolicy,
        });
        this.threadId = res.threadId;
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
    
    private async connectAsAlice() {
        const conn = await this.helpers.createNewConnection(aliceWif, testData.solutionId);
        this.aliceThreadApi = new ThreadApiClient(conn);
    }
    
    private requireThreadId() {
        assert(this.threadId !== undefined, "threadId is not set");
        return this.threadId;
    }
    
    private requireAliceThreadApi() {
        assert(this.aliceThreadApi !== undefined, "alice's ThreadApi is not connected");
        return this.aliceThreadApi;
    }
}
