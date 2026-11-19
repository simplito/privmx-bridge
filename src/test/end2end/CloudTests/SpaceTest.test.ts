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
import { PromiseUtils } from "../../../utils/PromiseUtils";
import { buildTree, commitAgainst, creationStatement, PlanOp, registerUserKey, removalOf, rungsFor, ServedGroup, useRealNodeKeys } from "../../testUtils/TreeFixtures";

/**
 * A space: one key in versions, wrapped for groups and users. The bridge never reads a wrap, so the tests put
 * a label where a client puts ciphertext and check who is served which entry.
 */

const me = testData.userId;
const bob = "bob" as types.cloud.UserId;
const carol = "carol" as types.cloud.UserId;
const SEATING = ["janek", "bob", "carol"];

useRealNodeKeys();
registerUserKey(me, testData.userPrivKey as types.core.EccWif);
const bobIdentity = ECUtils.generateKeyPair();
const carolIdentity = ECUtils.generateKeyPair();
const bobPub = bobIdentity.pub58 as types.cloud.UserPubKey;
const myPub = testData.userPubKey as types.cloud.UserPubKey;

type Recipient = types.cloud.SpaceRecipient;
const b64 = (text: string) => Buffer.from(text).toString("base64") as types.core.Base64;

export class SpaceTests extends BaseTestSet {
    
    private bobApi?: ContextApiClient;
    private carolApi?: ContextApiClient;
    private usersAdded = false;
    private received: {type: string, data: Record<string, unknown>}[] = [];
    
    @Test()
    async shouldServeEachRecipientOnlyTheKeysItCanOpen() {
        const groupId = await this.createGroup();
        const spaceId = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}]);
        const mine = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(mine.keyVersion === 1 && !mine.keyIsStale, "a new space is at key version 1 and fresh");
        assert(mine.creator === me && mine.contextId === testData.contextId, "identity mismatch");
        assert(JSON.stringify(mine.groups) === JSON.stringify([{groupId, role: "user", groupKeyVersion: 1}]), `groups mismatch: ${JSON.stringify(mine.groups)}`);
        assert(JSON.stringify(mine.users) === JSON.stringify([{userId: me, pubKey: myPub, role: "manager"}]), "users mismatch");
        // Janek is named and is in the group: both entries are his to open.
        assert(mine.keys.length === 2, `expected both entries, got ${mine.keys.length}`);
        
        // Bob reaches the space through the group alone.
        const bobs = (await (await this.apiOf(bob)).spaceGet({id: spaceId})).space;
        assert(bobs.keys.length === 1 && "groupId" in bobs.keys[0].recipient && bobs.keys[0].recipient.groupId === groupId, "bob is served the group's entry only");
        assert(bobs.keys[0].data === b64(`key1 for g:${groupId}`), "the wrap comes back as it was sent");
        
        const listed = await (await this.apiOf(bob)).spaceList({contextId: testData.contextId, skip: 0, limit: 100, sortOrder: "asc"});
        assert(listed.spaces.some(s => s.id === spaceId), "a member of a recipient group lists the space");
        
        // Somebody in neither list sees nothing.
        const outsider = await this.apiOf(carol, false);
        const hidden = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}]);
        await shouldThrowErrorWithCode2(() => outsider.spaceGet({id: hidden}), "ACCESS_DENIED");
        const carols = await outsider.spaceList({contextId: testData.contextId, skip: 0, limit: 100, sortOrder: "asc"});
        assert(!carols.spaces.some(s => s.id === hidden), "a space lists only for its recipients");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceGet({id: "no-such-space" as types.space.SpaceId}), "SPACE_DOES_NOT_EXIST");
    }
    
    @Test()
    async shouldGoStaleWhenARecipientGroupRemovesAMemberAndFreshOnRotation() {
        const groupId = await this.createGroup();
        const recipients: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}];
        const spaceId = await this.createSpace(recipients);
        await this.listenOn(`context/spaces/update|containerId=${spaceId}`);
        
        await this.removeFromGroup(groupId, [carol]);
        const stale = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(stale.keyIsStale, "removing a member of a recipient group makes the key stale");
        assert(stale.groups[0].groupKeyVersion === 1 && stale.keyVersion === 1, "the space itself has not moved");
        await PromiseUtils.wait(1000);
        assert(this.received.some(e => e.type === "spaceUpdated" && e.data.changeKind === "keyStale" && e.data.spaceId === spaceId), `no keyStale event: ${JSON.stringify(this.received)}`);
        
        // A new key wrapped to the epoch the group has left is refused.
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceRotateKey({
            id: spaceId, keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor(recipients, 2, 1), expectedKeyVersion: 1,
        }), "SPACE_KEYS_INVALID");
        // Any recipient may rotate: bob is only a user of the space.
        const rotated = await (await this.apiOf(bob)).spaceRotateKey({
            id: spaceId, keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor(recipients, 2, 2), expectedKeyVersion: 1,
        });
        assert(rotated.keyVersion === 2, `rotation should give key version 2, got ${rotated.keyVersion}`);
        const fresh = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(!fresh.keyIsStale && fresh.keyVersion === 2 && fresh.keyId === "space-key-2", "the rotation clears the stale mark");
        assert(fresh.groups[0].groupKeyVersion === 2, "the new key is wrapped to the group's new epoch");
        assert(fresh.keys.length === 4, `both versions stay readable, got ${fresh.keys.length} entries`);
        
        // A rotation planned against the old version loses.
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceRotateKey({
            id: spaceId, keyId: "space-key-3" as types.core.KeyId, keys: this.keysFor(recipients, 3, 2), expectedKeyVersion: 1,
        }), "SPACE_VERSION_MISMATCH");
        // A listing serves the current version's entries only.
        const listed = await this.apis.contextApi.spaceList({contextId: testData.contextId, skip: 0, limit: 100, sortOrder: "asc"});
        const entry = listed.spaces.find(s => s.id === spaceId)!;
        assert(entry.keys.length === 2 && entry.keys.every(k => k.keyVersion === 2), "a listing carries the current key version only");
        await PromiseUtils.wait(1000);
        assert(this.received.some(e => e.data.changeKind === "keyRotated" && e.data.keyVersion === 2), "no keyRotated event");
    }
    
    @Test()
    async shouldLetOnlyAManagerChangeRecipientsAndMetadata() {
        const groupId = await this.createGroup();
        const spaceId = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}]);
        const asBob = await this.apiOf(bob);
        const bobDirect: Recipient = {userId: bob, pubKey: bobPub, role: "manager"};
        await shouldThrowErrorWithCode2(() => asBob.spaceAddRecipients({id: spaceId, recipients: [bobDirect], keys: this.keysFor([bobDirect], 1)}), "ACCESS_DENIED");
        await shouldThrowErrorWithCode2(() => asBob.spaceUpdatePublicMeta({id: spaceId, meta: "x", version: 1}), "ACCESS_DENIED");
        await shouldThrowErrorWithCode2(() => asBob.spaceDelete({id: spaceId}), "ACCESS_DENIED");
        
        // Under another key than the context holds for him, bob is not the user meant.
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceAddRecipients({
            id: spaceId, recipients: [{...bobDirect, pubKey: myPub}], keys: this.keysFor([bobDirect], 1),
        }), "USER_DOESNT_EXIST");
        // No entry for the new recipient.
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceAddRecipients({
            id: spaceId, recipients: [bobDirect], keys: this.keysFor([{userId: carol, pubKey: myPub, role: "user"}], 1),
        }), "SPACE_KEYS_INVALID");
        assert(await this.apis.contextApi.spaceAddRecipients({id: spaceId, recipients: [bobDirect], keys: this.keysFor([bobDirect], 1)}) === "OK", "spaceAddRecipients did not return OK");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceAddRecipients({id: spaceId, recipients: [bobDirect], keys: this.keysFor([bobDirect], 1)}), "INVALID_PARAMS");
        
        // Now a manager, bob writes metadata; each plane has its own version.
        assert(await asBob.spaceUpdatePublicMeta({id: spaceId, meta: "public 2", version: 1}) === "OK", "spaceUpdatePublicMeta did not return OK");
        await shouldThrowErrorWithCode2(() => asBob.spaceUpdatePublicMeta({id: spaceId, meta: "late", version: 1}), "SPACE_VERSION_MISMATCH");
        assert(await asBob.spaceUpdatePrivateMeta({id: spaceId, meta: "private 2", version: 1}) === "OK", "spaceUpdatePrivateMeta did not return OK");
        const space = (await asBob.spaceGet({id: spaceId})).space;
        assert(space.publicMeta === "public 2" && space.privateMeta === "private 2", "metadata mismatch");
        assert(space.publicMetaVersion === 2 && space.privateMetaVersion === 2, "each plane moved once");
        assert(space.keys.length === 2, "bob now opens his own entry and the group's");
        
        // Removing the group moves the key on; whoever stays gets the new version, the group nothing.
        const staying: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}, bobDirect];
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceRemoveRecipients({
            id: spaceId, users: [me, bob], keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor([{groupId, role: "user"}], 2, 1), expectedKeyVersion: 1,
        }), "SPACE_LAST_MANAGER");
        const removed = await this.apis.contextApi.spaceRemoveRecipients({
            id: spaceId, groups: [groupId], keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor(staying, 2), expectedKeyVersion: 1,
        });
        assert(removed.keyVersion === 2, "removing a recipient opens a new key version");
        const after = (await asBob.spaceGet({id: spaceId})).space;
        assert(after.groups.length === 0 && after.users.length === 2, "the group is gone from the recipients");
        assert(after.keys.every(k => "userId" in k.recipient) && after.keys.length === 2, "the removed group's entries are gone, bob keeps both versions of his");
        // Carol reached the space through the group only.
        await shouldThrowErrorWithCode2(async () => (await this.apiOf(carol)).spaceGet({id: spaceId}), "ACCESS_DENIED");
        
        // A group named by a space cannot be deleted from under it.
        const held = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}]);
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupDelete({groupId}), "GROUP_IN_USE");
        assert(await this.apis.contextApi.spaceDelete({id: held}) === "OK", "spaceDelete did not return OK");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceGet({id: held}), "SPACE_DOES_NOT_EXIST");
    }
    
    @Test()
    async shouldRefuseASpaceItsCreatorCannotManageOrWhoseIdIsTaken() {
        const groupId = await this.createGroup();
        const resourceId = this.helpers.generateResourceId();
        const mine: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}];
        await shouldThrowErrorWithCode2(() => this.createSpace([{userId: me, pubKey: myPub, role: "user"}, {groupId: groupId, role: "user"}]), "ACCESS_DENIED");
        // Through a manager group the creator manages the space without being named.
        await this.createSpace([{groupId, role: "manager"}]);
        await shouldThrowErrorWithCode2(() => this.createSpace([{groupId: "no-such-group" as types.group.GroupId, role: "manager"}, ...mine]), "GROUP_DOES_NOT_EXIST");
        await shouldThrowErrorWithCode2(() => this.createSpace([...mine, ...mine]), "INVALID_PARAMS");
        await this.createSpace(mine, resourceId);
        await shouldThrowErrorWithCode2(() => this.createSpace(mine, resourceId), "DUPLICATE_RESOURCE_ID");
    }
    
    /** One entry per recipient at `keyVersion`; a group's names `groupEpoch`. The data is a label, not a wrap. */
    private keysFor(recipients: Recipient[], keyVersion: number, groupEpoch = 1): types.cloud.SpaceKeyEntry[] {
        return recipients.map(r => ({
            keyVersion: keyVersion,
            recipient: "groupId" in r ? {groupId: r.groupId, groupKeyVersion: groupEpoch} : {userId: r.userId},
            data: b64(`key${keyVersion} for ${"groupId" in r ? "g:" + r.groupId : "u:" + r.userId}`),
            signature: b64("signature"),
        }));
    }
    
    private async createSpace(recipients: Recipient[], resourceId = this.helpers.generateResourceId()) {
        const res = await this.apis.contextApi.spaceCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            recipients: recipients,
            keyId: "space-key-1" as types.core.KeyId,
            keys: this.keysFor(recipients, 1),
            publicMeta: "public",
            privateMeta: "private",
        });
        return res.spaceId;
    }
    
    private async listenOn(channel: string) {
        this.helpers.addEventListenerForNotification(evt => {
            this.received.push({type: (evt as unknown as {notificationType: string}).notificationType, data: evt.data as Record<string, unknown>});
        });
        await this.helpers.subscribeToChannels([channel]);
    }
    
    private async removeFromGroup(groupId: types.group.GroupId, userIds: types.cloud.UserId[]) {
        const served = (await this.apis.contextApi.groupGet({groupId, scope: "full"})).group;
        const newEpoch = served.keyVersion + 1;
        const groupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;
        const op: PlanOp = {kind: "remove", committer: me, removed: userIds};
        const {plan, commit} = commitAgainst(served as unknown as ServedGroup, op, groupPubKey);
        const keyId = `group-key-${newEpoch}` as types.core.KeyId;
        const res = await this.apis.contextApi.groupRemoveMembers({
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
        });
        assert(res === "OK", "groupRemoveMembers did not return OK");
    }
    
    private async apiOf(userId: types.cloud.UserId, addUsers = true): Promise<ContextApiClient> {
        if (addUsers) {
            await this.addUsers();
        }
        if (userId === bob) {
            return this.bobApi ??= new ContextApiClient(await this.helpers.createNewConnection(bobIdentity.privWif as string, testData.solutionId));
        }
        assert(userId === carol, `the tests hold no key for ${userId}`);
        return this.carolApi ??= new ContextApiClient(await this.helpers.createNewConnection(carolIdentity.privWif as string, testData.solutionId));
    }
    
    private async addUsers() {
        if (this.usersAdded) {
            return;
        }
        this.helpers.authorizePlainApi();
        for (const [userId, userPubKey] of [[bob, bobIdentity.pub58], [carol, carolIdentity.pub58]] as const) {
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
    
    /** janek manages it, bob and carol are its users. */
    private async createGroup(): Promise<types.group.GroupId> {
        await this.addUsers();
        const users = [bob, carol];
        const managers = [me];
        const tree = buildTree(SEATING, 1);
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
            commit: creationStatement(tree, me, {groupId: resourceId, groupPubKey, users, managers}),
        });
        return res.groupId;
    }
}
