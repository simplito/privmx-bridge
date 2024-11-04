/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementThreadApi } from "./ManagementThreadApi";
import { ManagementThreadApiValidator } from "./ManagementThreadApiValidator";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

export const test = testApi("client", "thread/", ManagementThreadApi, new ManagementThreadApiValidator(new TypesValidator()), call => {
    call("getThread", api => api.getThread({
        threadId: "664775ddb5d9a3f95b619ef0" as types.thread.ThreadId,
    })).setResult({
        thread: {
            id: "664775ddb5d9a3f95b619ef0" as types.thread.ThreadId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1715959261142 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModificationDate: 1715959261142 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            users: ["john" as types.cloud.UserId],
            managers: ["john" as types.cloud.UserId],
            version: 1 as types.thread.ThreadVersion,
            lastMsgDate: 1715959261394 as types.core.Timestamp,
            messages: 34,
        },
    });
    call("listThreads", api => api.listThreads({
        contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [
            {
                id: "664775ddb5d9a3f95b619ef0" as types.thread.ThreadId,
                contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
                createDate: 1715959261142 as types.core.Timestamp,
                creator: "john" as types.cloud.UserId,
                lastModificationDate: 1715959261142 as types.core.Timestamp,
                lastModifier: "john" as types.cloud.UserId,
                keyId: "my-key" as types.core.KeyId,
                users: ["john" as types.cloud.UserId],
                managers: ["john" as types.cloud.UserId],
                version: 1 as types.thread.ThreadVersion,
                lastMsgDate: 1715959261394 as types.core.Timestamp,
                messages: 34,
            },
        ],
    });
    call("deleteThread", api => api.deleteThread({
        threadId: "664775ddb5d9a3f95b619ef0" as types.thread.ThreadId,
    })).setResult("OK");
    call("getThreadMessage", api => api.getThreadMessage({
        threadMessageId: "65ad8f6c2e4f4f1adb40bf81" as types.thread.ThreadMessageId,
    })).setResult({
        threadMessage: {
            id: "664775dd05c7c6f92f654a11" as types.thread.ThreadMessageId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            threadId: "664775ddb5d9a3f95b619ef0" as types.thread.ThreadId,
            createDate: 1715959261318 as types.core.Timestamp,
            author: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
        },
    });
    call("listThreadMessages", api => api.listThreadMessages({
        threadId: "65ad8f6c2e4f4f1adb40bf81" as types.thread.ThreadId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [
            {
                id: "664775dd05c7c6f92f654a11" as types.thread.ThreadMessageId,
                contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
                threadId: "664775ddb5d9a3f95b619ef0" as types.thread.ThreadId,
                createDate: 1715959261318 as types.core.Timestamp,
                author: "john" as types.cloud.UserId,
                keyId: "my-key" as types.core.KeyId,
            },
        ],
    });
    call("deleteThreadMessage", api => api.deleteThreadMessage({
        threadMessageId: "65ad8f6c2e4f4f1adb40bf81" as types.thread.ThreadMessageId,
    })).setResult("OK");
    call("deleteManyThreads", api => api.deleteManyThreads({
        threadIds: ["65ad8f6c2e4f4f1adb40bf81"] as types.thread.ThreadId[],
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.thread.ThreadId,
                status: "OK",
            },
        ],
    });
    call("deleteManyThreadMessages", api => api.deleteManyThreadMessages({
        messageIds: ["65ad8f6c2e4f4f1adb40bf81"] as types.thread.ThreadMessageId[],
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.thread.ThreadMessageId,
                status: "OK",
            },
        ],
    });
    call("deleteThreadMessagesOlderThan", api => api.deleteThreadMessagesOlderThan({
        threadId: "66477724276e411b86fe6d73" as types.thread.ThreadId,
        timestamp: 1715959588042 as types.core.Timestamp,
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.thread.ThreadMessageId,
                status: "OK",
            },
        ],
    });
});
