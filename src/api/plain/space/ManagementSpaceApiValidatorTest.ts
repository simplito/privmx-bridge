/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementSpaceApi } from "./ManagementSpaceApi";
import { ManagementSpaceApiValidator } from "./ManagementSpaceApiValidator";
import * as types from "../../../types";
import * as managementSpaceApi from "./ManagementSpaceApiTypes";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

const spaceId = "3b5c9a1c3f7d2b6e4a8c0d5f1e3b7a9c2d4f6e8b0a1c3d5e7f9a2b4c6d8e0f1a" as types.space.SpaceId;
const contextId = "657838dd3359f5a16f93cd81" as types.context.ContextId;

const space: managementSpaceApi.Space = {
    id: spaceId,
    contextId: contextId,
    creator: "john" as types.cloud.UserId,
    createDate: 1715959261142 as types.core.Timestamp,
    lastModificationDate: 1715959261142 as types.core.Timestamp,
    groups: [{groupId: "9a1c3f7d2b6e4a8c0d5f1e3b7a9c2d4f6e8b0a1c3d5e7f9a2b4c6d8e0f1a3b5c" as types.group.GroupId, role: "user", groupKeyVersion: 3}],
    users: [{userId: "john" as types.cloud.UserId, pubKey: "51ciywf5ZfrZ1qoyoXEKc1oKBE1x9mXNLCw6EKtzV6SJnVjDF9" as types.cloud.UserPubKey, role: "manager"}],
    keyVersion: 2,
    keyIsStale: false,
    publicMeta: "AAECAwQ=",
};

export const test = testApi("client", "space/", ManagementSpaceApi, new ManagementSpaceApiValidator(new TypesValidator()), call => {
    call("getSpace", api => api.getSpace({
        spaceId: spaceId,
    })).setResult({
        space: space,
    });
    call("listSpaces", api => api.listSpaces({
        contextId: contextId,
        skip: 0,
        limit: 10,
        sortOrder: "desc",
    })).setResult({
        count: 1,
        list: [space],
    });
    call("deleteSpace", api => api.deleteSpace({
        spaceId: spaceId,
    })).setResult("OK");
});
