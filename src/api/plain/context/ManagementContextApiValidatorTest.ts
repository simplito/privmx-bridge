/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementContextApi } from "./ManagementContextApi";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";
import { ManagementContextApiValidator } from "./ManagementContextApiValidator";

export const test = testApi("client", "context/", ManagementContextApi, new ManagementContextApiValidator(new TypesValidator()), call => {
    call("getContext", api => api.getContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
    })).setResult({
        context: {
            id: "65fd820f0758a54a68558d7c" as types.context.ContextId,
            created: 1726652150623 as types.core.Timestamp,
            modified: 1726652150623 as types.core.Timestamp,
            solution: "56fd820f0758a54a68558d7c" as types.cloud.SolutionId,
            name: "My Context" as types.context.ContextName,
            description: "Some text" as types.context.ContextDescription,
            scope: "private",
            shares: ["56eee20f0758a54a68558d7c"] as types.cloud.SolutionId[],
            policy: {},
        },
    });
    call("listContexts", api => api.listContexts({
        limit: 10,
        skip: 0,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [{
            id: "662116076325655645e6031e" as types.context.ContextId,
            solution: "65ad8f6c2e4f4f1adb40bf81" as types.cloud.SolutionId,
            shares: [],
            created: 1713444359253 as types.core.Timestamp,
            modified: 1713444359253 as types.core.Timestamp,
            name: "sampleContext" as types.context.ContextName,
            description: "context description" as types.context.ContextDescription,
            scope: "private" as types.context.ContextScope,
            policy: {},
        }],
    });
    call("createContext", api => api.createContext({
        solution: "65ad8f6c2e4f4f1adb40bf81" as types.cloud.SolutionId,
        name: "some-context" as types.context.ContextName,
        description: "some-description" as types.context.ContextDescription,
        scope: "private",
    })).setResult({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
    });
    call("deleteContext", api => api.deleteContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
    })).setResult("OK");
    call("getContext", api => api.getContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
    })).setResult({
        context: {
            id: "662116076325655645e6031e" as types.context.ContextId,
            solution: "65ad8f6c2e4f4f1adb40bf81" as types.cloud.SolutionId,
            shares: [],
            created: 1713444359253 as types.core.Timestamp,
            modified: 1713444359253 as types.core.Timestamp,
            name: "sampleContext" as types.context.ContextName,
            description: "context description" as types.context.ContextDescription,
            scope: "private" as types.context.ContextScope,
            policy: {},
        },
    });
    call("listContextsOfSolution", api => api.listContextsOfSolution({
        solutionId: "65ad8f6c2e4f4f1adb40bf81" as types.cloud.SolutionId,
        skip: 0,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        count: 1,
        list: [{
            id: "662116076325655645e6031e" as types.context.ContextId,
            solution: "65ad8f6c2e4f4f1adb40bf81" as types.cloud.SolutionId,
            shares: [],
            created: 1713444359253 as types.core.Timestamp,
            modified: 1713444359253 as types.core.Timestamp,
            name: "sampleContext" as types.context.ContextName,
            description: "context description" as types.context.ContextDescription,
            scope: "private" as types.context.ContextScope,
            policy: {},
        }],
    });
    call("getUserFromContext", api => api.getUserFromContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        userId: "John" as types.cloud.UserId,
    })).setResult({
        user: {
            userId: "John" as types.cloud.UserId,
            pubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c" as types.cloud.UserPubKey,
            created: 1713444359253 as types.core.Timestamp,
            contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
            acl: "" as types.cloud.ContextAcl,
        },
    });
    call("getUserFromContextByPubKey", api => api.getUserFromContextByPubKey({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        pubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c" as types.cloud.UserPubKey,
    })).setResult({
        user: {
            userId: "John" as types.cloud.UserId,
            pubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c" as types.cloud.UserPubKey,
            created: 1713444359253 as types.core.Timestamp,
            contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
            acl: "" as types.cloud.ContextAcl,
        },
    });
    call("listUsersFromContext", api => api.listUsersFromContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        skip: 0,
        limit: 10,
        sortOrder: "asc",
    })).setResult({
        users: [{
            userId: "John" as types.cloud.UserId,
            pubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c" as types.cloud.UserPubKey,
            created: 1713444359253 as types.core.Timestamp,
            contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
            acl: "" as types.cloud.ContextAcl,
        }],
        count: 1,
    });
    call("removeUserFromContext", api => api.removeUserFromContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        userId: "John" as types.cloud.UserId,
    })).setResult("OK");
    call("removeUserFromContextByPubKey", api => api.removeUserFromContextByPubKey({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        userPubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c" as types.cloud.UserPubKey,
    })).setResult("OK");
    call("updateContext", api => api.updateContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        scope: "public",
    })).setResult("OK");
    call("addSolutionToContext", api => api.addSolutionToContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        solutionId: "65ad8f6c2e4f4f1adb40bf81" as types.cloud.SolutionId,
    })).setResult("OK");
    call("removeSolutionFromContext", api => api.removeSolutionFromContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        solutionId: "65ad8f6c2e4f4f1adb40bf81" as types.cloud.SolutionId,
    })).setResult("OK");
    call("addUserToContext", api => api.addUserToContext({
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        userId: "Josh" as types.cloud.UserId,
        userPubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c" as types.cloud.UserPubKey,
    })).setResult("OK");
    call("setUserAcl", api => api.setUserAcl({
        userId: "John" as types.cloud.UserId,
        contextId: "65fd820f0758a54a68558d7c" as types.context.ContextId,
        acl: "ALLOW ALL" as types.cloud.ContextAcl,
    })).setResult("OK");
});
