/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementInboxApi } from "./ManagementInboxApi";
import { ManagementInboxApiValidator } from "./ManagementInboxApiValidator";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

export const test = testApi("client", "inbox/", ManagementInboxApi, new ManagementInboxApiValidator(new TypesValidator()), call => {
    call("getInbox", api => api.getInbox({
        inboxId: "65ad8f6c2e4f4f1adb40bf81" as types.inbox.InboxId,
    })).setResult({
        inbox: {
            id: "65ad8f6c2e4f4f1adb40bf81" as types.inbox.InboxId,
            contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
            createDate: 1709648110994 as types.core.Timestamp,
            creator: "john" as types.cloud.UserId,
            lastModificationDate: 1709648110994 as types.core.Timestamp,
            lastModifier: "john" as types.cloud.UserId,
            keyId: "my-key" as types.core.KeyId,
            users: ["john" as types.cloud.UserId],
            managers: ["john" as types.cloud.UserId],
            version: 1 as types.inbox.InboxVersion,
            publicMeta: null,
        },
    });
    call("listInboxes", api => api.listInboxes({
        contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
        from: null,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.inbox.InboxId,
                contextId: "657838dd3359f5a16f93cd81" as types.context.ContextId,
                createDate: 1709648110994 as types.core.Timestamp,
                creator: "john" as types.cloud.UserId,
                lastModificationDate: 1709648110994 as types.core.Timestamp,
                lastModifier: "john" as types.cloud.UserId,
                keyId: "my-key" as types.core.KeyId,
                users: ["john" as types.cloud.UserId],
                managers: ["john" as types.cloud.UserId],
                version: 1 as types.inbox.InboxVersion,
                publicMeta: null,
            },
        ],
    });
    call("deleteInbox", api => api.deleteInbox({
        inboxId: "65ad8f6c2e4f4f1adb40bf81" as types.inbox.InboxId,
    })).setResult("OK");
    call("deleteManyInboxes", api => api.deleteManyInboxes({
        inboxIds: ["65ad8f6c2e4f4f1adb40bf81"] as types.inbox.InboxId[],
    })).setResult({
        results: [
            {
                id: "65ad8f6c2e4f4f1adb40bf81" as types.inbox.InboxId,
                status: "OK",
            },
        ],
    });
});
