/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type ObjectMap<_K extends string|number, V> = {[key: string]: V};
export type Hex = string&{__hex: never};
export type Base64 = string&{__base64: never};
export type Base58 = string&{__base58: never};
export type EccAddress = Base58&{__eccAddress: never};
export type EccPubKey = Base58&{__eccPubKey: never};
export type EccWif = Base58&{__eccWif: never};
export type EccSignature = Base64&{__eccSignature: never};
export type EccPubKeyPEM = string&{__eccPubKeyPEM: never};
export type Timespan = number&{__timespan: never}; // number of elapsed milliseconds
export type TimestampStr = string&{__timestampStr: never}; // number of milliseconds since UNIX epoch as string
export type Timestamp = number&{__timestamp: never}; // number of milliseconds since UNIX epoch as number
export type Username = string&{__username: never};
export type Client = Username|EccPubKey;
export type Hashmail = string&{__hashmail: never};
export type Host = string&{__host: never};
export type Email = string&{__email: never};
export type Nonce = string&{__nonce: never};
export type OK = "OK";
export type ErrorCode = number&{__errorCode: never};
export type ErrorMessage = string&{__errorMessage: never};
export type Json<T = any> = string&{__json: never;__jsonFakeValue: T};
export type Mimetype = string&{__mimeType: never};
export type DeviceId = string&{__deviceId: never};
export type DeviceName = string&{__deviceName: never};
export type OsName = string&{__osName: never};
export type Url = string&{__url: never};
export type IPAddress = string&{__ipAddress: never};
export type Version = string&{__version: never};
export type DataUrl = string&{__dataUrl: never};
export type UrlLike = Url|DataUrl;
export type HashAlgorithm = string&{__hashAlgorithm: never};
export type PasswordMixAlgorithm = string&{__passwordMixAlgorithm: never};
export type Relation = "HIGHER"|"HIGHER_EQUAL"|"LOWER"|"LOWER_EQUAL"|"EQUAL"|"NOT_EQUAL";
export type SessionId = Hex&{__sessionId: never};
export type WsId = Hex&{__wsId: never};
export type WsChannelId = number&{__wsChannelId: never};
export type ServerSessionId = Hex&{__serverSessionId: never};
export type UserAgent = string&{__userAgent: never};
export type KeyId = string&{__keyId: never};
export type SizeInBytes = number&{__sizeInBytes: never};
export type UserKeyData = Base64&{__userKeyData: never};
export type EncryptionKey = Hex&{__encryptionKey: never};
export type WsConnectionId = string&{__wsConnectionId: never};
export type Quantity = number&{__quantity: never};
export type WsChannelName = string&{__customChannelName: never};
export type Query = {$and: Query[]} | {$or: Query[]} | {$nor: Query[]} | PropertiesQuery;
export type SubscriptionId = string&{__subscriptionId: never};
export type ClientResourceId = string&{__clientResourceId: never};
export type CRUDAction = "create"|"update"|"delete";
export type ContainerWithItems = "thread"|"store"|"kvdb";
export type PropertiesQuery = Record<string, PropertyQuery>;
export type ContainerAccessScope = "ALL"|"MANAGER"|"USER"|"MEMBER"|"OWNER";

export type PropertyQuery = Value | {
    $gt?: number;
    $gte?: number;
    $lt?: number;
    $lte?: number;
    $exists?: boolean;
    $eq?: Value;
    $ne?: Value;
    $in?: Value[];
    $nin?: Value[];
    $startsWith?: string;
    $endsWith?: string;
    $contains?: string;
};

export type Value = string|number|boolean|null;

export interface ApiError {
    msg: string;
    data: {
        error: {
            code: number;
            data?: any;
        }
    };
}
export type SortOrder = "desc"|"asc";
export interface KeyEntry {
    keyId: KeyId;
    data: UserKeyData;
}
export interface ListModel {
    skip: number;
    limit: number;
    sortOrder: SortOrder;
    lastId?: string;
    query?: Query;
}

export interface ListModel2<T> {
    from: T|null;
    limit: number;
    sortOrder: SortOrder;
}
export interface Subscription {
    subscriptionId: SubscriptionId;
    channel: WsChannelName;
}
export interface Event<T extends string, D> {
    type: T;
    data: D;
    subscriptions?: SubscriptionId[];
    version?: number;
}
