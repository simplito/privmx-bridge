/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type ThreadId = string&{__threadId: never};
export type ThreadMessageId = string&{__threadMessageId: never};
export type ThreadMessageData = unknown;
export type ThreadData = unknown;
export type ThreadVersion = number&{__threadVersion: never};
export type ThreadType = string&{__threadType: never};
export type ThreadMessageVersion = number&{__threadMessageVersion: never};

export interface ThreadMessageUpdate {
    createDate: types.core.Timestamp;
    author: types.cloud.UserId;
}

export interface ThreadDeleteStatus {
    id: ThreadId;
    status: "OK" | "THREAD_DOES_NOT_EXIST" | "ACCESS_DENIED" | "THREAD_BELONGS_TO_INBOX";
}

export interface ThreadMessageDeleteStatus {
    id: ThreadMessageId;
    status: "OK" | "THREAD_MESSAGE_DOES_NOT_EXIST" | "ACCESS_DENIED";
}
