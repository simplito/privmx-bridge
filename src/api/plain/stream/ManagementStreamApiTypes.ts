/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface GetStreamRoomModel {
    /** Stream room ID */
    streamRoomId: types.stream.StreamRoomId;
}

export interface GetStreamRoomResult {
    /** Stream room */
    streamRoom: StreamRoom;
}

export interface ListStreamRoomsModel extends types.core.ListModel2<types.stream.StreamRoomId> {
    /** Context's ID */
    contextId: types.context.ContextId;
}

export interface ListStreamRoomsResult {
    /** List of Stream rooms */
    list: StreamRoom[];
    /** Number of all elements */
    count: number;
}

export interface DeleteStreamRoomModel {
    /** Stream room ID */
    streamRoomId: types.stream.StreamRoomId;
}

export interface DeleteManyStreamRoomsModel {
    /** List of streamRooms to delete */
    streamRoomIds: types.stream.StreamRoomId[];
}

export interface DeleteManyStreamRoomsResult {
    /** List of deletions status */
    results: types.stream.StreamRoomDeleteStatus[];
}

export interface StreamRoom {
    /** Stream room ID */
    id: types.stream.StreamRoomId
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Creation date */
    createDate: types.core.Timestamp;
    /** Creator ID */
    creator: types.cloud.UserId;
    /** Last modification date */
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
    version: types.stream.StreamRoomVersion;
}

export interface StreamRoomDeletedData {
    /** StreamRoom's id */
    streamRoomId: types.stream.StreamRoomId
}

export interface StreamRoomCreatedEvent {
    channel: "stream";
    type: "streamRoomCreated";
    data: StreamRoom;
}

export interface StreamRoomUpdatedEvent {
    channel: "stream";
    type: "streamRoomUpdated";
    data: StreamRoom;
}

export interface StreamRoomDeletedEvent {
    channel: "stream";
    type: "streamRoomDeleted";
    data: StreamRoomDeletedData;
}

export type StreamNotifyEvent = StreamRoomCreatedEvent|StreamRoomUpdatedEvent|StreamRoomDeletedEvent;

export interface IStreamApi {
    /**
    * Fetches stream room with given ID
    * @param model Context's ID, stream room's ID
    * @returns stream room's info
    */
    getStreamRoom(model: GetStreamRoomModel): Promise<GetStreamRoomResult>;

    /**
     * List stream rooms in given Context
     * @param model stream rooms's ID
     * @returns List of stream rooms
     */
    listStreamRooms(model: ListStreamRoomsModel): Promise<ListStreamRoomsResult>;

    /**
     * Deletes stream room
     * @param model Context's ID, stream room's ID
     * @returns "OK"
     */
    deleteStreamRoom(model: DeleteStreamRoomModel): Promise<types.core.OK>;

    /**
     * Deletes given stream rooms, requires that they belong to the same Context
     * @param model Context's ID, List of stream rooms IDs
     * @returns List of ID and status for every deletion attempt
     */
    deleteManyStreamRooms(model: DeleteManyStreamRoomsModel): Promise<DeleteManyStreamRoomsResult>;
}