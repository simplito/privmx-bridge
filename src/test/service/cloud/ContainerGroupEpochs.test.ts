/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { BaseContainerService } from "../../../service/cloud/BaseContainerService";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { ActiveUsersMap } from "../../../cluster/master/ipcServices/ActiveUsers";
import { createMock, mock } from "../../testUtils/TestUtils";
import { AppException } from "../../../api/AppException";
import { grantsWithEpochOf, staleGroupsOf } from "../../../api/main/GroupEpochStaleness";
import * as types from "../../../types";

/**
 * Lazy revocation from the container's side: refusing a stale container is what makes a removal bite, and
 * accepting a re-keyed one is what lets the container be used again.
 *
 * The second half is easy to lose — a re-keyed container still carries the old entry, so a check over all
 * entries refuses writes forever and no test of the first half notices.
 */

const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const oldKeyId = "key-at-epoch-1" as types.core.KeyId;
const newKeyId = "key-at-epoch-2" as types.core.KeyId;

class ContainerService extends BaseContainerService {
    async check(container: Parameters<BaseContainerService["checkGroupEpochs"]>[0], enforced = true) {
        return this.checkGroupEpochs(container, enforced);
    }
}

function createService(currentGroupEpoch: number) {
    const repositoryFactory = createMock<RepositoryFactory>({});
    const groupRepository = createMock<GroupRepository>({});
    mock(groupRepository, "getKeyVersions", async () => new Map([[groupId, currentGroupEpoch]]));
    mock(repositoryFactory, "createGroupRepository", () => groupRepository);
    return new ContainerService(repositoryFactory, createMock<ActiveUsersMap>({}), "localhost" as types.core.Host);
}

/** A container granted to the group, holding one key entry per keyId it has ever used. */
function grantedContainer(keyId: types.core.KeyId, wraps: {keyId: types.core.KeyId, groupEpoch?: number}[]) {
    return {
        contextId: contextId,
        keyId: keyId,
        groups: [{groupId: groupId, role: "user" as types.cloud.ContainerRole}],
        groupKeys: [{
            group: groupId,
            keys: wraps.map(wrap => ({
                keyId: wrap.keyId,
                data: "blob" as types.core.UserKeyData,
                ...(wrap.groupEpoch === undefined ? {} : {groupEpoch: wrap.groupEpoch}),
            })),
        }],
    };
}

async function expectRefused(run: () => Promise<unknown>) {
    try {
        await run();
    }
    catch (e) {
        expect(AppException.is(e, "CONTAINER_GROUP_EPOCH_OUTDATED")).toBe(true);
        return;
    }
    throw new Error("expected CONTAINER_GROUP_EPOCH_OUTDATED");
}

it("refuses a write while the container's key is wrapped to a superseded epoch", async () => {
    // The container still holds the epoch-1 key, which the departed member can open.
    const service = createService(2);
    await expectRefused(() => service.check(grantedContainer(oldKeyId, [{keyId: oldKeyId, groupEpoch: 1}])));
});

it("accepts a write once the container has re-keyed, old entries and all", async () => {
    // The old entry stays by design; it must not leave a correctly re-keyed container unwritable.
    const service = createService(2);
    await service.check(grantedContainer(newKeyId, [
        {keyId: oldKeyId, groupEpoch: 1},
        {keyId: newKeyId, groupEpoch: 2},
    ]));
});

it("refuses a re-key that only appears to catch up", async () => {
    // A new keyId wrapped to the old epoch: the removed member holds that epoch and would read on.
    const service = createService(2);
    await expectRefused(() => service.check(grantedContainer(newKeyId, [
        {keyId: oldKeyId, groupEpoch: 1},
        {keyId: newKeyId, groupEpoch: 1},
    ])));
});

it("treats a Phase-1 entry with no epoch as behind any rotation", async () => {
    const service = createService(2);
    await expectRefused(() => service.check(grantedContainer(oldKeyId, [{keyId: oldKeyId}])));
});

it("accepts a container whose group has not rotated at all", async () => {
    const service = createService(1);
    await service.check(grantedContainer(oldKeyId, [{keyId: oldKeyId, groupEpoch: 1}]));
});

it("says nothing about a container whose current key is not wrapped to the group", async () => {
    // Unwrapped, not stale: nobody reads this content through the group.
    const service = createService(2);
    await service.check(grantedContainer(newKeyId, [{keyId: oldKeyId, groupEpoch: 1}]));
});

it("leaves a container with no group grantees alone", async () => {
    const service = createService(2);
    await service.check({contextId: contextId, keyId: newKeyId});
});

it("does not enforce anything when the container has not asked for forward secrecy", async () => {
    // Enforcement costs a re-key on every group rotation, so it is opt-in per container.
    const service = createService(2);
    await service.check(grantedContainer(oldKeyId, [{keyId: oldKeyId, groupEpoch: 1}]), false);
});

/**
 * The client's side of the same question, and the reason the bridge no longer answers it on every read: a
 * container payload carries each grant's wrap epoch (`groups[].groupEpoch`), and the client compares it against
 * the group's current epoch itself.
 *
 * This is the rule documented on `types.cloud.GroupGrantInfo`, written out exactly as a client applies it.
 */
function clientSaysRekeyNeeded(container: {keyId: types.core.KeyId, groups?: types.cloud.GroupGrant[], groupKeys?: types.cloud.GroupKeysEntry[]}, currentEpochs: Map<types.group.GroupId, number>) {
    return grantsWithEpochOf(container).some(grant =>
        grant.groupEpoch !== undefined && grant.groupEpoch < (currentEpochs.get(grant.groupId) ?? 1));
}

it("refuses exactly what a client predicts from the epochs it was served", async () => {
    // A client that acted on a payload disagreeing with this refusal would loop — re-key, still refused, re-key
    // again — or worse, skip a re-key it owes and keep a removed member reading. Both halves read the same wrap
    // for that reason, and this pins the pairing fixture by fixture.
    const service = createService(2);
    const epochs = new Map([[groupId, 2]]);
    const fixtures = [
        grantedContainer(oldKeyId, [{keyId: oldKeyId, groupEpoch: 1}]),
        grantedContainer(newKeyId, [{keyId: oldKeyId, groupEpoch: 1}, {keyId: newKeyId, groupEpoch: 2}]),
        grantedContainer(newKeyId, [{keyId: oldKeyId, groupEpoch: 1}, {keyId: newKeyId, groupEpoch: 1}]),
        grantedContainer(oldKeyId, [{keyId: oldKeyId}]),
        grantedContainer(newKeyId, [{keyId: oldKeyId, groupEpoch: 1}]),
    ];
    for (const container of fixtures) {
        const predicted = clientSaysRekeyNeeded(container, epochs);
        const stale = staleGroupsOf(container, epochs).length > 0;
        let refused = false;
        try {
            await service.check(container);
        }
        catch {
            refused = true;
        }
        expect(refused).toBe(stale);
        expect(predicted).toBe(refused);
    }
});
