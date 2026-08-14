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

/**
 * BR-31/BR-36 — the item-write epoch gate on containers with `forwardSecrecy: "yes"`.
 *
 * For each container kind: a write passes, the group's epoch advances, the write is refused
 * (`CONTAINER_GROUP_EPOCH_OUTDATED`), the container is re-keyed to the new epoch, and the write passes again —
 * **twice in a row**. BR-36 was exactly the missing second half: because the gate looked at *every* stored key
 * entry and re-keying keeps the historical ones (which is what keeps pre-rotation content readable), one epoch
 * bump made the container unwritable for good.
 *
 * The epoch is advanced with `groupGenerateNewKey`, which is the same `keyVersion` CAS bump that a member
 * removal performs — the bridge-side trigger the endpoint's `GroupKeyTreeTest` hits via `removeGroupMember`.
 */

const groupKeyIds = ["group-key-0", "group-key-1", "group-key-2"].map(k => k as types.core.KeyId);
const groupPubKeys = groupKeyIds.map(() => ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey);

const groupData = "AAAA" as types.group.GroupData;
const userKeyData = "AAAA" as types.core.UserKeyData;
const groupWrappedKeyData = "CCCC" as types.core.UserKeyData;
const forwardSecrecyPolicy: types.cloud.ContainerPolicy = {forwardSecrecy: "yes"};

export class ContainerGroupEpochTests extends BaseTestSet {
    
    private groupId?: types.group.GroupId;
    
    @Test()
    async shouldKeepThreadWritableAfterEveryGroupEpochBump() {
        const groupId = await this.createGroupGrantee();
        const keyIds = ["thread-key-0", "thread-key-1", "thread-key-2"].map(k => k as types.core.KeyId);
        const {threadId} = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: keyIds[0],
            keys: [{user: testData.userId, keyId: keyIds[0], data: userKeyData}],
            users: [testData.userId],
            managers: [testData.userId],
            policy: forwardSecrecyPolicy,
            groups: [{groupId, role: "user"}],
            groupKeys: [{group: groupId, groupEpoch: 0, keyId: keyIds[0], data: groupWrappedKeyData}],
        });
        
        const send = (keyId: types.core.KeyId, text: string) => this.apis.threadApi.threadMessageSend({
            threadId,
            data: text as types.thread.ThreadMessageData,
            keyId,
        });
        
        await send(keyIds[0], "written-at-epoch-0");
        
        for (const epoch of [1, 2]) {
            await this.bumpGroupEpoch(epoch);
            await shouldThrowErrorWithCode2(() => send(keyIds[epoch - 1], `stale-at-epoch-${epoch}`), "CONTAINER_GROUP_EPOCH_OUTDATED");
            const {thread} = await this.apis.threadApi.threadGet({threadId});
            await this.apis.threadApi.threadRotateKeys({
                id: threadId,
                keyId: keyIds[epoch],
                keys: [{user: testData.userId, keyId: keyIds[epoch], data: userKeyData}],
                groupKeys: [{group: groupId, groupEpoch: epoch, keyId: keyIds[epoch], data: groupWrappedKeyData}],
                version: thread.version,
                force: false,
            });
            await send(keyIds[epoch], `written-at-epoch-${epoch}`);
        }
        
        const {thread, messages} = await this.apis.threadApi.threadMessagesGet({threadId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(messages.length === 3, `every epoch's message should be stored, got ${messages.length}`);
        // Pre-rotation content stays readable: its key entries are still wrapped to the epochs it was written in.
        this.assertKeyIdsWrappedForGroup(thread.groupKeys, groupId, keyIds);
    }
    
    @Test()
    async shouldKeepStoreWritableAfterEveryGroupEpochBump() {
        const groupId = await this.createGroupGrantee();
        const keyIds = ["store-key-0", "store-key-1", "store-key-2"].map(k => k as types.core.KeyId);
        const {storeId} = await this.apis.storeApi.storeCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.store.StoreData,
            keyId: keyIds[0],
            keys: [{user: testData.userId, keyId: keyIds[0], data: userKeyData}],
            users: [testData.userId],
            managers: [testData.userId],
            policy: forwardSecrecyPolicy,
            groups: [{groupId, role: "user"}],
            groupKeys: [{group: groupId, groupEpoch: 0, keyId: keyIds[0], data: groupWrappedKeyData}],
        });
        
        const firstFileId = await this.createFile(storeId, keyIds[0]);
        
        for (const epoch of [1, 2]) {
            await this.bumpGroupEpoch(epoch);
            await shouldThrowErrorWithCode2(() => this.createFile(storeId, keyIds[epoch - 1]), "CONTAINER_GROUP_EPOCH_OUTDATED");
            const {store} = await this.apis.storeApi.storeGet({storeId});
            await this.apis.storeApi.storeUpdate({
                id: storeId,
                data: "AAAA" as types.store.StoreData,
                keyId: keyIds[epoch],
                keys: [{user: testData.userId, keyId: keyIds[epoch], data: userKeyData}],
                users: [testData.userId],
                managers: [testData.userId],
                groups: [{groupId, role: "user"}],
                groupKeys: [{group: groupId, groupEpoch: epoch, keyId: keyIds[epoch], data: groupWrappedKeyData}],
                version: store.version,
                force: false,
            });
            await this.createFile(storeId, keyIds[epoch]);
        }
        
        const {file, store} = await this.apis.storeApi.storeFileGet({fileId: firstFileId});
        assert(file.keyId === keyIds[0], "the file written before the rotations should still report its original keyId");
        this.assertKeyIdsWrappedForGroup(store.groupKeys, groupId, keyIds);
    }
    
    @Test()
    async shouldKeepKvdbWritableAfterEveryGroupEpochBump() {
        const groupId = await this.createGroupGrantee();
        const keyIds = ["kvdb-key-0", "kvdb-key-1", "kvdb-key-2"].map(k => k as types.core.KeyId);
        const {kvdbId} = await this.apis.kvdbApi.kvdbCreate({
            contextId: testData.contextId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA" as types.kvdb.KvdbData,
            keyId: keyIds[0],
            keys: [{user: testData.userId, keyId: keyIds[0], data: userKeyData}],
            users: [testData.userId],
            managers: [testData.userId],
            policy: forwardSecrecyPolicy,
            groups: [{groupId, role: "user"}],
            groupKeys: [{group: groupId, groupEpoch: 0, keyId: keyIds[0], data: groupWrappedKeyData}],
        });
        
        const setEntry = (epoch: number, keyId: types.core.KeyId) => this.apis.kvdbApi.kvdbEntrySet({
            kvdbId,
            kvdbEntryKey: `entry-at-epoch-${epoch}` as types.kvdb.KvdbEntryKey,
            kvdbEntryValue: "AAAA" as types.kvdb.KvdbEntryValue,
            keyId,
            version: 0 as types.kvdb.KvdbEntryVersion,
        });
        
        await setEntry(0, keyIds[0]);
        
        for (const epoch of [1, 2]) {
            await this.bumpGroupEpoch(epoch);
            await shouldThrowErrorWithCode2(() => setEntry(epoch, keyIds[epoch - 1]), "CONTAINER_GROUP_EPOCH_OUTDATED");
            const {kvdb} = await this.apis.kvdbApi.kvdbGet({kvdbId});
            await this.apis.kvdbApi.kvdbUpdate({
                id: kvdbId,
                resourceId: kvdb.resourceId,
                data: "AAAA" as types.kvdb.KvdbData,
                keyId: keyIds[epoch],
                keys: [{user: testData.userId, keyId: keyIds[epoch], data: userKeyData}],
                users: [testData.userId],
                managers: [testData.userId],
                groups: [{groupId, role: "user"}],
                groupKeys: [{group: groupId, groupEpoch: epoch, keyId: keyIds[epoch], data: groupWrappedKeyData}],
                version: kvdb.version,
                force: false,
            });
            await setEntry(epoch, keyIds[epoch]);
        }
        
        const first = await this.apis.kvdbApi.kvdbEntryGet({kvdbId, kvdbEntryKey: "entry-at-epoch-0" as types.kvdb.KvdbEntryKey});
        assert(first.kvdbEntry.keyId === keyIds[0], "the entry written before the rotations should still report its original keyId");
        const {kvdb} = await this.apis.kvdbApi.kvdbGet({kvdbId});
        this.assertKeyIdsWrappedForGroup(kvdb.groupKeys, groupId, keyIds);
    }
    
    /** A flat group starts at epoch 0 — the epoch every container below is first wrapped to. */
    private async createGroupGrantee() {
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            groupPubKey: groupPubKeys[0],
            users: [testData.userId],
            managers: [testData.userId],
            data: groupData,
            keyId: groupKeyIds[0],
            keys: [{user: testData.userId, keyId: groupKeyIds[0], data: userKeyData}],
        });
        this.groupId = res.groupId;
        return res.groupId;
    }
    
    /** Advances the group to `newEpoch` (CAS on `keyVersion`) — what a member removal does under the hood. */
    private async bumpGroupEpoch(newEpoch: number) {
        const res = await this.apis.contextApi.groupGenerateNewKey({
            id: this.requireGroupId(),
            groupPubKey: groupPubKeys[newEpoch],
            data: groupData,
            keyId: groupKeyIds[newEpoch],
            keys: [{user: testData.userId, keyId: groupKeyIds[newEpoch], data: userKeyData}],
            expectedKeyVersion: newEpoch - 1,
        });
        assert(res === "OK", "groupGenerateNewKey did not return OK");
        const {group} = await this.apis.contextApi.groupGet({groupId: this.requireGroupId()});
        assert(group.keyVersion === newEpoch, `group should be at epoch ${newEpoch}, is ${group.keyVersion}`);
    }
    
    private async createFile(storeId: types.store.StoreId, keyId: types.core.KeyId) {
        const request = await this.apis.requestApi.createRequest({files: [{size: 512, checksumSize: 64}]});
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(512, "A")});
        await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 1, checksum: Buffer.alloc(64)});
        const res = await this.apis.storeApi.storeFileCreate({
            storeId,
            resourceId: this.helpers.generateResourceId(),
            requestId: request.id,
            fileIndex: 0,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId,
        });
        return res.fileId;
    }
    
    private assertKeyIdsWrappedForGroup(groupKeys: types.cloud.GroupKeysEntry[], groupId: types.group.GroupId, keyIds: types.core.KeyId[]) {
        const entry = groupKeys.find(e => e.group === groupId);
        if (!entry) {
            throw new Error("the granted group should still have a groupKeys entry");
        }
        for (const [epoch, keyId] of keyIds.entries()) {
            const wrapped = entry.keys.find(k => k.keyId === keyId);
            if (!wrapped) {
                throw new Error(`the wrapping for ${keyId} should be kept so content written under it stays readable`);
            }
            assert(wrapped.groupEpoch === epoch, `${keyId} should be tagged with epoch ${epoch}, got ${wrapped.groupEpoch}`);
        }
    }
    
    private requireGroupId(): types.group.GroupId {
        if (!this.groupId) {
            throw new Error("groupId not initialized yet");
        }
        return this.groupId;
    }
}
