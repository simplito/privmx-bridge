/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface StoreCreateModel {
    contextId: types.context.ContextId;
    type?: types.store.StoreType;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.store.StoreData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerPolicy;
}

export interface StoreUpdateModel {
    id: types.store.StoreId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.store.StoreData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.store.StoreVersion;
    force: boolean;
    policy?: types.cloud.ContainerPolicy;
}

export interface StoreDeleteModel {
    storeId: types.store.StoreId;
}

export interface StoreFileDeleteManyModel {
    storeIds: types.store.StoreFileId[];
}

export interface StoreFileDeleteOlderThanModel {
    storeId: types.store.StoreId;
    timestamp: types.core.Timestamp;
}

export interface StoreDeleteManyModel {
    storeIds: types.store.StoreId[];
}

export interface StoreCreateResult {
    storeId: types.store.StoreId;
}

export interface StoreDeleteManyResult {
    results: types.store.StoreDeleteStatus[]
}

export interface StoreFileDeleteManyResult {
    results: types.store.StoreFileDeleteStatus[]
    
}

export interface StoreFileDeleteOlderThanResult {
    results: types.store.StoreFileDeleteStatus[]
}

export interface Store {
    id: types.store.StoreId;
    contextId: types.context.ContextId;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: StoreDataEntry[];
    keyId: types.core.KeyId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.store.StoreVersion;
    lastFileDate: types.core.Timestamp;
    files: number;
    type?: types.store.StoreType;
    policy: types.cloud.ContainerPolicy;
}

export interface StoreDataEntry {
    keyId: types.core.KeyId;
    data: types.store.StoreData;
}

export interface StoreGetModel {
    storeId: types.store.StoreId;
    type?: types.store.StoreType;
}

export interface StoreGetResult {
    store: Store;
}

export interface StoreListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.store.StoreType;
    sortBy?: "createDate"|"lastModificationDate"|"lastFileDate";
}

export interface StoreListResult {
    stores: Store[];
    count: number;
}

export interface StoreListAllModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.store.StoreType;
    sortBy?: "createDate"|"lastModificationDate"|"lastFileDate";
}

export type StoreListAllResult = StoreListResult;

export type StoreCreatedEvent = types.cloud.Event<"storeCreated", "store", StoreCreatedEventData>;
export type StoreCreatedEventData = Store;

export type StoreUpdatedEvent = types.cloud.Event<"storeUpdated", "store", StoreUpdatedEventData>;
export type StoreUpdatedEventData = Store;

export type StoreDeletedEvent = types.cloud.Event<"storeDeleted", "store", StoreDeletedEventData>;
export interface StoreDeletedEventData {
    storeId: types.store.StoreId;
    type?: types.store.StoreType;
}

export type StoreCustomEvent = types.cloud.Event<"custom", `store/${types.store.StoreId}/${types.core.WsChannelName}`, StoreCustomEventData>;

export interface StoreCustomEventData {
    id: types.store.StoreId;
    keyId: types.core.KeyId;
    eventData: unknown;
    author: types.cloud.UserIdentity;
}

export type StoreStatsChangedEvent = types.cloud.Event<"storeStatsChanged", "store", StoreStatsChangedEventData>;
export interface StoreStatsChangedEventData {
    id: types.store.StoreId;
    contextId: types.context.ContextId;
    type?: types.store.StoreType;
    lastFileDate: types.core.Timestamp;
    files: number;
}

export interface StoreFile {
    id: types.store.StoreFileId;
    version: types.store.StoreFileVersion;
    contextId: types.context.ContextId;
    storeId: types.store.StoreId;
    createDate: types.core.Timestamp;
    author: types.cloud.UserId;
    meta: types.store.StoreFileMeta;
    size: types.core.SizeInBytes;
    keyId: types.core.KeyId;
    thumb?: {
        size: types.core.SizeInBytes;
    };
    updates: types.store.StoreFileUpdate[];
    
    /** @deprecated */
    created: types.core.Timestamp;
    /** @deprecated */
    creator: types.cloud.UserId;
    /** @deprecated */
    lastModificationDate: types.core.Timestamp;
    /** @deprecated */
    lastModifier: types.cloud.UserId;
}

export interface StoreFileGetModel {
    fileId: types.store.StoreFileId;
}

export interface StoreFileGetResult {
    store: Store;
    file: StoreFile;
}

export interface StoreFileGetManyModel {
    storeId: types.store.StoreId;
    fileIds: types.store.StoreFileId[];
    failOnError: boolean;
}

export interface StoreFileGetManyResult {
    store: Store;
    files: StoreFileFetchResult[];
}

export type StoreFileFetchResult = StoreFile|types.store.StoreFileFetchError;

export interface StoreFileListModel extends types.core.ListModel {
    storeId: types.store.StoreId;
}

export interface StoreFileListResult {
    store: Store;
    files: StoreFile[];
    count: number;
}

export type StoreFileListMyModel = StoreFileListModel
export type StoreFileListMyResult = StoreFileListResult

export interface StoreFileCreateModel {
    storeId: types.store.StoreId;
    requestId: types.request.RequestId;
    fileIndex: number;
    meta: types.store.StoreFileMeta;
    keyId: types.core.KeyId;
    thumbIndex?: number;
}

export interface StoreFileCreateResult {
    fileId: types.store.StoreFileId;
}

export interface StoreFileReadModel {
    fileId: types.store.StoreFileId;
    thumb: boolean;
    version?: types.store.StoreFileVersion;
    range: types.store.BufferReadRange;
}

export interface StoreFileReadResult {
    data: Buffer;
}

export interface StoreFileWriteModel {
    fileId: types.store.StoreFileId;
    requestId: types.request.RequestId;
    fileIndex: number;
    meta: types.store.StoreFileMeta;
    keyId: types.core.KeyId;
    thumbIndex?: number;
    version?: types.store.StoreFileVersion;
    force?: boolean;
}

export interface StoreFileUpdateModel {
    fileId: types.store.StoreFileId;
    meta: types.store.StoreFileMeta;
    keyId: types.core.KeyId;
    version?: types.store.StoreFileVersion;
    force?: boolean;
}

export interface StoreFileDeleteModel {
    fileId: types.store.StoreFileId;
}

export type StoreFileCreatedEvent = types.cloud.Event<"storeFileCreated", `store/${types.store.StoreId}/files`, StoreFileCreatedEventData>;
export type StoreFileCreatedEventData = StoreFile;

export type StoreFileUpdatedEvent = types.cloud.Event<"storeFileUpdated", `store/${types.store.StoreId}/files`, StoreFileUpdatedEventData>;
export type StoreFileUpdatedEventData = StoreFile;

export type StoreFileDeletedEvent = types.cloud.Event<"storeFileDeleted", `store/${types.store.StoreId}/files`, StoreFileDeletedEventData>;
export interface StoreFileDeletedEventData {
    id: types.store.StoreFileId;
    contextId: types.context.ContextId;
    storeId: types.store.StoreId;
}

export interface StoreSendCustomEventModel {
    storeId: types.store.StoreId;
    channel: types.core.WsChannelName;
    keyId: types.core.KeyId;
    data: unknown;
    users?: types.cloud.UserId[];
}

export interface IStoreApi {
    storeCreate(model: StoreCreateModel): Promise<StoreCreateResult>;
    storeUpdate(model: StoreUpdateModel): Promise<types.core.OK>;
    storeDelete(model: StoreDeleteModel): Promise<types.core.OK>;
    storeDeleteMany(model: StoreDeleteManyModel): Promise<StoreDeleteManyResult>;
    storeGet(model: StoreGetModel): Promise<StoreGetResult>;
    storeList(model: StoreListModel): Promise<StoreListResult>;
    storeListAll(model: StoreListAllModel): Promise<StoreListAllResult>
    storeFileGet(model: StoreFileGetModel): Promise<StoreFileGetResult>;
    storeFileGetMany(model: StoreFileGetManyModel): Promise<StoreFileGetManyResult>;
    storeFileList(model: StoreFileListModel): Promise<StoreFileListResult>;
    storeFileListMy(model: StoreFileListMyModel): Promise<StoreFileListMyResult>;
    storeFileCreate(model: StoreFileCreateModel): Promise<StoreFileCreateResult>;
    storeFileRead(model: StoreFileReadModel): Promise<StoreFileReadResult>;
    storeFileWrite(model: StoreFileWriteModel): Promise<types.core.OK>;
    storeFileUpdate(model: StoreFileUpdateModel): Promise<types.core.OK>;
    storeFileDelete(model: StoreFileDeleteModel): Promise<types.core.OK>;
    storeFileDeleteMany(model: StoreFileDeleteManyModel): Promise<StoreFileDeleteManyResult>;
    storeFileDeleteOlderThan(model: StoreFileDeleteOlderThanModel): Promise<StoreFileDeleteOlderThanResult>;
    storeSendCustomEvent(model: StoreSendCustomEventModel): Promise<types.core.OK>;
}
