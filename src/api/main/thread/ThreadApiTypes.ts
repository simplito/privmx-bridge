/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface ThreadCreateModel {
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.thread.ThreadType;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.thread.ThreadData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerPolicy;
}

export interface ThreadUpdateModel {
    id: types.thread.ThreadId;
    resourceId?: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.thread.ThreadData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.thread.ThreadVersion;
    force: boolean;
    policy?: types.cloud.ContainerPolicy;
}

export interface ThreadDeleteModel {
    threadId: types.thread.ThreadId;
}

export interface ThreadDeleteManyModel {
    threadIds: types.thread.ThreadId[];
}

export interface ThreadCreateResult {
    threadId: types.thread.ThreadId;
}

export interface ThreadMessageDeleteManyResult {
    results: types.thread.ThreadMessageDeleteStatus[];
}

export interface ThreadDeleteManyResult {
    results: types.thread.ThreadDeleteStatus[];
}

export interface ThreadMessageDeleteOlderThanResult {
    results: types.thread.ThreadMessageDeleteStatus[];
}

export interface ThreadGetModel {
    threadId: types.thread.ThreadId;
    type?: types.thread.ThreadType;
}

export interface ThreadGetResult {
    thread: ThreadInfo;
}

export interface ThreadListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.thread.ThreadType;
    sortBy?: "createDate"|"lastModificationDate"|"lastMsgDate";
}

export interface ThreadListResult {
    threads: ThreadInfo[];
    count: number;
}

export interface ThreadListAllModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.thread.ThreadType;
    sortBy?: "createDate"|"lastModificationDate"|"lastMsgDate";
}

export type ThreadListAllResult = ThreadListResult;

export interface ThreadInfo {
    id: types.thread.ThreadId;
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: ThreadDataEntry[];
    keyId: types.core.KeyId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.thread.ThreadVersion;
    lastMsgDate: types.core.Timestamp;
    messages: number;
    type?: types.thread.ThreadType;
    policy: types.cloud.ContainerPolicy;
}

export interface ThreadDataEntry {
    keyId: types.core.KeyId;
    data: types.thread.ThreadData;
}

export interface ThreadMessageSendModel {
    threadId: types.thread.ThreadId;
    resourceId?: types.core.ClientResourceId;
    data: types.thread.ThreadMessageData;
    keyId: types.core.KeyId;
}

export interface ThreadMessageUpdateModel {
    messageId: types.thread.ThreadMessageId;
    resourceId?: types.core.ClientResourceId;
    data: types.thread.ThreadMessageData;
    keyId: types.core.KeyId;
    version?: types.thread.ThreadMessageVersion;
    force?: boolean;
}

export interface ThreadMessageDeleteModel {
    messageId: types.thread.ThreadMessageId;
}

export interface ThreadMessageDeleteManyModel {
    messageIds: types.thread.ThreadMessageId[];
}

export interface ThreadMessageDeleteOlderThanModel {
    threadId: types.thread.ThreadId;
    timestamp: types.core.Timestamp;
}

export interface ThreadMessageSendResult {
    messageId: types.thread.ThreadMessageId;
}

export interface ThreadMessageGetModel {
    messageId: types.thread.ThreadMessageId;
}

export interface ThreadMessageGetResult {
    message: ThreadMessage;
}

export interface ThreadMessagesGetModel extends types.core.ListModel {
    threadId: types.thread.ThreadId;
}

export interface ThreadMessagesGetResult {
    thread: ThreadInfo;
    messages: ThreadMessage[];
    count: number;
}

export type ThreadMessagesGetMyModel = ThreadMessagesGetModel

export type ThreadMessagesGetMyResult = ThreadMessagesGetResult

export interface ThreadMessage {
    id: types.thread.ThreadMessageId;
    resourceId?: types.core.ClientResourceId;
    version: types.thread.ThreadMessageVersion;
    contextId: types.context.ContextId;
    threadId: types.thread.ThreadId;
    createDate: types.core.Timestamp;
    author: types.cloud.UserId;
    data: types.thread.ThreadMessageData;
    keyId: types.core.KeyId;
    updates: types.thread.ThreadMessageUpdate[];
}

export type ThreadCreatedEvent = types.cloud.Event<"threadCreated", "thread", ThreadCreatedEventData>;
export type ThreadCreatedEventData = ThreadInfo;

export type ThreadUpdatedEvent = types.cloud.Event<"threadUpdated", "thread", ThreadUpdatedEventData>;
export type ThreadUpdatedEventData = ThreadInfo;

export type ThreadDeletedEvent = types.cloud.Event<"threadDeleted", "thread", ThreadDeletedEventData>;
export interface ThreadDeletedEventData {
    threadId: types.thread.ThreadId;
    type?: types.thread.ThreadType;
}

export type ThreadCustomEvent = types.cloud.Event<"custom", `thread/${types.thread.ThreadId}/${types.core.WsChannelName}`, ThreadCustomEventData>;

export interface ThreadCustomEventData {
    id: types.thread.ThreadId;
    keyId: types.core.KeyId;
    eventData: unknown;
    author: types.cloud.UserIdentity;
};

export type ThreadNewMessageEvent = types.cloud.Event<"threadNewMessage", `thread/${types.thread.ThreadId}/messages`, ThreadNewMessageEventData>;
export type ThreadNewMessageEventData = ThreadMessage;

export type ThreadUpdatedMessageEvent = types.cloud.Event<"threadUpdatedMessage", `thread/${types.thread.ThreadId}/messages`, ThreadUpdatedMessageEventData>;
export type ThreadUpdatedMessageEventData = ThreadMessage;

export type ThreadDeletedMessageEvent = types.cloud.Event<"threadDeletedMessage", `thread/${types.thread.ThreadId}/messages`, ThreadDeletedMessageEventData>;
export interface ThreadDeletedMessageEventData {
    messageId: types.thread.ThreadMessageId;
    threadId: types.thread.ThreadId;
}

export type ThreadStatsEvent = types.cloud.Event<"threadStats", "thread", ThreadStatsEventData>;
export interface ThreadStatsEventData {
    threadId: types.thread.ThreadId;
    contextId: types.context.ContextId;
    type?: types.thread.ThreadType;
    lastMsgDate: types.core.Timestamp;
    messages: number;
}

export type Thread2CreatedEvent = types.cloud.Event<"thread2Created", "thread2", ThreadCreatedEventData>;
export type Thread2UpdatedEvent = types.cloud.Event<"thread2Updated", "thread2", ThreadUpdatedEventData>;
export type Thread2DeletedEvent = types.cloud.Event<"thread2Deleted", "thread2", ThreadDeletedEventData>;
export type Thread2NewMessageEvent = types.cloud.Event<"thread2NewMessage", `thread2/${types.thread.ThreadId}/messages`, ThreadNewMessageEventData>;
export type Thread2UpdatedMessageEvent = types.cloud.Event<"thread2UpdatedMessage", `thread2/${types.thread.ThreadId}/messages`, ThreadUpdatedMessageEventData>;
export type Thread2DeletedMessageEvent = types.cloud.Event<"thread2DeletedMessage", `thread2/${types.thread.ThreadId}/messages`, ThreadDeletedMessageEventData>;
export type Thread2StatsEvent = types.cloud.Event<"thread2Stats", "thread2", ThreadStatsEventData>;

export interface ThreadSendCustomEventModel {
    threadId: types.thread.ThreadId;
    channel: types.core.WsChannelName;
    keyId: types.core.KeyId;
    data: unknown;
    users?: types.cloud.UserId[];
}

export interface IThreadApi {
    threadCreate(model: ThreadCreateModel): Promise<ThreadCreateResult>;
    threadUpdate(model: ThreadUpdateModel): Promise<types.core.OK>;
    threadDelete(model: ThreadDeleteModel): Promise<types.core.OK>;
    threadDeleteMany(model: ThreadDeleteManyModel): Promise<ThreadDeleteManyResult>
    threadGet(model: ThreadGetModel): Promise<ThreadGetResult>;
    threadList(model: ThreadListModel): Promise<ThreadListResult>;
    threadListAll(model: ThreadListAllModel): Promise<ThreadListAllResult>;
    threadMessageSend(model: ThreadMessageSendModel): Promise<ThreadMessageSendResult>;
    threadMessageUpdate(model: ThreadMessageUpdateModel): Promise<types.core.OK>;
    threadMessageDelete(model: ThreadMessageDeleteModel): Promise<types.core.OK>;
    threadMessageDeleteMany(model: ThreadMessageDeleteManyModel): Promise<ThreadMessageDeleteManyResult>
    threadMessageDeleteOlderThan(model: ThreadMessageDeleteOlderThanModel): Promise<ThreadMessageDeleteOlderThanResult>
    threadMessageGet(model: ThreadMessageGetModel): Promise<ThreadMessageGetResult>;
    threadMessagesGet(model: ThreadMessagesGetModel): Promise<ThreadMessagesGetResult>;
    threadMessagesGetMy(model: ThreadMessagesGetMyModel): Promise<ThreadMessagesGetMyResult>;
    threadSendCustomEvent(model: ThreadSendCustomEventModel): Promise<types.core.OK>;
}
