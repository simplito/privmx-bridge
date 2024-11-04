/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type InboxId = string&{__inboxId: never};
export type InboxMeta = unknown;
export type InboxPublicData = unknown;
export type InboxVersion = number&{__inboxVersion: never};
export type InboxType = string&{__inboxType: never};

export interface InboxData {
    threadId: types.thread.ThreadId;
    storeId: types.store.StoreId;
    fileConfig: InboxFileConfig;
    meta: InboxMeta;
    publicData: InboxPublicData;
}

export interface InboxFileConfig {
    minCount: number;
    maxCount: number;
    maxFileSize: number;
    maxWholeUploadSize: number;
}

export interface InboxDeleteStatus {
    id: types.inbox.InboxId;
    status: "OK" | "INBOX_DOES_NOT_EXIST" | "ACCESS_DENIED";
}
