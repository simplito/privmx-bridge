/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type ResourceId = string&{__resourceId: never};
export type ResourceType = string&{__resourceType: never};
export type ResourceProps = types.core.ObjectMap<string, unknown>;
export type ResourceStats = types.core.ObjectMap<ResourceType, ResourceStatEntry>;
export type ResourceAcl = EmbeddedResourceAcl|RefResourceAcl;

export interface EmbeddedResourceAcl {
    type: "embedded";
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.cloud.UserKeysEntry[];
}

export interface RefResourceAcl {
    type: "ref";
    ref: ResourceId;
}

export interface ResourceHistoryEntry {
    created: types.core.Timestamp;
    author: types.cloud.UserId;
    keyId: types.core.KeyId;
    props: ResourceProps;
}

export interface ResourceStatEntry {
    count: number;
    lastDate: types.core.Timestamp;
}
