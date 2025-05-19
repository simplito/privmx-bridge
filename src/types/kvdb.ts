/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export type KvdbId = string&{__kvdbId: never};
export type KvdbData = unknown;
export type KvdbVersion = number&{__kvdbVersion: never};
export type KvdbType = string&{__kvdbType: never};
export type KvdbEntryId = string&{__kvdbEntryId: never};
export type KvdbEntryKey = string&{__entryKey: never};
export type KvdbEntryValue = unknown;
export type KvdbEntryVersion = number&{__kvdbEntryVersion: never};

export interface KvdbDeleteStatus {
    id: KvdbId;
    status: "OK" | "KVDB_DOES_NOT_EXIST" | "ACCESS_DENIED";
}

export interface KvdbEntryDeleteStatus {
    kvdbEntryKey: KvdbEntryKey;
    status: "OK" | "KVDB_ENTRY_DOES_NOT_EXIST" | "ACCESS_DENIED";
}
