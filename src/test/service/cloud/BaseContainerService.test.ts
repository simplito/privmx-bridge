/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable max-classes-per-file */

import "q2-test";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { BaseContainerService } from "../../../service/cloud/BaseContainerService";
import { CloudKeyService } from "../../../service/cloud/CloudKeyService";
import { ActiveUsersMap } from "../../../cluster/master/ipcServices/ActiveUsers";
import { createMock, mock, expectPromise } from "../../testUtils/TestUtils";
import * as types from "../../../types";
import * as db from "../../../db/Model";

// Phase 2 (BR-31/BR-36): the item-write epoch gate. A container with `forwardSecrecy: "yes"` must refuse new
// content while the key it CURRENTLY encrypts with was wrapped to a superseded group epoch — and must accept
// content again as soon as it is re-keyed. BR-31's original "any key entry below the current epoch" rule made
// that second half impossible: historical entries are kept on purpose (they are what keeps pre-rotation
// content readable) and nothing ever removes them, so one removal bricked the container for writes forever.

const contextId = "ctx" as types.context.ContextId;
const g1 = "g1" as types.group.GroupId;
const g2 = "g2" as types.group.GroupId;
const k1 = "k1" as types.core.KeyId;
const k2 = "k2" as types.core.KeyId;
const k3 = "k3" as types.core.KeyId;
const data = "blob" as types.core.UserKeyData;
const host = "localhost" as types.core.Host;

/** The exact shape checkGroupEpochs accepts — thread/store/kvdb documents all satisfy it. */
interface EpochCheckedContainer {
    contextId: types.context.ContextId;
    keyId: types.core.KeyId;
    groups?: types.cloud.GroupGrant[];
    groupKeys?: types.cloud.GroupKeysEntry[];
}

class TestContainerService extends BaseContainerService {
    public check(container: EpochCheckedContainer, enforced: boolean) {
        return this.checkGroupEpochs(container, enforced);
    }
}

function harness(initialEpochs: [types.group.GroupId, number][] = [[g1, 1]]) {
    const epochs = new Map<types.group.GroupId, number>(initialEpochs);
    const repositoryFactory = createMock<RepositoryFactory>({});
    const groupRepository = createMock<GroupRepository>({});
    mock(repositoryFactory, "createGroupRepository", (() => groupRepository) as never);
    mock(groupRepository, "checkGroupsExistence", async () => {});
    mock(groupRepository, "getKeyVersions", async () => new Map(epochs));
    return {
        service: new TestContainerService(repositoryFactory, createMock<ActiveUsersMap>({}), host),
        cloudKeyService: new CloudKeyService(repositoryFactory),
        /** What `groupRemoveMember` / `groupGenerateNewKey` do to the group: advance its epoch. */
        removeMember: () => epochs.set(g1, (epochs.get(g1) ?? 1) + 1),
        epoch: () => epochs.get(g1) ?? 1,
    };
}

type Harness = ReturnType<typeof harness>;

/**
 * Runs a container key-write (create / *Update / *RotateKeys) through the real CloudKeyService, so the
 * groupKeys state under test is exactly what the production path produces — historical entries included.
 */
async function rekey(h: Harness, container: EpochCheckedContainer, newKeyId: types.core.KeyId): Promise<EpochCheckedContainer> {
    const oldGroupKeys = container.groupKeys || [];
    const availableKeyIds = [...oldGroupKeys.flatMap(entry => entry.keys.map(k => k.keyId)), newKeyId];
    const groupKeys = await h.cloudKeyService.checkGroupKeysAndGrantees(
        contextId,
        availableKeyIds,
        oldGroupKeys,
        [{group: g1, groupEpoch: h.epoch(), keyId: newKeyId, data}],
        newKeyId,
        [g1],
    );
    return {...container, keyId: newKeyId, groupKeys};
}

function newContainer(h: Harness, keyId: types.core.KeyId) {
    return rekey(h, {contextId, keyId, groups: [{groupId: g1, role: "user"}]}, keyId);
}

function keyIdsOf(container: EpochCheckedContainer, group: types.group.GroupId) {
    return (container.groupKeys || []).find(entry => entry.group === group)?.keys.map(k => k.keyId) || [];
}

it("checkGroupEpochs accepts a write when the container's current key is on the group's current epoch", async () => {
    const h = harness();
    const container = await newContainer(h, k1);
    await h.service.check(container, true);
});

it("checkGroupEpochs rejects a write while the container still encrypts under a superseded epoch", async () => {
    const h = harness();
    const container = await newContainer(h, k1);
    h.removeMember();
    await expectPromise(h.service.check(container, true)).toThrowApiException("CONTAINER_GROUP_EPOCH_OUTDATED");
});

it("checkGroupEpochs accepts writes again once the container is re-keyed, keeping the historical entry (BR-36)", async () => {
    const h = harness();
    const beforeRotation = await newContainer(h, k1);
    h.removeMember();
    const afterRotation = await rekey(h, beforeRotation, k2);
    // The pre-rotation wrapping survives — that is what keeps content written under k1 readable...
    expect(keyIdsOf(afterRotation, g1)).toEqual([k1, k2]);
    // ...and it must NOT keep the container unwritable (the BR-36 regression).
    await h.service.check(afterRotation, true);
});

it("checkGroupEpochs keeps the container writable across two consecutive removals and re-keys", async () => {
    const h = harness();
    let container = await newContainer(h, k1);
    await h.service.check(container, true);
    
    h.removeMember();
    await expectPromise(h.service.check(container, true)).toThrowApiException("CONTAINER_GROUP_EPOCH_OUTDATED");
    container = await rekey(h, container, k2);
    await h.service.check(container, true);
    
    h.removeMember();
    await expectPromise(h.service.check(container, true)).toThrowApiException("CONTAINER_GROUP_EPOCH_OUTDATED");
    container = await rekey(h, container, k3);
    await h.service.check(container, true);
    
    expect(keyIdsOf(container, g1)).toEqual([k1, k2, k3]);
    expect(h.epoch()).toBe(3);
});

it("checkGroupEpochs does nothing when forward secrecy is not enforced", async () => {
    const h = harness();
    const container = await newContainer(h, k1);
    h.removeMember();
    await h.service.check(container, false);
});

it("checkGroupEpochs does nothing when the container has no group grantees", async () => {
    const h = harness();
    await h.service.check({contextId, keyId: k1, groups: [], groupKeys: []}, true);
});

it("checkGroupEpochs ignores an entry left behind by a group that is no longer a grantee", async () => {
    const h = harness([[g1, 1], [g2, 5]]);
    const container = await newContainer(h, k1);
    // g2 was a grantee at k1 and has since been revoked and rotated far ahead; buildGroupKeys carries its old
    // entry forward. Only the granted groups are checked, so the leftover cannot block writes.
    container.groupKeys = [...(container.groupKeys || []), {group: g2, keys: [{keyId: k1, data, groupEpoch: 1}]}];
    await h.service.check(container, true);
});

it("checkGroupEpochs treats a current key entry without groupEpoch as stale, and a re-key clears it", async () => {
    const h = harness();
    // Pre-BR-5 data: a group key entry that never declared the epoch it was wrapped to.
    const legacy: EpochCheckedContainer = {
        contextId,
        keyId: k1,
        groups: [{groupId: g1, role: "user"}],
        groupKeys: [{group: g1, keys: [{keyId: k1, data}]}],
    };
    await expectPromise(h.service.check(legacy, true)).toThrowApiException("CONTAINER_GROUP_EPOCH_OUTDATED");
    await h.service.check(await rekey(h, legacy, k2), true);
});

it("checkGroupEpochs ignores a stale historical entry even when the current key has no entry for the group", async () => {
    const h = harness();
    // Defensive: verifyThatOnlyGivenGroupsHaveAccess makes this unreachable through the API (a grantee always
    // has an entry for the current keyId), but a stale historical entry must never be read as a claim about k2.
    const container: EpochCheckedContainer = {
        contextId,
        keyId: k2,
        groups: [{groupId: g1, role: "user"}],
        groupKeys: [{group: g1, keys: [{keyId: k1, data, groupEpoch: 1}]}],
    };
    h.removeMember();
    await h.service.check(container, true);
});

// The gate lives in BaseContainerService, so Thread, Store and Kvdb run the very same code — each service
// passes its own document straight in (ThreadService.sendMessage; StoreService.createStoreFile /
// writeStoreFile / randomWrite / updateStoreFile; KvdbService.setItem). The cases below feed it real
// db.thread.Thread / db.store.Store / db.kvdb.Kvdb documents, which also pins the narrowed parameter shape
// (it now reads `keyId`) against all three models at compile time.

const now = 0 as types.core.Timestamp;
const owner = "owner" as types.cloud.UserId;

/** Fields every container document shares. `policy` is irrelevant here — the gate takes `enforced` as an argument. */
function containerBase(keyId: types.core.KeyId, groupKeys: types.cloud.GroupKeysEntry[]) {
    return {
        contextId,
        createDate: now,
        creator: owner,
        lastModificationDate: now,
        lastModifier: owner,
        keyId,
        allTimeUsers: [owner],
        users: [owner],
        managers: [owner],
        keys: [],
        groups: [{groupId: g1, role: "user" as types.cloud.ContainerRole}],
        groupKeys,
        history: [],
    };
}

const documentBuilders: {name: string; build: (keyId: types.core.KeyId, groupKeys: types.cloud.GroupKeysEntry[]) => EpochCheckedContainer}[] = [
    {
        name: "thread",
        build: (keyId, groupKeys): db.thread.Thread => ({
            ...containerBase(keyId, groupKeys),
            id: "thread-1" as types.thread.ThreadId,
            data: "AAAA" as types.thread.ThreadData,
            lastMsgDate: now,
            messages: 0,
        }),
    },
    {
        name: "store",
        build: (keyId, groupKeys): db.store.Store => ({
            ...containerBase(keyId, groupKeys),
            id: "store-1" as types.store.StoreId,
            data: "AAAA" as types.store.StoreData,
            lastFileDate: now,
            files: 0,
        }),
    },
    {
        name: "kvdb",
        build: (keyId, groupKeys): db.kvdb.Kvdb => ({
            ...containerBase(keyId, groupKeys),
            id: "kvdb-1" as types.kvdb.KvdbId,
            clientResourceId: "kvdb-res-1" as types.core.ClientResourceId,
            data: "AAAA" as types.kvdb.KvdbData,
            lastEntryDate: now,
            entries: 0,
        }),
    },
];

for (const {name, build} of documentBuilders) {
    it(`checkGroupEpochs blocks then unblocks writes on a real ${name} document`, async () => {
        const h = harness();
        const created = await newContainer(h, k1);
        const container = build(k1, created.groupKeys || []);
        await h.service.check(container, true);
        
        h.removeMember();
        await expectPromise(h.service.check(container, true)).toThrowApiException("CONTAINER_GROUP_EPOCH_OUTDATED");
        
        const rotated = await rekey(h, container, k2);
        await h.service.check(build(k2, rotated.groupKeys || []), true);
    });
}
