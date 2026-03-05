/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type StreamRoomId = string&{__streamRoomId: never};
export type StreamRoomData = unknown;
export type StreamRoomVersion = number&{__streamRoomVersion: never};
export type StreamRoomType = string&{__streamRoomType: never};
export type SessionId = number & {_sessionId: never};
export type StreamId = number & {__streamId: never};
export type StreamTrackId = string & {__streamTrackId: never};

export interface StreamRoomDeleteStatus {
    id: StreamRoomId;
    status: "OK" | "STREAM_ROOM_DOES_NOT_EXIST" | "ACCESS_DENIED";
}

export interface StreamRoomDataEntry {
    keyId: types.core.KeyId;
    data: StreamRoomData;
}

