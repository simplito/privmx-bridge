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
import { GroupMembershipSignature, GroupSignaturePayload } from "../../../service/cloud/GroupMembershipSignature";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { Base64 } from "../../../utils/Base64";

const groupIdentity = ECUtils.generateKeyPair();
const groupPubKey = groupIdentity.pub58 as unknown as types.cloud.GroupPubKey;

/** Signs a group membership-log payload with janek's context private key (matches testData.userPubKey). */
function signAsJanek(payload: GroupSignaturePayload): types.core.EccSignature {
    const keyPair = ECUtils.fromWIF(testData.userPrivKey as types.core.EccWif);
    if (!keyPair) {
        throw new Error("Failed to load test private key");
    }
    return Base64.from(ECUtils.signToCompactSignature(keyPair, GroupMembershipSignature.digest(payload))) as types.core.EccSignature;
}

export class GroupApiTests extends BaseTestSet {
    
    private groupId?: types.group.GroupId;
    
    @Test()
    async shouldCreateGetAndListGroup() {
        await this.createGroup();
        await this.getGroupAndVerify();
        await this.listGroupsAndVerify();
    }
    
    @Test()
    async shouldRejectCreateWithInvalidSignature() {
        // A well-formed signature (passes the eccSignature validator) but signed over a different member
        // set, so the bridge's signature verification — not the input validator — rejects it.
        const wrongSignature = signAsJanek({
            op: "create",
            contextId: testData.contextId,
            author: testData.userId,
            authorPubKey: testData.userPubKey,
            groupPubKey: groupPubKey,
            keyId: testData.keyId,
            prevSignature: null,
            resultUsers: ["someone-else" as types.cloud.UserId],
            resultManagers: ["someone-else" as types.cloud.UserId],
        });
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            groupPubKey: groupPubKey,
            users: [testData.userId],
            managers: [testData.userId],
            data: "AAAA" as types.group.GroupData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            signature: wrongSignature,
        }), "INVALID_SIGNATURE");
    }
    
    @Test()
    async shouldUpdateGroupAndEnforceSignatureChain() {
        await this.createGroup();
        const head = await this.getHeadSignature();
        await this.updateGroup(head);
        await this.tryUpdateWithWrongPrevSignatureAndFail();
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
            groupKeys: [{group: groupId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
        });
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupDelete({groupId}), "GROUP_IN_USE");
    }
    
    private async createGroup() {
        const users = [testData.userId];
        const managers = [testData.userId];
        const signature = signAsJanek({
            op: "create",
            contextId: testData.contextId,
            author: testData.userId,
            authorPubKey: testData.userPubKey,
            groupPubKey: groupPubKey,
            keyId: testData.keyId,
            prevSignature: null,
            resultUsers: users,
            resultManagers: managers,
        });
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            data: "AAAA" as types.group.GroupData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            signature: signature,
        });
        assert(!!res.groupId, "groupCreate did not return a groupId");
        this.groupId = res.groupId;
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
        assert(group.history[0].op === "create", "genesis op should be create");
        assert(group.history[0].prevSignature === null, "genesis prevSignature should be null");
        assert(!!group.history[0].signature, "genesis entry should carry a signature");
    }
    
    private async listGroupsAndVerify() {
        const res = await this.apis.contextApi.groupList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(res.count === 1 && res.groups.length === 1, `expected 1 group, got ${res.count}`);
        assert(res.groups[0].id === this.requireGroupId(), "listed groupId mismatch");
    }
    
    private async getHeadSignature(): Promise<types.core.EccSignature> {
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId});
        return group.history[group.history.length - 1].signature;
    }
    
    private async updateGroup(prevSignature: types.core.EccSignature) {
        const groupId = this.requireGroupId();
        const users = [testData.userId];
        const managers = [testData.userId];
        const signature = signAsJanek({
            op: "update",
            contextId: testData.contextId,
            author: testData.userId,
            authorPubKey: testData.userPubKey,
            groupPubKey: groupPubKey,
            keyId: testData.keyId,
            prevSignature: prevSignature,
            resultUsers: users,
            resultManagers: managers,
        });
        const res = await this.apis.contextApi.groupUpdate({
            id: groupId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            data: "AAAAB" as types.group.GroupData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            version: 1 as types.group.GroupVersion,
            force: false,
            signature: signature,
            prevSignature: prevSignature,
        });
        assert(res === "OK", "groupUpdate did not return OK");
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.version === 2, `version should be 2 after update, got ${group.version}`);
    }
    
    private async tryUpdateWithWrongPrevSignatureAndFail() {
        const groupId = this.requireGroupId();
        // Well-formed signature (passes the eccSignature validator) that simply does not match the head,
        // so the chain-link check — not the input validator — rejects it.
        const wrongPrev = Base64.from(Buffer.alloc(65)) as types.core.EccSignature;
        const users = [testData.userId];
        const managers = [testData.userId];
        const signature = signAsJanek({
            op: "update",
            contextId: testData.contextId,
            author: testData.userId,
            authorPubKey: testData.userPubKey,
            groupPubKey: groupPubKey,
            keyId: testData.keyId,
            prevSignature: wrongPrev,
            resultUsers: users,
            resultManagers: managers,
        });
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupUpdate({
            id: groupId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            data: "AAAAC" as types.group.GroupData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            version: 2 as types.group.GroupVersion,
            force: false,
            signature: signature,
            prevSignature: wrongPrev,
        }), "GROUP_VERSION_MISMATCH");
    }
    
    private requireGroupId(): types.group.GroupId {
        if (!this.groupId) {
            throw new Error("groupId not initialized yet");
        }
        return this.groupId;
    }
}
