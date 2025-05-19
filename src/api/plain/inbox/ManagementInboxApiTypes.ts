/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface GetInboxModel {
    /** Inbox ID */
    inboxId: types.inbox.InboxId;
}

export interface GetInboxResult {
    /** Inbox */
    inbox: Inbox;
}

export interface ListInboxesModel extends types.core.ListModel2<types.inbox.InboxId> {
    /** Context's ID */
    contextId: types.context.ContextId;
}

export interface ListInboxesResult {
    /** List of Inboxes */
    list: Inbox[];
    /** Number of all elements */
    count: number;
}

export interface DeleteInboxModel {
    /** Inbox ID */
    inboxId: types.inbox.InboxId;
}

export interface DeleteManyInboxesModel {
    /** List of Inboxes to delete */
    inboxIds: types.inbox.InboxId[];
}

export interface DeleteManyInboxesResult {
    /** List of deletions status */
    results: types.inbox.InboxDeleteStatus[];
}

export interface Inbox {
    /** Inbox's ID */
    id: types.inbox.InboxId;
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Creation date */
    createDate: types.core.Timestamp;
    /** Creator's ID */
    creator: types.cloud.UserId;
    /** Last modification date */
    lastModificationDate: types.core.Timestamp;
    /** Last modifier ID */
    lastModifier: types.cloud.UserId;
    /** Key's ID */
    keyId: types.core.KeyId;
    /** Users list */
    users: types.cloud.UserId[];
    /** Managers list */
    managers: types.cloud.UserId[];
    /** Version */
    version: types.inbox.InboxVersion;
}

export interface InboxDeletedData {
    /** inbox's id */
    inboxId: types.inbox.InboxId
}

export interface InboxCreatedEvent {
    channel: "inbox";
    type: "inboxCreated";
    data: Inbox;
    timestamp: types.core.Timestamp;
}

export interface InboxUpdatedEvent {
    channel: "inbox";
    type: "inboxUpdated";
    data: Inbox;
    timestamp: types.core.Timestamp;
}

export interface InboxDeletedEvent {
    channel: "inbox";
    type: "inboxDeleted";
    data: InboxDeletedData;
    timestamp: types.core.Timestamp;
}

export type InboxEvent = InboxCreatedEvent|InboxUpdatedEvent|InboxDeletedEvent;

export interface IInboxApi {
    
    /**
    * Fetches inbox with given ID
    * @param model Context's ID, Inbox's ID
    * @returns Inbox's info
    */
    getInbox(model: GetInboxModel): Promise<GetInboxResult>;
    
    /**
    * List Inboxes in given context
    * @param model Inbox's ID
    * @returns List of Inboxes
    */
    listInboxes(model: ListInboxesModel): Promise<ListInboxesResult>;
    
    /**
    * Deletes inbox
    * @param model Context's ID, Inbox's ID
    * @returns "OK"
    */
    deleteInbox(model: DeleteInboxModel): Promise<types.core.OK>;
    
    /**
    * Deletes given Inboxes, requires that they belong to the same Context
    * @param model Context's ID, List of Inbox IDs
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyInboxes(model: DeleteManyInboxesModel): Promise<DeleteManyInboxesResult>;
}
