/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface StreamRoom {
    id: types.stream.StreamRoomId
    contextId: types.context.ContextId;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: types.stream.StreamRoomDataEntry[];
    keyId: types.core.KeyId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.stream.StreamRoomVersion;
    type?: types.stream.StreamRoomType;
    policy: types.cloud.ContainerWithoutItemPolicy;
}

export interface StreamRoomCreateModel {
    contextId: types.context.ContextId;
    type?: types.stream.StreamRoomType;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.stream.StreamRoomData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerWithoutItemPolicy;
}

export interface StreamRoomCreateResult {
    streamRoomId: types.stream.StreamRoomId;
}

export interface StreamRoomUpdateModel {
    id: types.stream.StreamRoomId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.stream.StreamRoomData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.stream.StreamRoomVersion;
    force: boolean;
    policy?: types.cloud.ContainerWithoutItemPolicy;
}

export interface StreamRoomDeleteModel {
    id: types.stream.StreamRoomId;
}

export interface StreamRoomDeleteManyModel {
    ids: types.stream.StreamRoomId[];
}

export interface StreamRoomGetModel {
    id: types.stream.StreamRoomId;
    type?: types.stream.StreamRoomType;
}

export interface StreamRoomGetResult {
    streamRoom: StreamRoom;
}

export interface SteramRoomDeleteManyResult {
    results: types.stream.StreamRoomDeleteStatus[];
}

export interface StreamRoomListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.stream.StreamRoomType;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface  StreamRoomListAllModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.stream.StreamRoomType;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface StreamRoomListResult {
    list: StreamRoom[];
    count: number;
}

export type StreamRoomListAllResult = StreamRoomListResult;

export type StreamRoomCreatedEvent = types.cloud.Event<"streamRoomCreated", "stream", StreamRoomCreatedEventData>;
export type StreamRoomCreatedEventData = StreamRoom;

export type StreamRoomUpdatedEvent = types.cloud.Event<"streamRoomUpdated", "stream", StreamRoomUpdatedEventData>;
export type StreamRoomUpdatedEventData = StreamRoom;

export type StreamRoomDeletedEvent = types.cloud.Event<"streamRoomDeleted", "stream", StreamRoomDeletedEventData>;
export interface StreamRoomDeletedEventData {
    streamRoomId: types.stream.StreamRoomId;
    type: types.stream.StreamRoomType;
}

export interface IStreamApi {
    streamRoomCreate(model: StreamRoomCreateModel): Promise<StreamRoomCreateResult>;
    streamRoomUpdate(model: StreamRoomUpdateModel): Promise<types.core.OK>;
    streamRoomDelete(model: StreamRoomDeleteModel): Promise<types.core.OK>;
    streamRoomDeleteMany(model: StreamRoomDeleteManyModel): Promise<SteramRoomDeleteManyResult>;
    streamRoomGet(model: StreamRoomGetModel): Promise<StreamRoomGetResult>;
    streamRoomList(model: StreamRoomListModel): Promise<StreamRoomListResult>;
    streamRoomListAll(model: StreamRoomListAllModel): Promise<StreamRoomListAllResult>;
}
