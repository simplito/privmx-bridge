/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementStreamApi } from "./ManagementStreamApi";
import { ManagementStreamApiValidator } from "./ManagementStreamApiValidator";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

export const test = testApi("client", "stream/", ManagementStreamApi, new ManagementStreamApiValidator(new TypesValidator()), call => {
    call("getStreamRoom", api => api.getStreamRoom({
        streamRoomId: "664775ddb5d9a3f95b619ef0" as types.stream.StreamRoomId,
    })).setResult({
        streamRoom: {
            id: "664775ddb5d9a3f95b619ef0" as types.stream.StreamRoomId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1715959261142 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModificationDate: 1715959261142 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            users: ["john" as types.cloud.UserId],
            managers: ["john" as types.cloud.UserId],
            version: 1 as types.stream.StreamRoomVersion,
            publicMeta: null,
        },
    });
    call("listStreamRooms", api => api.listStreamRooms({
        contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [
            {
                id: "664775ddb5d9a3f95b619ef0" as types.stream.StreamRoomId,
                contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
                createDate: 1715959261142 as types.core.Timestamp,
                creator: "john" as types.cloud.UserId,
                lastModificationDate: 1715959261142 as types.core.Timestamp,
                lastModifier: "john" as types.cloud.UserId,
                keyId: "my-key" as types.core.KeyId,
                users: ["john" as types.cloud.UserId],
                managers: ["john" as types.cloud.UserId],
                version: 1 as types.stream.StreamRoomVersion,
                publicMeta: null,
            },
        ],
    });
    call("deleteStreamRoom", api => api.deleteStreamRoom({
        streamRoomId: "664775ddb5d9a3f95b619ef0" as types.stream.StreamRoomId,
    })).setResult("OK");
    call("deleteStreamRoom", api => api.deleteStreamRoom({
        streamRoomId: "65ad8f6c2e4f4f1adb40bf81" as types.stream.StreamRoomId,
    })).setResult("OK");
    call("deleteManyStreamRooms", api => api.deleteManyStreamRooms({
        streamRoomIds: ["65ad8f6c2e4f4f1adb40bf81"] as types.stream.StreamRoomId[],
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.stream.StreamRoomId,
                status: "OK",
            },
        ],
    });
});
