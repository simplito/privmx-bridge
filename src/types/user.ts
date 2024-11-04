/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type DeviceTokenId = string&{__deviceTokenId: never};
export type PluginName = string&{__pluginName: never};
export type UserLogin = types.core.Username|types.core.Email;
export type UserType = "local"|"basic";
export type UsersGroupId = string&{__usersGroupId: never};
export type SessionUserType = UserType|"guest"|"ecdhe";
export interface UserRightsMap {
    basic: boolean;
    normal: boolean;
    admin: boolean;
    private_section_allowed: boolean;
    usergroup_sections_manager: boolean;
    regular_sections_manager: boolean;
    all_users_lookup: boolean;
}
export type UserRight = keyof(UserRightsMap);
export interface SubidentityAcl {
    group: UsersGroupId;
}
export type PasswordHint = string&{__passwordHint: never};
export type SrpParams = types.core.Json<{
    hint?: PasswordHint;
    algorithm: types.core.PasswordMixAlgorithm;
    hash: types.core.HashAlgorithm;
    length: number;
    rounds: number;
    salt: types.core.Base64;
    version: number;
}>;
export type VersionStr = string&{__versionStr: never};

export interface SrpInfo {
    N: types.core.Hex;
    g: types.core.Hex;
}

export interface LoginProperties {
    appVersion: VersionStr;
    sysVersion: VersionStr;
    deviceId: types.core.DeviceId;
    deviceName: types.core.DeviceName;
    osName: types.core.OsName;
    deviceToken: DeviceTokenId;
    unregisteredSession: string;
}
