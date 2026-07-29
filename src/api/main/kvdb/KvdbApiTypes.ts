/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface KvdbCreateModel {
    resourceId: types.core.ClientResourceId;
    type?: types.kvdb.KvdbType;
    contextId: types.context.ContextId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.kvdb.KvdbData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerPolicy;
}

export interface KvdbUpdateModel {
    id: types.kvdb.KvdbId;
    resourceId: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.kvdb.KvdbData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.kvdb.KvdbVersion;
    force: boolean;
    policy?: types.cloud.ContainerPolicy;
}

export interface KvdbDeleteModel {
    kvdbId: types.kvdb.KvdbId;
}

export interface KvdbDeleteManyModel {
    kvdbIds: types.kvdb.KvdbId[];
}

export interface KvdbCreateResult {
    kvdbId: types.kvdb.KvdbId;
}

export interface KvdbDeleteManyResult {
    results: types.kvdb.KvdbDeleteStatus[];
}

export interface KvdbInfo {
    id: types.kvdb.KvdbId;
    resourceId: types.core.ClientResourceId;
    contextId: types.context.ContextId;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: KvdbDataEntry[];
    keyId: types.core.KeyId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.kvdb.KvdbVersion;
    type?: types.kvdb.KvdbType;
    policy: types.cloud.ContainerPolicy;
    entries: number;
    lastEntryDate: types.core.Timestamp
}

export interface KvdbDataEntry {
    keyId: types.core.KeyId;
    data: types.kvdb.KvdbData;
}

export interface KvdbEntryInfo {
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
    kvdbEntryValue: types.kvdb.KvdbEntryValue;
    kvdbId: types.kvdb.KvdbId;
    version: types.kvdb.KvdbEntryVersion;
    contextId: types.context.ContextId;
    createDate: types.core.Timestamp;
    author: types.cloud.UserId;
    keyId: types.core.KeyId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
}

export type KvdbCreatedEvent = types.cloud.Event<"kvdbCreated", "kvdb", KvdbCreatedEventData>;
export type KvdbCreatedEventData = KvdbInfo;

export type KvdbUpdatedEvent = types.cloud.Event<"kvdbUpdated", "kvdb", KvdbUpdatedEventData>;
export type KvdbUpdatedEventData = KvdbInfo;

export type KvdbDeletedEvent = types.cloud.Event<"kvdbDeleted", "kvdb", KvdbDeletedEventData>;
export interface KvdbDeletedEventData {
    kvdbId: types.kvdb.KvdbId;
    type?: types.kvdb.KvdbType;
}

export type KvdbCustomEvent = types.cloud.Event<"custom", `kvdb/${types.kvdb.KvdbId}/${types.core.WsChannelName}`, KvdbCustomEventData>;

export type KvdbEntryEventData = KvdbEntryInfo&{containerType?: types.kvdb.KvdbType};

export type KvdbNewEntryEvent = types.cloud.Event<"kvdbNewEntry", `kvdb/${types.kvdb.KvdbId}/entries`, KvdbNewEntryEventData>;
export type KvdbNewEntryEventData = KvdbEntryEventData;

export type KvdbUpdatedEntryEvent = types.cloud.Event<"kvdbUpdatedEntry", `kvdb/${types.kvdb.KvdbId}/entries`, KvdbUpdatedEntryEventData>;
export type KvdbUpdatedEntryEventData = KvdbEntryEventData;

export type KvdbDeletedEntryEvent = types.cloud.Event<"kvdbDeletedEntry", `kvdb/${types.kvdb.KvdbId}/entries`, KvdbDeletedEntryEventData>;

export interface KvdbDeletedEntryEventData {
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
    kvdbId: types.kvdb.KvdbId;
    containerType?: types.kvdb.KvdbType
}

export interface KvdbCollectionChangedEventData {
    containerId: types.kvdb.KvdbId;
    affectedItemsCount: number;
    containerType?: types.kvdb.KvdbType;
    items: {
        itemId: types.kvdb.KvdbEntryId;
        action: types.core.CRUDAction;
    }[]
}

export type KvdbCollectionChangedEvent = types.cloud.Event<"kvdbCollectionChanged", "kvdb/collectionChanged", KvdbCollectionChangedEventData>

export type KvdbStatsEvent = types.cloud.Event<"kvdbStats", "kvdb", KvdbStatsEventData>;
export interface KvdbStatsEventData {
    kvdbId: types.kvdb.KvdbId;
    contextId: types.context.ContextId;
    type?: types.kvdb.KvdbType;
    lastEntryDate: types.core.Timestamp;
    entries: number;
}

export interface KvdbCustomEventData {
    id: types.kvdb.KvdbId;
    keyId: types.core.KeyId;
    eventData: unknown;
    author: types.cloud.UserIdentity;
};

export interface KvdbGetModel {
    kvdbId: types.kvdb.KvdbId;
    type?: types.kvdb.KvdbType;
}

export interface KvdbGetResult {
    kvdb: KvdbInfo;
}

export interface KvdbListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    scope?: types.core.ContainerAccessScope;
    type?: types.kvdb.KvdbType;
    sortBy?: "createDate"|"lastEntryDate"|"lastModificationDate";
}

export interface KvdbListResult {
    kvdbs: KvdbInfo[];
    count: number;
}

export interface KvdbListAllModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.kvdb.KvdbType;
    sortBy?: "createDate";
}

export interface KvdbEntryGetModel {
    kvdbId: types.kvdb.KvdbId;
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
}

export interface KvdbEntrySetModel {
    kvdbId: types.kvdb.KvdbId;
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
    kvdbEntryValue: types.kvdb.KvdbEntryValue;
    keyId: types.core.KeyId;
    version?: types.kvdb.KvdbEntryVersion;
    force?: boolean;
}

export interface KvdbEntryDeleteModel {
    kvdbId: types.kvdb.KvdbId;
    kvdbEntryKey: types.kvdb.KvdbEntryKey;
}

export interface KvdbEntryGetResult {
    kvdbEntry: KvdbEntryInfo;
}

export type KvdbListAllResult = KvdbListResult;

export interface KvdbListKeysModel extends types.core.ListModel {
    kvdbId: types.kvdb.KvdbId;
    sortBy?: "createDate"|"entryKey"|"lastModificationDate";
}

export interface KvdbListKeysResult {
    kvdb: KvdbInfo;
    kvdbEntryKeys: types.kvdb.KvdbEntryKey[];
    count: number;
}

export interface KvdbListEntriesModel extends types.core.ListModel {
    kvdbId: types.kvdb.KvdbId;
    sortBy?: "createDate"|"entryKey"|"lastModificationDate";
}

export interface KvdbListItemsResult {
    kvdb: KvdbInfo;
    kvdbEntries: KvdbEntryInfo[];
    count: number;
}

export interface KvdbEntryDeleteManyModel {
    kvdbId: types.kvdb.KvdbId;
    kvdbEntryKeys: types.kvdb.KvdbEntryKey[];
}

export interface KvdbEntryDeleteManyResult {
    results: types.kvdb.KvdbEntryDeleteStatus[];
}

export interface IKvdbApi {
    kvdbCreate(model: KvdbCreateModel): Promise<KvdbCreateResult>;
    kvdbUpdate(model: KvdbUpdateModel): Promise<types.core.OK>;
    kvdbDelete(model: KvdbDeleteModel): Promise<types.core.OK>;
    kvdbDeleteMany(model: KvdbDeleteManyModel): Promise<KvdbDeleteManyResult>;
    kvdbGet(model: KvdbGetModel): Promise<KvdbGetResult>;
    kvdbList(model: KvdbListModel): Promise<KvdbListResult>;
    kvdbListAll(model: KvdbListAllModel): Promise<KvdbListAllResult>;
    kvdbEntryGet(model: KvdbEntryGetModel): Promise<KvdbEntryGetResult>;
    kvdbEntrySet(model: KvdbEntrySetModel): Promise<types.core.OK>;
    kvdbEntryDelete(model: KvdbEntryDeleteModel): Promise<types.core.OK>;
    kvdbListKeys(model: KvdbListKeysModel): Promise<KvdbListKeysResult>;
    kvdbListEntries(model: KvdbListEntriesModel): Promise<KvdbListItemsResult>;
    kvdbEntryDeleteMany(model: KvdbEntryDeleteManyModel): Promise<KvdbEntryDeleteManyResult>;
}
