/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";

export const testData = {
    userInnerId: "662115304034ea5684acac8b-janek",
    userId: "janek" as types.cloud.UserId,
    contextId: "662115304034ea5684acac8b" as types.context.ContextId,
    contextId2: "662115304034ea5684acac8c" as types.context.ContextId,
    userPubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c" as types.core.EccPubKey,
    userPrivKey: "L3ZcrvuPSYaWUnb4sfhxz3bDfvTEQ6Zmntt2BjaWDnfc1mBAhKMV",
    solutionId: "G7J8Pm4op76xCcv9gNVqsQkmFcJ" as types.cloud.SolutionId,
    instanceId: "Jf61tr8Crn72WXpcG7eXWK",
    threadId: "66715bd6ef3efd9ecfe7a1cc" as types.thread.ThreadId,
    threadMessageId: "66715bd6ef3efd9ecfe7a1cd" as types.thread.ThreadMessageId,
    keyId: "my-key" as types.core.KeyId,
    apiKeyId: "34ed9fd355a81d81cc5f984dfab7595a" as types.auth.ApiKeyId,
    apiKeySecret: "e4c21122523e8d8a6643c35b41440e61" as types.auth.ApiKeySecret,
    secondSolutionId: "66ffb29789fd0a444e6f676d" as types.cloud.SolutionId,
    inboxId: "6718ca647117eb03ed335dd0" as types.inbox.InboxId,
    storeId: "6718ca61234548e1928939bf" as types.store.StoreId,
    streamRoomId: "6718e0e99e4e4e36fc5bbcfa" as types.stream.StreamRoomId,
};