/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface GetThreadModel {
    /** Thread ID */
    threadId: types.thread.ThreadId;
}

export interface GetThreadResult {
    /** Thread */
    thread: Thread;
}

export interface ListThreadsModel extends types.core.ListModel2<types.thread.ThreadId> {
    /** Context's ID */
    contextId: types.context.ContextId;
}

export interface ListThreadsResult {
    /** List of Threads */
    list: Thread[];
    /** Number of all elements */
    count: number;
}

export interface DeleteThreadModel {
    /** Thread ID */
    threadId: types.thread.ThreadId;
}

export interface GetThreadMessageModel {
    /** Thread message ID */
    threadMessageId: types.thread.ThreadMessageId;
}

export interface GetThreadMessageResult {
    /** Thread message */
    threadMessage: ThreadMessage;
}

export interface ListThreadMessagesModel extends types.core.ListModel2<types.thread.ThreadMessageId> {
    /** Thread ID */
    threadId: types.thread.ThreadId;
}

export interface ListThreadMessagesResult {
    /** List of Thread messages */
    list: ThreadMessage[];
    /** Number of all elements */
    count: number;
}

export interface DeleteThreadMessageModel {
    /** Thread message ID */
    threadMessageId: types.thread.ThreadMessageId;
}

export interface DeleteManyThreadsModel {
    /** List of Threads to delete */
    threadIds: types.thread.ThreadId[]
}

export interface DeleteManyThreadsResult {
    /** List of deletions status */
    results: types.thread.ThreadDeleteStatus[];
}

export interface DeleteManyThreadMessagesModel {
    /** List of messages to delete */
    messageIds: types.thread.ThreadMessageId[];
}

export interface DeleteManyThreadMessagesResult {
    /** List of deletions status */
    results: types.thread.ThreadMessageDeleteStatus[];
}

export interface DeleteThreadMessagesOlderThanModel {
    /** Thread's ID */
    threadId: types.thread.ThreadId;
    /** Date in milliseconds */
    timestamp: types.core.Timestamp;
}

export interface DeleteThreadMessagesOlderThanResult {
    /** List of deletions status */
    results: types.thread.ThreadMessageDeleteStatus[];
}

export interface Thread {
    /** Thread's ID */
    id: types.thread.ThreadId;
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Creation date */
    createDate: types.core.Timestamp;
    /** Creator ID*/
    creator: types.cloud.UserId;
    /** Modification date */
    lastModificationDate: types.core.Timestamp;
    /** Last modifier ID */
    lastModifier: types.cloud.UserId;
    /** Key ID */
    keyId: types.core.KeyId;
    /** Users list */
    users: types.cloud.UserId[];
    /** Managers list */
    managers: types.cloud.UserId[];
    /** Version */
    version: types.thread.ThreadVersion;
    /** Date of last modified message in thread */
    lastMsgDate: types.core.Timestamp;
    /** Messages count in thread */
    messages: number;
}

export interface ThreadMessage {
    /** Thread message's ID */
    id: types.thread.ThreadMessageId;
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Thread's ID */
    threadId: types.thread.ThreadId;
    /** Creation date */
    createDate: types.core.Timestamp;
    /** Author's ID */
    author: types.cloud.UserId;
    /** Key ID */
    keyId: types.core.KeyId;
}

export interface ThreadDeletedData {
    /** thread's id */
    threadId: types.thread.ThreadId
}

export interface ThreadStatsData {
    /** thread's id */
    threadId: types.thread.ThreadId,
    /** last message date */
    lastMsgDate: types.core.Timestamp,
    /** messages count in the store */
    messages: number,
}

export interface ThreadMessageDeletedData {
    /** message's id */
    messageId: types.thread.ThreadMessageId,
    /** thread's id */
    threadId: types.thread.ThreadId,
}

export interface ThreadCreatedEvent {
    channel: "thread";
    type: "threadCreated";
    data: Thread;
}

export interface ThreadUpdatedEvent {
    channel: "thread";
    type: "threadUpdated";
    data: Thread;
}

export interface ThreadDeletedEvent {
    channel: "thread";
    type: "threadDeleted";
    data: ThreadDeletedData;
}

export interface ThreadStatsEvent {
    channel: "thread";
    type: "threadStats";
    data: ThreadStatsData;
}

export interface ThreadNewMessageEvent {
    channel: "thread";
    type: "threadNewMessage";
    data: ThreadMessage;
}

export interface ThreadUpdatedMessageEvent {
    channel: "thread";
    type: "threadUpdatedMessage";
    data: ThreadMessage;
}

export interface ThreadDeletedMessageEvent {
    channel: "thread";
    type: "threadDeletedMessage";
    data: ThreadMessageDeletedData;
}

export type ThreadNotifyEvent = ThreadCreatedEvent|ThreadUpdatedEvent|ThreadDeletedEvent|ThreadStatsEvent|ThreadNewMessageEvent|ThreadUpdatedMessageEvent|ThreadDeletedMessageEvent;

export interface IThreadApi {
    
    /**
    * Fetches Thread with given ID
    * @param model Context's ID, Thread's ID
    * @returns Thread's info
    */
    getThread(model: GetThreadModel): Promise<GetThreadResult>;

    /**
    * List Threads in given Context
    * @param model Context's ID
    * @returns List of Threads
    */
    listThreads(model: ListThreadsModel): Promise<ListThreadsResult>;
    
    /**
    * Deletes Thread
    * @param model Context's ID, Thread's ID
    * @returns "OK"
    */
    deleteThread(model: DeleteThreadModel): Promise<types.core.OK>;
    
    /**
    * Deletes given Threads, requires that they belong to the same Context
    * @param model Context's ID, List of Thread IDs
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyThreads(model: DeleteManyThreadsModel): Promise<DeleteManyThreadsResult>;
    
    /**
    * Fetches message with given ID
    * @param model Context's ID, message's ID
    * @returns message's info
    */
    getThreadMessage(model: GetThreadMessageModel): Promise<GetThreadMessageResult>;
    
    /**
    * List Thread messages in given Thread
    * @param model Context's ID, Thread's ID
    * @returns List of messages
    */
    listThreadMessages(model: ListThreadMessagesModel): Promise<ListThreadMessagesResult>;

    /**
    * Deletes Thread message
    * @param model Context's ID, message's ID
    * @returns "OK"
    */
    deleteThreadMessage(model: DeleteThreadMessageModel): Promise<types.core.OK>;

    /**
    * Deletes given messages, requires that they belong to the same Thread
    * @param model Context's ID, List of messages ids
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyThreadMessages(model: DeleteManyThreadMessagesModel): Promise<DeleteManyThreadMessagesResult>;

    /**
    * Deletes all messages older than given timestamp
    * @param model Context's ID, Thread's ID, timestamp
    * @returns List of ID and status for every deletion attempt
    */
    deleteThreadMessagesOlderThan(model: DeleteThreadMessagesOlderThanModel): Promise<DeleteThreadMessagesOlderThanResult>
}