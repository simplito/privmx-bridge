/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type GroupId = string&{__groupId: never};
export type GroupData = unknown;
export type GroupVersion = number&{__groupVersion: never};
export type GroupType = string&{__groupType: never};

export type GroupSignatureOp = "create"|"update"|"modifyMembers";

export interface GroupMembersDelta {
    usersAdded: types.cloud.UserId[];
    usersRemoved: types.cloud.UserId[];
    managersAdded: types.cloud.UserId[];
    managersRemoved: types.cloud.UserId[];
}

export interface GroupDeleteStatus {
    id: GroupId;
    status: "OK"|"GROUP_DOES_NOT_EXIST"|"ACCESS_DENIED"|"GROUP_IN_USE";
}
