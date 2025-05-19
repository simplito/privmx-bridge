/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type StoreId = string&{__storeId: never};
export type StoreFileId = string&{__storeFileId: never};
export type StoreData = unknown;
export type StoreVersion = number&{__storeVersion: never};
export type StoreType = string&{__storeType: never};
export type StoreFileMeta = unknown;
export type StoreFileVersion = number&{__storeFileVersion: never};

export interface StoreFileUpdate {
    createDate: types.core.Timestamp;
    author: types.cloud.UserId;
}

export interface StoreDeleteStatus {
    id: StoreId;
    status: "OK" | "ACCESS_DENIED" | "STORE_DOES_NOT_EXIST" | "STORE_BELONGS_TO_INBOX";
}

export interface StoreFileDeleteStatus {
    id: types.store.StoreFileId;
    status: "OK" | "STORE_FILE_DOES_NOT_EXIST" | "ACCESS_DENIED" | "STORE_DOES_NOT_EXIST";
}

export type BufferReadRange = {
    type: "all";
}|{
    type: "slice";
    from: number;
    to: number;
}|{
    type: "checksum";
};

export interface StoreFileRandomWriteOperation {
    type: "file"|"checksum";
    pos: number;
    data: Buffer;
    truncate: boolean;
}

export interface StoreFileFetchError {
    id: types.store.StoreFileId;
    error: {code: number; message: string;};
}

