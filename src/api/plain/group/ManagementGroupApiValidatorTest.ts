/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementGroupApi } from "./ManagementGroupApi";
import { ManagementGroupApiValidator } from "./ManagementGroupApiValidator";
import * as types from "../../../types";
import * as managementGroupApi from "./ManagementGroupApiTypes";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

const groupId = "9a1c3f7d2b6e4a8c0d5f1e3b7a9c2d4f6e8b0a1c3d5e7f9a2b4c6d8e0f1a3b5c" as types.group.GroupId;
const contextId = "657838dd3359f5a16f93cd81" as types.context.ContextId;
const pubKey = "51ciywf5ZfrZ1qoyoXEKc1oKBE1x9mXNLCw6EKtzV6SJnVjDF9" as types.cloud.UserPubKey;

const group: managementGroupApi.Group = {
    id: groupId,
    contextId: contextId,
    creator: "john" as types.cloud.UserId,
    createDate: 1715959261142 as types.core.Timestamp,
    lastModificationDate: 1715959261142 as types.core.Timestamp,
    keyVersion: 3,
    rosterVersion: 5,
    lastCommitSeq: 6,
    members: [
        {userId: "john" as types.cloud.UserId, pubKey: pubKey, role: "manager"},
        {userId: "alice" as types.cloud.UserId, pubKey: pubKey, role: "user"},
    ],
    rules: {
        addMembers: "members",
        removeMembers: "managers",
        replaceMemberKeys: "managers",
        changeRoles: "managers",
        changeRules: "managers",
        changeVisibility: "managers",
        trimHistory: "managers",
        editPublicMeta: "members",
        editPrivateMeta: "managers",
    },
    visibleTo: "members",
    publicMeta: "AAECAwQ=",
};

export const test = testApi("client", "group/", ManagementGroupApi, new ManagementGroupApiValidator(new TypesValidator()), call => {
    call("getGroup", api => api.getGroup({
        groupId: groupId,
    })).setResult({
        group: group,
    });
    call("listGroups", api => api.listGroups({
        contextId: contextId,
        skip: 0,
        limit: 10,
        sortOrder: "desc",
    })).setResult({
        count: 1,
        list: [group],
    });
    call("listGroupsOfUser", api => api.listGroupsOfUser({
        contextId: contextId,
        userId: "john" as types.cloud.UserId,
        skip: 0,
        limit: 10,
        sortOrder: "desc",
    })).setResult({
        count: 1,
        list: [{groupId: groupId, role: "manager", isLastManager: true}],
    });
    call("listGroupCommits", api => api.listGroupCommits({
        groupId: groupId,
        fromSeq: 0,
        limit: 10,
    })).setResult({
        commits: [{
            seq: 1,
            prevDigest: "",
            op: "create",
            groupId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
            treeVersion: 3,
            date: 1715959261142,
            keyVersion: 1,
            groupPubKey: "02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90" as types.cloud.GroupPubKey,
            rosterVersion: 1,
            rosterHash: "5f2c8a1e9b3d7c4f6a0e2b8d1c5f9a3e7b4d6c0f2a8e1b9d3c7f5a4e6b0d2c8f",
            treeHash: "1e9b3d7c4f6a0e2b8d1c5f9a3e7b4d6c0f2a8e1b9d3c7f5a4e6b0d2c8f5f2c8a",
            policyHash: "d7c4f6a0e2b8d1c5f9a3e7b4d6c0f2a8e1b9d3c7f5a4e6b0d2c8f5f2c8a1e9b3",
            committer: "john" as types.cloud.UserId,
            committerPubKey: pubKey,
            committerSeat: 0,
            path: [],
            addedUsers: [],
            addedManagers: [],
            removed: [],
            signature: "H3A2pG0rLwq8b1lQzT7S1x0dYcVn5mKe4uJfWgRkPq2sXhZyBtNvCaMoIiEeUuDdFf0GgHhJjKkLlZzXxCcVvBbNnMm=" as types.core.EccSignature,
        }],
    });
    call("deleteGroup", api => api.deleteGroup({
        groupId: groupId,
    })).setResult("OK");
    call("deleteManyGroups", api => api.deleteManyGroups({
        groupIds: [groupId],
    })).setResult({
        results: [{id: groupId, status: "OK"}],
    });
});
