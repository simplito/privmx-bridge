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
import type * as elliptic from "elliptic";
import { Crypto } from "../../../utils/crypto/Crypto";
import { SpaceService } from "../../../service/cloud/SpaceService";
import { Roster, SpaceStatement } from "../../../service/cloud/SpaceStatement";
import { LadderMath } from "../../../service/cloud/keytree/LadderMath";
import { signSpaceStatement, UnsignedSpaceStatement } from "../../testUtils/SpaceFixtures";
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

const myKey = ECUtils.fromWIF(testData.userPrivKey as types.core.EccWif)!;
const identities: Record<string, {keyPair: elliptic.ec.KeyPair, pub58: string}> = {
    [me]: {keyPair: myKey, pub58: myPub},
    [bob]: bobIdentity,
    [carol]: carolIdentity,
};

type Recipient = types.cloud.SpaceRecipient;
type Statement = types.cloud.SpaceStatement;
const noDeltas = {addedGroups: [], addedUsers: [], removedGroups: [], removedUsers: [], refreshedGroups: []};
/** What a test changes about the statement `next` would build: before it is signed, or after. */
interface Twist {
    via?: types.group.GroupId|"";
    viaKey?: elliptic.ec.KeyPair;
    signWith?: elliptic.ec.KeyPair;
    unsigned?: (st: UnsignedSpaceStatement) => void;
    signed?: (st: Statement) => void;
}
const b64 = (text: string) => Buffer.from(text).toString("base64") as types.core.Base64;

export class SpaceTests extends BaseTestSet {
    
    private bobApi?: ContextApiClient;
    private carolApi?: ContextApiClient;
    private usersAdded = false;
    private received: {type: string, data: Record<string, unknown>}[] = [];
    /** Every group's identity key by epoch: a member signs `via` with the key the space holds for the group. */
    private groupKeys = new Map<types.group.GroupId, Map<number, elliptic.ec.KeyPair>>();
    
    @Test()
    async shouldServeEachRecipientOnlyTheKeysItCanOpen() {
        const groupId = await this.createGroup();
        const spaceId = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}]);
        const mine = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(mine.keyVersion === 1 && !mine.keyIsStale, "a new space is at key version 1 and fresh");
        assert(mine.creator === me && mine.contextId === testData.contextId, "identity mismatch");
        assert(JSON.stringify(mine.groups) === JSON.stringify([{groupId, role: "user", ...this.head(groupId)}]), `groups mismatch: ${JSON.stringify(mine.groups)}`);
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
        await shouldThrowErrorWithCode2(async () => outsider.spaceGet({id: hidden}), "ACCESS_DENIED");
        const carols = await outsider.spaceList({contextId: testData.contextId, skip: 0, limit: 100, sortOrder: "asc"});
        assert(!carols.spaces.some(s => s.id === hidden), "a space lists only for its recipients");
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceGet({id: "no-such-space" as types.space.SpaceId}), "SPACE_DOES_NOT_EXIST");
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
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceRotateKey({
            id: spaceId, keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor(recipients, 2, 1), rungs: this.rungsOf(2), expectedKeyVersion: 1,
            statement: await this.next(spaceId, "rotate", me),
        }), "SPACE_KEYS_INVALID");
        // Any recipient may rotate: bob is only a user of the space.
        const rotated = await (await this.apiOf(bob)).spaceRotateKey({
            id: spaceId, keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor(recipients, 2, 2), rungs: this.rungsOf(2), expectedKeyVersion: 1,
            statement: await this.next(spaceId, "rotate", bob),
        });
        assert(rotated.keyVersion === 2, `rotation should give key version 2, got ${rotated.keyVersion}`);
        const fresh = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(!fresh.keyIsStale && fresh.keyVersion === 2 && fresh.keyId === "space-key-2", "the rotation clears the stale mark");
        assert(fresh.groups[0].groupKeyVersion === 2, "the new key is wrapped to the group's new epoch");
        assert(fresh.keys.length === 2 && fresh.keys.every(k => k.keyVersion === 2), `only the current version is wrapped, got ${fresh.keys.length} entries`);
        const archive = await (await this.apiOf(bob)).spaceGetKeyArchive({id: spaceId});
        assert(JSON.stringify(archive.rungs) === JSON.stringify(this.rungsOf(2)) && archive.nextKeyVersion === undefined, `version 1 is reached down the rung: ${JSON.stringify(archive)}`);
        // Bob is no manager: the bridge cannot check his rungs, so his rotation keeps the older wraps.
        assert(archive.keys.map(k => `${k.keyVersion}:${"groupId" in k.recipient ? "g" : "u"}`).join() === "1:g,2:g", `bob keeps his group's wraps of both versions: ${JSON.stringify(archive.keys)}`);
        assert((await this.apis.contextApi.spaceGetKeyArchive({id: spaceId})).keys.length === 4, "janek's own and his group's wraps of both versions");
        
        // A rotation planned against the old version loses.
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceRotateKey({
            id: spaceId, keyId: "space-key-3" as types.core.KeyId, keys: this.keysFor(recipients, 3, 2), rungs: this.rungsOf(3), expectedKeyVersion: 1,
            statement: await this.next(spaceId, "rotate", me),
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
        const addBob = async (as = me) => this.next(spaceId, "add", as, {add: [bobDirect]});
        await shouldThrowErrorWithCode2(async () => asBob.spaceAddRecipients({id: spaceId, recipients: [bobDirect], keys: this.keysFor([bobDirect], 1), statement: await addBob(bob)}), "ACCESS_DENIED");
        await shouldThrowErrorWithCode2(async () => asBob.spaceUpdatePublicMeta({id: spaceId, meta: "x", version: 1}), "ACCESS_DENIED");
        await shouldThrowErrorWithCode2(async () => asBob.spaceDelete({id: spaceId}), "ACCESS_DENIED");
        
        // Under another key than the context holds for him, bob is not the user meant.
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceAddRecipients({
            id: spaceId, recipients: [{...bobDirect, pubKey: myPub}], keys: this.keysFor([bobDirect], 1), statement: await addBob(),
        }), "USER_DOESNT_EXIST");
        // No entry for the new recipient.
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceAddRecipients({
            id: spaceId, recipients: [bobDirect], keys: this.keysFor([{userId: carol, pubKey: myPub, role: "user"}], 1), statement: await addBob(),
        }), "SPACE_KEYS_INVALID");
        assert(await this.apis.contextApi.spaceAddRecipients({id: spaceId, recipients: [bobDirect], keys: this.keysFor([bobDirect], 1), statement: await addBob()}) === "OK", "spaceAddRecipients did not return OK");
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceAddRecipients({
            id: spaceId, recipients: [bobDirect], keys: this.keysFor([bobDirect], 1), statement: await this.next(spaceId, "rotate", me),
        }), "INVALID_PARAMS");
        
        // Now a manager, bob writes metadata; each plane has its own version.
        assert(await asBob.spaceUpdatePublicMeta({id: spaceId, meta: "public 2", version: 1}) === "OK", "spaceUpdatePublicMeta did not return OK");
        await shouldThrowErrorWithCode2(async () => asBob.spaceUpdatePublicMeta({id: spaceId, meta: "late", version: 1}), "SPACE_VERSION_MISMATCH");
        assert(await asBob.spaceUpdatePrivateMeta({id: spaceId, meta: "private 2", version: 1}) === "OK", "spaceUpdatePrivateMeta did not return OK");
        const space = (await asBob.spaceGet({id: spaceId})).space;
        assert(space.publicMeta === "public 2" && space.privateMeta === "private 2", "metadata mismatch");
        assert(space.publicMetaVersion === 2 && space.privateMetaVersion === 2, "each plane moved once");
        assert(space.keys.length === 2, "bob now opens his own entry and the group's");
        
        // Removing the group moves the key on; whoever stays gets the new version, the group nothing.
        const staying: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}, bobDirect];
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceRemoveRecipients({
            id: spaceId, users: [me, bob], keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor([{groupId, role: "user"}], 2, 1), rungs: this.rungsOf(2), expectedKeyVersion: 1,
            statement: await this.next(spaceId, "remove", me, {removeUsers: [me, bob]}),
        }), "SPACE_LAST_MANAGER");
        const removed = await this.apis.contextApi.spaceRemoveRecipients({
            id: spaceId, groups: [groupId], keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor(staying, 2), rungs: this.rungsOf(2), expectedKeyVersion: 1,
            statement: await this.next(spaceId, "remove", me, {removeGroups: [groupId]}),
        });
        assert(removed.keyVersion === 2, "removing a recipient opens a new key version");
        const after = (await asBob.spaceGet({id: spaceId})).space;
        assert(after.groups.length === 0 && after.users.length === 2, "the group is gone from the recipients");
        assert(after.keys.length === 1 && "userId" in after.keys[0].recipient && after.keys[0].keyVersion === 2, "the removed group's entries are gone, bob keeps the current version of his");
        // Carol reached the space through the group only.
        await shouldThrowErrorWithCode2(async () => (await this.apiOf(carol)).spaceGet({id: spaceId}), "ACCESS_DENIED");
        
        // A group named by a space cannot be deleted from under it.
        const held = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}]);
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.groupDelete({groupId}), "GROUP_IN_USE");
        assert(await this.apis.contextApi.spaceDelete({id: held}) === "OK", "spaceDelete did not return OK");
        await shouldThrowErrorWithCode2(async () => this.apis.contextApi.spaceGet({id: held}), "SPACE_DOES_NOT_EXIST");
    }
    
    @Test()
    async shouldRefuseASpaceItsCreatorCannotManageOrWhoseIdIsTaken() {
        const groupId = await this.createGroup();
        const resourceId = this.helpers.generateResourceId();
        const mine: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}];
        await shouldThrowErrorWithCode2(async () => this.createSpace([{userId: me, pubKey: myPub, role: "user"}, {groupId: groupId, role: "user"}]), "ACCESS_DENIED");
        // Through a manager group the creator manages the space without being named.
        await this.createSpace([{groupId, role: "manager"}]);
        await shouldThrowErrorWithCode2(async () => this.createSpace([{groupId: "no-such-group" as types.group.GroupId, role: "manager"}, ...mine]), "GROUP_DOES_NOT_EXIST");
        await shouldThrowErrorWithCode2(async () => this.createSpace([...mine, ...mine]), "INVALID_PARAMS");
        await this.createSpace(mine, resourceId);
        await shouldThrowErrorWithCode2(async () => this.createSpace(mine, resourceId), "DUPLICATE_RESOURCE_ID");
    }
    
    @Test()
    async shouldTakeACreationStatementOnlyFromItsSignerInAStandingItHas() {
        const groupId = await this.createGroup();
        const elsewhere = await this.createGroup();
        const named: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "manager"}];
        const refused = (twist: Twist, recipients = named, code = "SPACE_STATEMENT_INVALID", as = me) =>
            shouldThrowErrorWithCode2(() => this.createSpace(recipients, this.helpers.generateResourceId(), twist, as), code as never);
        
        // Somebody else's name, or the caller's name over another key's signature.
        await refused({unsigned: st => {
            st.signer = bob;
            st.signerPubKey = bobPub;
        }});
        await refused({signWith: bobIdentity.keyPair});
        await refused({signed: st => {
            st.date++;
        }});
        // Not the first statement of a history, or not a creation, or not the first key.
        await refused({unsigned: st => {
            st.seq = 2;
        }}, named, "SPACE_VERSION_MISMATCH");
        await refused({unsigned: st => {
            st.prevDigest = "11".repeat(32);
        }});
        await refused({unsigned: st => {
            st.op = "rotate";
        }});
        await refused({unsigned: st => {
            st.keyVersion = 2;
        }});
        await refused({unsigned: st => {
            st.spaceId = "another-space" as types.space.SpaceId;
        }});
        // Recipients other than the call's: a role, a missing one, a group at a key it does not have, one twice.
        await refused({unsigned: st => {
            st.addedUsers[0].role = "user";
        }});
        await refused({unsigned: st => {
            st.addedGroups = [];
        }});
        await refused({unsigned: st => {
            st.addedGroups[0].groupPubKey = myPub as unknown as types.cloud.GroupPubKey;
        }});
        await refused({unsigned: st => {
            st.addedGroups[0].groupKeyVersion = 2;
        }});
        await refused({unsigned: st => {
            st.addedUsers.push({...st.addedUsers[0]});
        }});
        // A creation only adds; and the hash has to be the roster's.
        await refused({unsigned: st => {
            st.removedUsers = [bob];
        }});
        await refused({unsigned: st => {
            st.rosterHash = "00".repeat(32);
        }});
        
        // The standing: a group that is no recipient, the right group under a key that is not its own, a
        // signature of a group with no group named, and "as a named user" from somebody the space does not name.
        await refused({via: elsewhere});
        await refused({via: groupId, viaKey: myKey});
        await refused({signed: st => {
            st.viaSignature = st.signature;
        }});
        await refused({via: ""}, [{groupId, role: "manager"}]);
        // Carol left the group and kept its key: the bridge knows she is no member.
        const groupKey = this.groupKeys.get(elsewhere)!.get(1)!;
        await this.removeFromGroup(elsewhere, [carol]);
        await refused({via: elsewhere, viaKey: groupKey}, [{groupId: elsewhere, role: "manager"}, {userId: carol, pubKey: carolIdentity.pub58 as types.cloud.UserPubKey, role: "manager"}], "SPACE_STATEMENT_INVALID", carol);
        
        // Through the group, with the group's key, janek creates a space that does not name him.
        const spaceId = await this.createSpace([{groupId, role: "manager"}]);
        const space = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(space.seq === 1 && space.statement.via === groupId && space.statement.viaSignature !== "", "the creation is signed through the group");
        assert(space.groups[0].groupPubKey === space.statement.addedGroups[0].groupPubKey, "the space serves the group key the statement names");
    }
    
    @Test()
    async shouldChainEveryChangeToTheStatementBeforeItAndServeTheHistory() {
        const groupId = await this.createGroup();
        const recipients: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}];
        const spaceId = await this.createSpace(recipients);
        const asBob = await this.apiOf(bob);
        const bobDirect: Recipient = {userId: bob, pubKey: bobPub, role: "user"};
        const rotate = (statement: Statement, api = this.apis.contextApi) => api.spaceRotateKey({
            id: spaceId, keyId: "space-key-2" as types.core.KeyId, keys: this.keysFor(recipients, 2), rungs: this.rungsOf(2), expectedKeyVersion: 1, statement,
        });
        const refused = async (twist: Twist, code = "SPACE_STATEMENT_INVALID") =>
            shouldThrowErrorWithCode2(async () => rotate(await this.next(spaceId, "rotate", me, {}, twist)), code as never);
        
        await refused({unsigned: st => {
            st.prevDigest = "11".repeat(32);
        }});
        await refused({unsigned: st => {
            st.prevDigest = "";
        }});
        await refused({unsigned: st => {
            st.seq++;
        }}, "SPACE_VERSION_MISMATCH");
        await refused({unsigned: st => {
            st.keyVersion = 1;
        }});
        await refused({unsigned: st => {
            st.op = "remove";
        }});
        // A rotation only refreshes groups, each to a newer epoch, and binds the roster it leaves.
        await refused({unsigned: st => {
            st.refreshedGroups.push({groupId, ...this.head(groupId)});
        }});
        await refused({unsigned: st => {
            st.removedUsers.push(me);
        }});
        await refused({unsigned: st => {
            st.addedUsers.push({...bobDirect, pubKey: bobPub});
        }});
        await refused({unsigned: st => {
            st.rosterHash = "00".repeat(32);
        }});
        // Bob holds the group's key and is named nowhere: his standing is the group's, said and signed.
        await shouldThrowErrorWithCode2(async () => rotate(await this.next(spaceId, "rotate", bob, {}, {via: ""}), asBob), "SPACE_STATEMENT_INVALID");
        await shouldThrowErrorWithCode2(async () => rotate(await this.next(spaceId, "rotate", bob, {}, {viaKey: bobIdentity.keyPair}), asBob), "SPACE_STATEMENT_INVALID");
        // Janek's statement sent by bob is not bob's.
        await shouldThrowErrorWithCode2(async () => rotate(await this.next(spaceId, "rotate", me), asBob), "SPACE_STATEMENT_INVALID");
        assert((await rotate(await this.next(spaceId, "rotate", bob), asBob)).keyVersion === 2, "bob rotates through the group");
        // The same statement a second time is a statement for a seq that is taken.
        const stale = (await this.apis.contextApi.spaceGet({id: spaceId})).space.statement;
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceRotateKey({
            id: spaceId, keyId: "space-key-3" as types.core.KeyId, keys: this.keysFor(recipients, 3), rungs: this.rungsOf(3), expectedKeyVersion: 2, statement: stale,
        }), "SPACE_VERSION_MISMATCH");
        
        // An addition keeps the key, and every recipient before it as it was.
        const add = (statement: Statement, keys = this.keysFor([bobDirect], 2)) => this.apis.contextApi.spaceAddRecipients({
            id: spaceId, recipients: [bobDirect], keys, statement,
        });
        // A newcomer gets the current version only; older ones it reaches down the rungs.
        await shouldThrowErrorWithCode2(async () => add(await this.next(spaceId, "add", me, {add: [bobDirect]}), [...this.keysFor([bobDirect], 1), ...this.keysFor([bobDirect], 2)]), "SPACE_KEYS_INVALID");
        await shouldThrowErrorWithCode2(async () => add(await this.next(spaceId, "add", me, {add: [bobDirect]}), this.keysFor([bobDirect], 1)), "SPACE_KEYS_INVALID");
        await shouldThrowErrorWithCode2(async () => add(await this.next(spaceId, "add", me, {add: [bobDirect]}, {unsigned: st => {
            st.keyCommit = this.commit();
        }})), "SPACE_STATEMENT_INVALID");
        await shouldThrowErrorWithCode2(async () => add(await this.next(spaceId, "add", me, {add: [bobDirect]}, {unsigned: st => {
            st.addedUsers[0].role = "manager";
        }})), "SPACE_STATEMENT_INVALID");
        // Adding somebody already there, or nobody.
        await shouldThrowErrorWithCode2(async () => add(await this.next(spaceId, "add", me, {add: [bobDirect]}, {unsigned: st => {
            st.addedUsers.push({userId: me, pubKey: myPub, role: "manager"});
        }})), "SPACE_STATEMENT_INVALID");
        await shouldThrowErrorWithCode2(async () => add(await this.next(spaceId, "add", me, {add: [bobDirect]}, {unsigned: st => {
            st.addedUsers = [];
        }})), "SPACE_STATEMENT_INVALID");
        await shouldThrowErrorWithCode2(async () => add(await this.next(spaceId, "add", me, {add: [bobDirect]}, {unsigned: st => {
            st.keyVersion++;
        }})), "SPACE_STATEMENT_INVALID");
        assert(await add(await this.next(spaceId, "add", me, {add: [bobDirect]})) === "OK", "spaceAddRecipients did not return OK");
        
        // The history, oldest first, each statement naming the one before; the space serves the last.
        const {statements} = await asBob.spaceGetStatements({id: spaceId, fromSeq: 0, limit: 100});
        assert(statements.map(st => `${st.seq}:${st.op}:${st.signer}`).join() === `1:create:${me},2:rotate:${bob},3:add:${me}`, `history mismatch: ${statements.map(st => `${st.seq}:${st.op}:${st.signer}`).join()}`);
        assert(statements[0].prevDigest === "" && statements[1].prevDigest === SpaceStatement.digest(statements[0]) && statements[2].prevDigest === SpaceStatement.digest(statements[1]), "the statements do not chain");
        assert(statements.every(st => SpaceStatement.verifySignature(st)), "a served statement does not verify");
        assert(statements[1].via === groupId && SpaceStatement.verifyViaSignature(statements[1], statements[0].addedGroups[0].groupPubKey), "bob's statement is signed by the group's key as the statement before held it");
        assert(statements[2].keyCommit === statements[1].keyCommit && statements[1].keyCommit !== statements[0].keyCommit, "a rotation commits to a new key, an addition to the same");
        const space = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(space.seq === 3 && JSON.stringify(space.statement) === JSON.stringify(statements[2]), "the space serves its last statement");
        assert(SpaceStatement.rosterHash(space).toString("hex") === space.statement.rosterHash, "the recipients served are the ones the last statement binds");
        const page = await this.apis.contextApi.spaceGetStatements({id: spaceId, fromSeq: 1, limit: 1});
        assert(page.statements.length === 1 && page.statements[0].seq === 2, "paging starts after fromSeq");
        assert((await this.apis.contextApi.spaceGetStatements({id: spaceId, fromSeq: 3, limit: 10})).statements.length === 0, "nothing after the last");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceGetStatements({id: spaceId, fromSeq: 0, limit: 101}), "INVALID_PARAMS");
        
        // Only a recipient reads the history, and it goes with the space.
        const hidden = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}]);
        await shouldThrowErrorWithCode2(() => asBob.spaceGetStatements({id: hidden, fromSeq: 0, limit: 10}), "ACCESS_DENIED");
        assert(await this.apis.contextApi.spaceDelete({id: hidden}) === "OK", "spaceDelete did not return OK");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.spaceGetStatements({id: hidden, fromSeq: 0, limit: 10}), "SPACE_DOES_NOT_EXIST");
    }
    
    @Test()
    async shouldTakeOnlyTheCanonicalRungsAndServeThemAPageOfVersionsAtATime() {
        const groupId = await this.createGroup();
        const recipients: Recipient[] = [{userId: me, pubKey: myPub, role: "manager"}, {groupId, role: "user"}];
        const spaceId = await this.createSpace(recipients);
        const rotate = async (keyVersion: number, rungs: types.cloud.SpaceRung[]) => this.apis.contextApi.spaceRotateKey({
            id: spaceId, keyId: `space-key-${keyVersion}` as types.core.KeyId, keys: this.keysFor(recipients, keyVersion), rungs, expectedKeyVersion: keyVersion - 1,
            statement: await this.next(spaceId, "rotate", me),
        });
        const rung = (at: number, target: number) => ({atKeyVersion: at, targetKeyVersion: target, data: b64(`rung ${at}->${target}`)});
        
        // Version 2 owes the rung to 1, nothing else and nothing at another version.
        await shouldThrowErrorWithCode2(() => rotate(2, []), "SPACE_KEYS_INVALID");
        await shouldThrowErrorWithCode2(() => rotate(2, [rung(3, 2)]), "SPACE_KEYS_INVALID");
        await shouldThrowErrorWithCode2(() => rotate(2, [rung(2, 1), rung(2, 1)]), "SPACE_KEYS_INVALID");
        assert((await rotate(2, this.rungsOf(2))).keyVersion === 2, "rotation to 2");
        assert((await rotate(3, this.rungsOf(3))).keyVersion === 3, "rotation to 3");
        // Version 4 owes the rungs to 3 and to 2: one missing, or one more, is refused.
        await shouldThrowErrorWithCode2(() => rotate(4, [rung(4, 3)]), "SPACE_KEYS_INVALID");
        await shouldThrowErrorWithCode2(() => rotate(4, [rung(4, 3), rung(4, 2), rung(4, 1)]), "SPACE_KEYS_INVALID");
        assert((await rotate(4, this.rungsOf(4))).keyVersion === 4, "rotation to 4");
        
        // A manager's rotation prunes the older versions' wraps: a reader descends from the current one.
        const space = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        assert(space.keys.length === 2 && space.keys.every(k => k.keyVersion === 4), `only version 4 is wrapped: ${JSON.stringify(space.keys)}`);
        const mine = await this.apis.contextApi.spaceGetKeyArchive({id: spaceId});
        assert(mine.keys.length === 2 && mine.keys.every(k => k.keyVersion === 4), `the older wraps are gone: ${JSON.stringify(mine.keys)}`);
        const asBob = await this.apiOf(bob);
        const all = await asBob.spaceGetKeyArchive({id: spaceId});
        assert(all.keys.length === 1 && "groupId" in all.keys[0].recipient && all.keys[0].keyVersion === 4, `bob gets his group's wrap only: ${JSON.stringify(all.keys)}`);
        const spans = (rungs: types.cloud.SpaceRung[]) => rungs.map(r => `${r.atKeyVersion}->${r.targetKeyVersion}`).join();
        assert(spans(all.rungs) === "2->1,3->2,4->2,4->3" && all.nextKeyVersion === undefined, `the whole ladder: ${spans(all.rungs)}`);
        assert(all.rungs.every(r => r.data === rung(r.atKeyVersion, r.targetKeyVersion).data), "a rung comes back as it was sent");
        const first = await asBob.spaceGetKeyArchive({id: spaceId, limit: 2});
        assert(spans(first.rungs) === "2->1" && first.nextKeyVersion === 3 && first.keys.length === 0, `first page: ${JSON.stringify(first)}`);
        const rest = await asBob.spaceGetKeyArchive({id: spaceId, fromKeyVersion: first.nextKeyVersion, limit: 2});
        assert(spans(rest.rungs) === "3->2,4->2,4->3" && rest.nextKeyVersion === undefined, `second page: ${JSON.stringify(rest)}`);
        const window = await asBob.spaceGetKeyArchive({id: spaceId, fromKeyVersion: 3, toKeyVersion: 3});
        assert(spans(window.rungs) === "3->2" && window.nextKeyVersion === undefined, `closed window: ${JSON.stringify(window)}`);
        
        // Only a recipient reads the ladder, and it goes with the space.
        const hidden = await this.createSpace([{userId: me, pubKey: myPub, role: "manager"}]);
        await shouldThrowErrorWithCode2(() => asBob.spaceGetKeyArchive({id: hidden}), "ACCESS_DENIED");
        assert(await this.apis.contextApi.spaceDelete({id: spaceId}) === "OK", "spaceDelete did not return OK");
        await shouldThrowErrorWithCode2(() => asBob.spaceGetKeyArchive({id: spaceId}), "SPACE_DOES_NOT_EXIST");
    }
    
    /** The canonical rungs of `keyVersion` (`LadderMath.rungSpansFor(keyVersion, 1)`); the data is a label, not a sealed key. */
    private rungsOf(keyVersion: number): types.cloud.SpaceRung[] {
        return LadderMath.rungSpansFor(keyVersion, 1).map(span => ({atKeyVersion: span.at, targetKeyVersion: span.target, data: b64(`rung ${span.at}->${span.target}`)}))
            .sort((a, b) => a.targetKeyVersion - b.targetKeyVersion);
    }
    
    /** One entry per recipient at `keyVersion`; a group's names `groupEpoch`, or the epoch the group is at. The data is a label, not a wrap. */
    private keysFor(recipients: Recipient[], keyVersion: number, groupEpoch?: number): types.cloud.SpaceKeyEntry[] {
        return recipients.map(r => ({
            keyVersion: keyVersion,
            recipient: "groupId" in r ? {groupId: r.groupId, groupKeyVersion: groupEpoch ?? this.head(r.groupId).groupKeyVersion} : {userId: r.userId},
            data: b64(`key${keyVersion} for ${"groupId" in r ? "g:" + r.groupId : "u:" + r.userId}`),
            signature: b64("signature"),
        }));
    }
    
    private async createSpace(recipients: Recipient[], resourceId = this.helpers.generateResourceId(), twist: Twist = {}, as = me) {
        const api = as === me ? this.apis.contextApi : await this.apiOf(as);
        const roster = this.stateOf(recipients);
        const res = await api.spaceCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            recipients: recipients,
            keyId: "space-key-1" as types.core.KeyId,
            keys: this.keysFor(recipients, 1),
            publicMeta: "public",
            privateMeta: "private",
            statement: this.sign({
                spaceId: SpaceService.spaceId(testData.contextId, resourceId), contextId: testData.contextId, seq: 1, prevDigest: "", op: "create",
                date: Date.now(), keyVersion: 1, keyCommit: this.commit(), ...noDeltas, addedGroups: roster.groups, addedUsers: roster.users,
                rosterHash: SpaceStatement.rosterHash(roster).toString("hex"), signer: as, signerPubKey: identities[as].pub58 as types.cloud.UserPubKey, via: "",
            }, twist, roster),
        });
        return res.spaceId;
    }
    
    private commit() {
        return Crypto.randomBytes(32).toString("hex");
    }
    
    private head(groupId: types.group.GroupId) {
        const epochs = this.groupKeys.get(groupId);
        const epoch = epochs ? Math.max(...epochs.keys()) : 1;
        // A group the tests never made: any well-formed key will do, the call is refused before the statement is read.
        return {groupKeyVersion: epoch, groupPubKey: (epochs ? ECUtils.publicToBase58DER(epochs.get(epoch)!) : myPub) as unknown as types.cloud.GroupPubKey};
    }
    
    /** Recipients as a statement names them: each group at the epoch and key it is at now. */
    private stateOf(recipients: Recipient[]): Roster {
        return {
            groups: recipients.flatMap(r => "groupId" in r ? [{groupId: r.groupId, role: r.role, ...this.head(r.groupId)}] : []),
            users: recipients.flatMap(r => "userId" in r ? [{userId: r.userId, pubKey: r.pubKey, role: r.role}] : []),
        };
    }
    
    /**
     * Signs as the statement's signer. Without a `via` given: as a user the state names when the signer is one,
     * else through the first group of `standing` - with the key that state holds for the group.
     */
    private sign(unsigned: UnsignedSpaceStatement, twist: Twist, standing: Roster) {
        const named = standing.users.some(u => u.userId === unsigned.signer);
        unsigned.via = twist.via ?? (named ? "" : standing.groups[0]?.groupId ?? "");
        twist.unsigned?.(unsigned);
        const through = standing.groups.find(g => g.groupId === unsigned.via);
        const viaKey = twist.viaKey ?? (through ? this.groupKeys.get(through.groupId)?.get(through.groupKeyVersion) : undefined);
        const statement = signSpaceStatement(unsigned, twist.signWith ?? identities[unsigned.signer].keyPair, unsigned.via === "" ? undefined : viaKey ?? myKey);
        twist.signed?.(statement);
        return statement;
    }
    
    /** The statement `as` would send next for the space, read off its current state as janek sees it. */
    private async next(
        spaceId: types.space.SpaceId, op: types.cloud.SpaceStatementOp, as: types.cloud.UserId,
        change: {add?: Recipient[], removeGroups?: types.group.GroupId[], removeUsers?: types.cloud.UserId[]} = {}, twist: Twist = {},
    ): Promise<Statement> {
        const prior = (await this.apis.contextApi.spaceGet({id: spaceId})).space;
        const added = this.stateOf(change.add || []);
        // An addition leaves the recipients before it as they are; a new key is wrapped to each group's current epoch.
        const groups = op === "add"
            ? [...prior.groups, ...added.groups]
            : prior.groups.filter(g => !(change.removeGroups || []).includes(g.groupId)).map(g => ({...g, ...this.head(g.groupId)}));
        const users = [...prior.users.filter(u => !(change.removeUsers || []).includes(u.userId)), ...added.users];
        // The deltas that lead there: a group moved past the epoch the space held it at is refreshed.
        const refreshedGroups = op === "add" ? [] : groups.filter(g => prior.groups.some(p => p.groupId === g.groupId && p.groupKeyVersion < g.groupKeyVersion))
            .map(g => ({groupId: g.groupId, groupKeyVersion: g.groupKeyVersion, groupPubKey: g.groupPubKey}));
        return this.sign({
            spaceId, contextId: testData.contextId, seq: prior.seq + 1, prevDigest: SpaceStatement.digest(prior.statement), op,
            date: Date.now(), keyVersion: op === "add" ? prior.keyVersion : prior.keyVersion + 1,
            keyCommit: op === "add" ? prior.statement.keyCommit : this.commit(),
            addedGroups: added.groups, addedUsers: added.users, removedGroups: change.removeGroups || [], removedUsers: change.removeUsers || [], refreshedGroups,
            rosterHash: SpaceStatement.rosterHash({groups, users}).toString("hex"),
            signer: as, signerPubKey: identities[as].pub58 as types.cloud.UserPubKey, via: "",
        }, twist, prior);
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
        const groupKey = ECUtils.generateKeyPair();
        this.groupKeys.get(groupId)!.set(newEpoch, groupKey.keyPair);
        const groupPubKey = groupKey.pub58 as unknown as types.cloud.GroupPubKey;
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
        const groupKey = ECUtils.generateKeyPair();
        const groupPubKey = groupKey.pub58 as unknown as types.cloud.GroupPubKey;
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
        this.groupKeys.set(res.groupId, new Map([[1, groupKey.keyPair]]));
        return res.groupId;
    }
}
