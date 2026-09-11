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
import { buildTree } from "../../testUtils/TreeFixtures";
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
    async shouldUpdatePolicyWithoutTouchingMetadata() {
        await this.createGroup();
        await this.updatePolicyWithoutTouchingMetadata();
    }
    
    @Test()
    async shouldLetBothMetadataPlanesBeWrittenConcurrently() {
        await this.createGroup();
        await this.concurrentPlaneWritesBothLand();
    }
    
    @Test()
    async shouldNoLongerExposeGroupUpdate() {
        await this.createGroup();
        await this.groupUpdateIsGone();
    }
    
    @Test()
    async shouldRejectDeletingGroupReferencedByThread() {
        await this.createGroup();
        const groupId = this.requireGroupId();
        // Read the epoch rather than assume one: a grant must name the group's current keyVersion (BR-5).
        const {group} = await this.apis.contextApi.groupGet({groupId});
        await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            groups: [{groupId: groupId, role: "user"}],
            groupKeys: [{group: groupId, groupEpoch: group.keyVersion, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
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
            publicMeta: "PUB" as types.group.GroupData,
            privateMeta: "PRIV" as types.group.GroupData,
            keyId: testData.keyId,
            tree: buildTree(users, 1),
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
        assert(group.publicMetaVersion === 1, `publicMetaVersion should be 1, got ${group.publicMetaVersion}`);
        assert(group.privateMetaVersion === 1, `privateMetaVersion should be 1, got ${group.privateMetaVersion}`);
        // Each envelope comes back on its own field, and the two are not crossed.
        assert(group.publicMeta.data === "PUB", `publicMeta mismatch, got ${String(group.publicMeta.data)}`);
        assert(group.privateMeta.data === "PRIV", `privateMeta mismatch, got ${String(group.privateMeta.data)}`);
        assert(group.history.length === 1, "history should have a single genesis entry");
        assert(group.history[0].author === testData.userId, "genesis author mismatch");
    }
    
    private async listGroupsAndVerify() {
        const res = await this.apis.contextApi.groupList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(res.count === 1 && res.groups.length === 1, `expected 1 group, got ${res.count}`);
        assert(res.groups[0].id === this.requireGroupId(), "listed groupId mismatch");
        assert(res.groups[0].publicMetaVersion === 1, `listed publicMetaVersion should be 1, got ${res.groups[0].publicMetaVersion}`);
        assert(res.groups[0].privateMetaVersion === 1, `listed privateMetaVersion should be 1, got ${res.groups[0].privateMetaVersion}`);
        // A listing must grow as `groups × roster`, not `groups × state`.
        const served = res.groups[0] as unknown as Record<string, unknown>;
        for (const field of ["data", "publicMeta", "privateMeta", "history", "keys", "groupKeys", "treeNodes", "treeEdges", "leafAssignment", "numLeaves", "archiveRungs"]) {
            assert(!(field in served), `groupList must not serve '${field}'`);
        }
    }
    
    /**
     * `groupList` filtered by id — the call a client makes after reading `staleGroups` off a container, to learn
     * those groups' `groupPubKey` and `keyVersion` without one `groupGet` per grant.
     *
     * Under test are the two ids that must *not* come back: one belongs to another context, one does not exist.
     * Both are skipped rather than raising, because the id list a client filters by comes from a container
     * payload that may already be out of date.
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
        // The strongest end-to-end statement of the split: the two counters advance independently, so after one
        // write to each plane they read 2 and 2 — and after the first write alone, 2 and 1.
        const publicRes = await this.apis.contextApi.groupUpdatePublicMeta({
            id: groupId,
            data: "PUB2" as types.group.GroupData,
            keyId: testData.keyId,
            version: 1 as types.group.GroupVersion,
        });
        assert(publicRes === "OK", "groupUpdatePublicMeta did not return OK");
        const afterPublic = (await this.apis.contextApi.groupGet({groupId})).group;
        assert(afterPublic.publicMetaVersion === 2, `publicMetaVersion should be 2, got ${afterPublic.publicMetaVersion}`);
        assert(afterPublic.privateMetaVersion === 1, `a public write must not move the private counter, got ${afterPublic.privateMetaVersion}`);
        assert(afterPublic.privateMeta.data === "PRIV", "a public write must not disturb the private envelope");
        
        const privateRes = await this.apis.contextApi.groupUpdatePrivateMeta({
            id: groupId,
            data: "PRIV2" as types.group.GroupData,
            keyId: testData.keyId,
            version: 1 as types.group.GroupVersion,
        });
        assert(privateRes === "OK", "groupUpdatePrivateMeta did not return OK");
        const afterPrivate = (await this.apis.contextApi.groupGet({groupId})).group;
        assert(afterPrivate.publicMetaVersion === 2, `publicMetaVersion should still be 2, got ${afterPrivate.publicMetaVersion}`);
        assert(afterPrivate.privateMetaVersion === 2, `privateMetaVersion should be 2, got ${afterPrivate.privateMetaVersion}`);
        assert(afterPrivate.publicMeta.data === "PUB2", "the public envelope must carry through");
        assert(afterPrivate.privateMeta.data === "PRIV2", "the private envelope must carry through");
    }
    
    private async tryUpdateWithStaleVersionAndFail() {
        const groupId = this.requireGroupId();
        // Both counters are now 2, so submitting 1 must be rejected. Unlike the other containers there is no
        // force to override it: a group entry commits a tag over the version it lands at, so a stale update
        // could only publish a tag no client would accept.
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupUpdatePublicMeta({
            id: groupId,
            data: "PUB3" as types.group.GroupData,
            keyId: testData.keyId,
            version: 1 as types.group.GroupVersion,
        }), "GROUP_VERSION_MISMATCH");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupUpdatePrivateMeta({
            id: groupId,
            data: "PRIV3" as types.group.GroupData,
            keyId: testData.keyId,
            version: 1 as types.group.GroupVersion,
        }), "GROUP_VERSION_MISMATCH");
    }
    
    /**
     * The policy has a method of its own, and it disturbs neither signed envelope.
     *
     * No version is submitted and none is checked, so two writes in a row both land — there is no counter for a
     * client to know, because the policy has never been inside an envelope a reader verifies.
     */
    private async updatePolicyWithoutTouchingMetadata() {
        const groupId = this.requireGroupId();
        const before = (await this.apis.contextApi.groupGet({groupId})).group;
        
        assert(await this.apis.contextApi.groupUpdatePolicy({
            id: groupId, policy: {get: "all" as types.cloud.PolicyEntry},
        }) === "OK", "groupUpdatePolicy did not return OK");
        const after = (await this.apis.contextApi.groupGet({groupId})).group;
        assert(after.policy.get === "all", `policy did not land, got ${String(after.policy.get)}`);
        assert(after.publicMetaVersion === before.publicMetaVersion, "a policy write moved the public counter");
        assert(after.privateMetaVersion === before.privateMetaVersion, "a policy write moved the private counter");
        assert(after.rosterVersion === before.rosterVersion, "a policy write moved the roster version");
        assert(after.publicMeta.data === before.publicMeta.data, "a policy write rewrote the public envelope");
        assert(after.privateMeta.data === before.privateMeta.data, "a policy write rewrote the private envelope");
        
        // No CAS: the second write is not a lost race, it simply wins.
        assert(await this.apis.contextApi.groupUpdatePolicy({
            id: groupId, policy: {get: "user" as types.cloud.PolicyEntry},
        }) === "OK", "a second policy write in a row must not be refused");
        const twice = (await this.apis.contextApi.groupGet({groupId})).group;
        assert(twice.policy.get === "user", "the later policy write must win");
        assert(twice.publicMetaVersion === before.publicMetaVersion, "still no counter moved");
    }
    
    /**
     * Concurrent writes to the two planes both land.
     *
     * Both `$set` `lastModifier`/`lastModificationDate` on the same document, so Mongo raises a WriteConflict
     * and the driver's `session.withTransaction` retries the loser; the retried body re-reads and re-checks its
     * OWN counter, which the other plane never moved. Before the split the two shared one counter and one of
     * them always lost — so "both landed" is precisely what this change bought.
     */
    private async concurrentPlaneWritesBothLand() {
        const groupId = this.requireGroupId();
        const before = (await this.apis.contextApi.groupGet({groupId})).group;
        const [publicRes, privateRes] = await Promise.all([
            this.apis.contextApi.groupUpdatePublicMeta({
                id: groupId, data: "RACED_PUB" as types.group.GroupData,
                keyId: testData.keyId, version: before.publicMetaVersion,
            }),
            this.apis.contextApi.groupUpdatePrivateMeta({
                id: groupId, data: "RACED_PRIV" as types.group.GroupData,
                keyId: testData.keyId, version: before.privateMetaVersion,
            }),
        ]);
        assert(publicRes === "OK" && privateRes === "OK", "a plane lost a race it shares no counter with");
        const after = (await this.apis.contextApi.groupGet({groupId})).group;
        assert(after.publicMetaVersion === before.publicMetaVersion + 1, "the public counter did not advance once");
        assert(after.privateMetaVersion === before.privateMetaVersion + 1, "the private counter did not advance once");
        assert(after.publicMeta.data === "RACED_PUB", "the public write reported success without landing");
        assert(after.privateMeta.data === "RACED_PRIV", "the private write reported success without landing");
    }
    
    /** The removed method must be gone from the wire, not merely unused. */
    private async groupUpdateIsGone() {
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.conn.call("context.groupUpdate", {
            id: this.requireGroupId(),
            data: "X" as types.group.GroupData,
            keyId: testData.keyId,
            version: 1 as types.group.GroupVersion,
        }, {sendAlone: true}), "METHOD_NOT_FOUND");
    }
    
    private requireGroupId(): types.group.GroupId {
        if (!this.groupId) {
            throw new Error("groupId not initialized yet");
        }
        return this.groupId;
    }
}
