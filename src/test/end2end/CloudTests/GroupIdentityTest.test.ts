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
import * as crypto from "crypto";
import { testData } from "../../datasets/testData";
import { buildTree, creationStatement, registerUserKey } from "../../testUtils/TreeFixtures";
import * as types from "../../../types";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { CommitStatement } from "../../../service/cloud/keytree/CommitStatement";

// A group whose id follows from something the application already has: the client names the group by a digest
// of that (the "seed"), and the id is derived from the context and that name, the same for every client.
const groupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;

function seedOf(entity: string) {
    return crypto.createHash("sha256").update(entity).digest("hex") as types.core.ClientResourceId;
}

export class GroupIdentityTests extends BaseTestSet {
    
    @Test()
    async shouldDeriveTheGroupIdFromTheContextAndTheSeed() {
        const seed = seedOf("contact/chat/42");
        const groupId = await this.createGroup(seed);
        // What a client computes before it has asked the bridge anything.
        assert(groupId === CommitStatement.groupId(testData.contextId, seed), "the id is not the derived one");
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.resourceId === seed, "the seed should be served back");
        // Another seed, another group.
        assert(await this.createGroup(seedOf("contact/chat/43")) !== groupId, "two seeds gave one id");
    }
    
    @Test()
    async shouldRefuseASecondGroupUnderTheSameSeed() {
        const seed = seedOf("contact/chat/42");
        await this.createGroup(seed);
        // SECURITY: whoever finds the group already there did not create it. The second creator must learn that,
        // not be handed the first one's group.
        await shouldThrowErrorWithCode2(() => this.createGroup(seed), "DUPLICATE_RESOURCE_ID");
    }
    
    @Test()
    async shouldKeepADeletedGroupsIdTaken() {
        const seed = seedOf("contact/chat/42");
        const groupId = await this.createGroup(seed);
        assert(await this.apis.contextApi.groupDelete({groupId}) === "OK", "groupDelete did not return OK");
        // SECURITY: a new group under the old id would pass for the old one to everybody who pinned it.
        await shouldThrowErrorWithCode2(() => this.createGroup(seed), "DUPLICATE_RESOURCE_ID");
    }
    
    @Test()
    async shouldTakeOnlyAUuidOrADigestAsTheSeed() {
        for (const bad of ["chat-42", "", seedOf("x").toUpperCase(), seedOf("x").slice(1), seedOf("x") + "0"]) {
            await shouldThrowErrorWithCode2(() => this.createGroup(bad as types.core.ClientResourceId), "INVALID_PARAMS");
        }
        assert(!!await this.createGroup(this.helpers.generateResourceId()), "a random uuid is still taken");
    }
    
    private async createGroup(resourceId: types.core.ClientResourceId): Promise<types.group.GroupId> {
        const users = [testData.userId];
        const managers = [testData.userId];
        const tree = buildTree(users, 1);
        registerUserKey(testData.userId, testData.userPrivKey as types.core.EccWif);
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            groupPubKey: groupPubKey,
            users: users,
            managers: managers,
            data: "AAAA" as types.group.GroupData,
            publicMeta: "PUB" as types.group.GroupData,
            privateMeta: "PRIV" as types.group.GroupData,
            keyId: testData.keyId,
            tree: tree,
            commit: creationStatement(tree, testData.userId, {groupId: resourceId, groupPubKey, users, managers}),
        });
        return res.groupId;
    }
}
