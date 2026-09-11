/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-empty-function */

import "q2-test";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { CloudKeyService } from "../../../service/cloud/CloudKeyService";
import { createMock, mock } from "../../testUtils/TestUtils";
import * as types from "../../../types";
import { AppException } from "../../../api/AppException";

// Phase 2 (BR-5): per-epoch coverage on container re-key. A container's group key entry must carry a
// `groupEpoch` equal to the group's CURRENT keyVersion — re-keying to a stale epoch (which a removed member
// could still read) is rejected.

const contextId = "ctx" as types.context.ContextId;
const keyId = "k1" as types.core.KeyId;
const g1 = "g1" as types.group.GroupId;
const data = "blob" as types.core.UserKeyData;

function cloudKeyService(currentEpoch: number) {
    const repositoryFactory = createMock<RepositoryFactory>({});
    const groupRepository = createMock<GroupRepository>({});
    mock(repositoryFactory, "createGroupRepository", (() => groupRepository) as never);
    mock(groupRepository, "checkGroupsExistence", async () => {});
    mock(groupRepository, "getKeyVersions", async () => new Map([[g1, currentEpoch]]));
    return new CloudKeyService(repositoryFactory);
}

it("checkGroupKeysAndGrantees accepts a groupEpoch matching the current keyVersion", async () => {
    const service = cloudKeyService(3);
    const res = await service.checkGroupKeysAndGrantees(contextId, [keyId], [], [{group: g1, groupEpoch: 3, keyId, data}], keyId, [g1]);
    expect(res.length).toBe(1);
});

it("checkGroupKeysAndGrantees rejects a stale groupEpoch (re-key to an old epoch)", async () => {
    const service = cloudKeyService(3);
    try {
        await service.checkGroupKeysAndGrantees(contextId, [keyId], [], [{group: g1, groupEpoch: 2, keyId, data}], keyId, [g1]);
    }
    catch (e) {
        expect(AppException.is(e, "INVALID_PARAMS")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});

it("checkGroupKeysAndGrantees rejects a new group key entry that omits groupEpoch (Option A — mandatory)", async () => {
    const service = cloudKeyService(3);
    // simulate a non-validated caller omitting groupEpoch (the validator also rejects this at the boundary)
    const insertWithoutEpoch = {group: g1, keyId, data} as unknown as types.cloud.GroupKeyEntrySet;
    try {
        await service.checkGroupKeysAndGrantees(contextId, [keyId], [], [insertWithoutEpoch], keyId, [g1]);
    }
    catch (e) {
        expect(AppException.is(e, "INVALID_PARAMS")).toBe(true);
        return;
    }
    expect(true).toBeFalsy();
});
