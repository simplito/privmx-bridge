/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface GetStoreModel {
    /** Store ID */
    storeId: types.store.StoreId;
}

export interface GetStoreResult {
    /** Store */
    store: Store;
}

export interface ListStoresModel extends types.core.ListModel2<types.store.StoreId> {
    /** Context's ID */
    contextId: types.context.ContextId;
}

export interface ListStoresResult {
    /** List of Stores */
    list: Store[];
    /** Number of all elements */
    count: number;
}

export interface DeleteStoreModel {
    /** Store ID */
    storeId: types.store.StoreId;
}

export interface GetStoreFileModel {
    /** Store file ID */
    storeFileId: types.store.StoreFileId;
}

export interface GetStoreFileResult {
    /** Store file */
    storeFile: StoreFile;
}

export interface ListStoreFilesModel extends types.core.ListModel2<types.store.StoreFileId> {
    /** Store ID */
    storeId: types.store.StoreId;
}

export interface ListStoreFilesResult {
    /** List of API usage buckets */
    list: StoreFile[];
    /** Number of all elements */
    count: number;
}

export interface DeleteStoreFileModel {
    /** Store file ID */
    storeFileId: types.store.StoreFileId;
}

export interface DeleteManyStoresModel {
    /** List of Stores to delete */
    storeIds: types.store.StoreId[];
}

export interface DeleteManyStoresResult {
    /** List of deletions status */
    results: types.store.StoreDeleteStatus[];
}

export interface DeleteManyStoreFilesModel {
    /** List of files to delete */
    fileIds: types.store.StoreFileId[];
}

export interface DeleteManyStoreFilesResult {
    /** List of deletions status */
    results: types.store.StoreFileDeleteStatus[];
}

export interface DeleteStoreFilesOlderThanModel {
    /** Store's ID */
    storeId: types.store.StoreId;
    /** Date in milliseconds */
    timestamp: types.core.Timestamp;
}
export interface DeleteStoreFilesOlderThanResult {
    /** List of deletions status */
    results: types.store.StoreFileDeleteStatus[];
}

export interface Store {
    /** Store's ID */
    id: types.store.StoreId;
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
    version: types.store.StoreVersion;
    /** Date of last modified file in store */
    lastFileDate: types.core.Timestamp;
    /** Files count in the store */
    files: number;
}

export interface StoreFile {
    /** Store file's ID */
    id: types.store.StoreFileId;
    /** Version */
    version: number;
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Store's ID */
    storeId: types.store.StoreId;
    /** Creation date */
    created: types.core.Timestamp;
    /** Creator ID */
    creator: types.cloud.UserId;
    /** Modification date */
    lastModificationDate: types.core.Timestamp;
    /** Last modifier ID */
    lastModifier: types.cloud.UserId;
    /** File size */
    size: types.core.SizeInBytes;
    /** Key ID */
    keyId: types.core.KeyId;
    /** Thumb */
    thumb?: {
        /** Thumb's size */
        size: types.core.SizeInBytes;
    };
}

export interface StoreFileDeletedData {
    /** file's id */
    id: types.store.StoreFileId,
    /** context's id */
    contextId: types.context.ContextId,
    /** store's id */
    storeId: types.store.StoreId,
}

export interface StoreDeletedData {
    /** store's id */
    storeId: types.store.StoreId
}

export interface StoreStatsChangedData {
    /** store's id */
    id: types.store.StoreId,
    /** context's id */
    contextId: types.context.ContextId,
    /** last file modification date */
    lastFileDate: types.core.Timestamp,
    /** files count in the store */
    files: number,
}

export interface StoreCreatedEvent {
    channel: "store";
    type: "storeCreated";
    data: Store;
}

export interface StoreUpdatedEvent {
    channel: "store";
    type: "storeUpdated";
    data: Store;
}

export interface StoreDeletedEvent {
    channel: "store";
    type: "storeDeleted";
    data: StoreDeletedData;
}

export interface StoreStatsChangedEvent {
    channel: "store";
    type: "storeStatsChanged";
    data: StoreStatsChangedData;
}

export interface StoreFileCreatedEvent {
    channel: "store";
    type: "storeFileCreated";
    data: StoreFile;
}

export interface StoreFileUpdatedEvent {
    channel: "store";
    type: "storeFileUpdated";
    data: StoreFile;
}

export interface StoreFileDeletedEvent {
    channel: "store";
    type: "storeFileDeleted";
    data: StoreFileDeletedData;
}

export type StoreNotifyEvent = StoreCreatedEvent|StoreUpdatedEvent|StoreDeletedEvent|StoreStatsChangedEvent|StoreFileCreatedEvent|StoreFileUpdatedEvent|StoreFileDeletedEvent;

export interface IStoreApi {
    
    /**
    * Fetches store with given ID
    * @param model Context's ID, Store's ID
    * @returns Store's info
    */
    getStore(model: GetStoreModel): Promise<GetStoreResult>;
    
    /**
    * List stores in given context
    * @param model Context's ID
    * @returns List of stores
    */
    listStores(model: ListStoresModel): Promise<ListStoresResult>;
    
    /**
    * Deletes store
    * @param model Context's ID, Store's ID
    * @returns "OK"
    */
    deleteStore(model: DeleteStoreModel): Promise<types.core.OK>;
    
    /**
    * Deletes given Stores, requires that they belong to the same context
    * @param model Context's ID, List of stores ids
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyStores(model: DeleteManyStoresModel): Promise<DeleteManyStoresResult>;
    
    /**
    * Fetches file with given ID
    * @param model Context's ID, file's ID
    * @returns file's info
    */
    getStoreFile(model: GetStoreFileModel): Promise<GetStoreFileResult>;
    
    /**
    * List files in given Store
    * @param model Context's ID
    * @returns List of files
    */
    listStoreFiles(model: ListStoreFilesModel): Promise<ListStoreFilesResult>;
    
    /**
    * Deletes file
    * @param model Context's ID, file's ID
    * @returns "OK"
    */
    deleteStoreFile(model: DeleteStoreFileModel): Promise<types.core.OK>
    
    /**
    * Deletes given files, requires that they belong to the same store
    * @param model Context's ID, List of files IDs
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyStoreFiles(model: DeleteManyStoreFilesModel): Promise<DeleteManyStoreFilesResult>;
    
    /**
    * Deletes all files older than given timestamp
    * @param model Context's ID, Store's ID, timestamp
    * @returns List of ID and status for every deletion attempt
    */
    deleteStoreFilesOlderThan(model: DeleteStoreFilesOlderThanModel): Promise<DeleteStoreFilesOlderThanResult>
}