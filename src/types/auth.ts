/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export type ApiAccessToken = string&{__apiAccessToken: never};
export type ApiRefreshToken = string&{__apiRefreshToken: never};
export type Scope = string&{__scope: never};
export type ApiKeyId = string&{__apiKeyId: never};
export type ApiKeySecret = string&{__apiKeySecret: never};
export type ApiKeyName = string&{__apiKeyName: never};
export type ApiUserId = string&{__userId: never};
export type InitializationToken = string&{__initializationToken: never};
