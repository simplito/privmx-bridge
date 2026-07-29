/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface GetKvdbModel {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
}

export interface GetKvdbResult {
    /** Kvdb */
    kvdb: Kvdb;
}

export interface ListKvdbsModel extends types.core.ListModel2<types.kvdb.KvdbId> {
    /** Context's ID */
    contextId: types.context.ContextId;
}

export interface ListKvdbsResult {
    /** List of Kvdbs */
    list: Kvdb[];
    /** Number of all elements */
    count: number;
}

export interface DeleteKvdbModel {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
}

export interface GetKvdbEntryModel {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
    /** Kvdb entry's key */
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
}

export interface GetKvdbEntryResult {
    /** Kvdb entry */
    kvdbEntry: KvdbEntry;
}
export interface DeleteKvdbEntryModel {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
    /** Kvdb entry's key */
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
}

export interface DeleteManyKvdbsModel {
    /** List of Kvdbs to delete */
    kvdbIds: types.kvdb.KvdbId[]
}

export interface DeleteManyKvdbsResult {
    /** List of deletions status */
    results: types.kvdb.KvdbDeleteStatus[];
}

export interface Kvdb {
    /** Kvdb's ID */
    id: types.kvdb.KvdbId;
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
    version: types.kvdb.KvdbVersion;
    /** Date of last modified entry in thread */
    lastEntryDate: types.core.Timestamp;
    /** Entries count in thread */
    entries: number;
    /** Public meta data set by user, equal to null if does not exist */
    publicMeta: unknown
}

export interface KvdbEntry {
    /** Kvdb entry's key */
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
    /** Version */
    version: types.kvdb.KvdbEntryVersion;
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Creation date */
    createDate: types.core.Timestamp;
    /** Author's ID */
    author: types.cloud.UserId;
    /** Key ID */
    keyId: types.core.KeyId;
    /** Last modification */
    lastModificationDate: types.core.Timestamp;
    /** Last modifier */
    lastModifier: types.cloud.UserId;
    /** Public meta data set by user, equal to null if does not exist */
    publicMeta: unknown
}

export interface KvdbDeletedData {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId
}

export interface KvdbStatsData {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId,
    /** last entry date */
    lastEntryDate: types.core.Timestamp,
    /** entries count in the store */
    entries: number,
}

export interface KvdbEntryDeletedData {
    /** Entry's key */
    entryKey: types.kvdb.KvdbEntryKey,
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId,
}

export interface KvdbCreatedEvent {
    channel: "kvdb";
    type: "kvdbCreated";
    data: Kvdb;
    timestamp: types.core.Timestamp;
}

export interface KvdbUpdatedEvent {
    channel: "kvdb";
    type: "kvdbUpdated";
    data: Kvdb;
    timestamp: types.core.Timestamp;
}

export interface KvdbDeletedEvent {
    channel: "kvdb";
    type: "kvdbDeleted";
    data: KvdbDeletedData;
    timestamp: types.core.Timestamp;
}

export interface KvdbStatsEvent {
    channel: "kvdb";
    type: "kvdbStats";
    data: KvdbStatsData;
    timestamp: types.core.Timestamp;
}

export interface KvdbNewEntryEvent {
    channel: "kvdb";
    type: "kvdbNewEntry";
    data: KvdbEntry;
    timestamp: types.core.Timestamp;
}

export interface KvdbUpdatedEntryEvent {
    channel: "kvdb";
    type: "kvdbUpdatedEntry";
    data: KvdbEntry;
    timestamp: types.core.Timestamp;
}

export interface KvdbDeletedEntryEvent {
    channel: "kvdb";
    type: "kvdbDeletedEntry";
    data: KvdbEntryDeletedData;
    timestamp: types.core.Timestamp;
}

export type KvdbNotifyEvent = KvdbCreatedEvent|KvdbUpdatedEvent|KvdbDeletedEvent|KvdbStatsEvent|KvdbNewEntryEvent|KvdbUpdatedEntryEvent|KvdbDeletedEntryEvent;

export interface DeleteManyKvdbEntriesModel {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
    /** List of Kvdb's keys */
    kvdbEntryKeys: types.kvdb.KvdbEntryKey[];
}

export interface DeleteManyKvdbEntriesResult {
    /** List of deletions status */
    results: types.kvdb.KvdbEntryDeleteStatus[];
}

export interface ListKvdbKeysModel extends types.core.ListModel2<types.kvdb.KvdbEntryKey> {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
}

export interface ListKvdbKeysResult {
    /** Kvdb */
    kvdb: Kvdb;
    /** List of Kvdb's keys */
    list: types.kvdb.KvdbEntryKey[];
    /** Number of entries in Kvdb*/
    count: number;
}

export interface ListKvdbEntriesModel extends types.core.ListModel2<types.kvdb.KvdbEntryKey> {
    /** Kvdb's ID */
    kvdbId: types.kvdb.KvdbId;
    /** Searched key prefix */
    prefix?: string;
}

export interface ListKvdbEntriesResult {
    /** Kvdb */
    kvdb: Kvdb;
    /** List of Kvdb's entries */
    list: KvdbEntry[];
    /** Number of entries in Kvdb*/
    count: number;
}

export interface IKvdbApi {
    
    /**
    * Fetches Kvdb with given ID
    * @param model Context's ID, Kvdb's ID
    * @returns Kvdb's info
    */
    getKvdb(model: GetKvdbModel): Promise<GetKvdbResult>;
    
    /**
    * List Kvdbs in given Context
    * @param model Context's ID
    * @returns List of Kvdbs
    */
    listKvdbs(model: ListKvdbsModel): Promise<ListKvdbsResult>;
    
    /**
    * Deletes Kvdb
    * @param model Context's ID, Kvdb's ID
    * @returns "OK"
    */
    deleteKvdb(model: DeleteKvdbModel): Promise<types.core.OK>;
    
    /**
    * Deletes given Kvdbs, requires that they belong to the same Context
    * @param model Context's ID, List of Kvdb IDs
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyKvdbs(model: DeleteManyKvdbsModel): Promise<DeleteManyKvdbsResult>;
    
    /**
    * Fetches entry with given ID
    * @param model Context's ID, entry's ID
    * @returns entry's info
    */
    getKvdbEntry(model: GetKvdbEntryModel): Promise<GetKvdbEntryResult>;
    
    /**
    * Deletes Kvdb entry
    * @param model Context's ID, entry's ID
    * @returns "OK"
    */
    deleteKvdbEntry(model: DeleteKvdbEntryModel): Promise<types.core.OK>;
    
    /**
    * Deletes given entries
    * @param model Kvdb's ID, List of entry keys
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyKvdbEntries(model: DeleteManyKvdbEntriesModel): Promise<DeleteManyKvdbEntriesResult>;
    
    /**
    * Lists keys of entries in given KVDB
    * @param model Kvdb's ID, List of entry keys
    * @returns List of ID and status for every deletion attempt
    */
    listKvdbKeys(model: ListKvdbKeysModel): Promise<ListKvdbKeysResult>;
    
    /**
    * Lists entries of given KVDB
    * @param model Kvdb's ID, List of entry keys
    * @returns List of ID and status for every deletion attempt
    */
    listKvdbEntries(model: ListKvdbEntriesModel): Promise<ListKvdbEntriesResult>;
}
