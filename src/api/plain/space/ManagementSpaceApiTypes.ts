/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import type { SpaceChangedEventData, SpaceDeletedEventData } from "../../main/context/ContextApiTypes";

/** What the bridge knows of a space in the clear. The wrapped keys and the private metadata stay with its recipients. */
export interface Space {
    /** Space's ID */
    id: types.space.SpaceId;
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Creator of the space */
    creator: types.cloud.UserId;
    /** Creation date */
    createDate: types.core.Timestamp;
    /** Last modification date */
    lastModificationDate: types.core.Timestamp;
    /** Groups the space's key is wrapped for, with the group epoch the current key was wrapped to */
    groups: {groupId: types.group.GroupId; role: types.cloud.ContainerRole; groupKeyVersion: number}[];
    /** Users the space's key is wrapped for */
    users: {userId: types.cloud.UserId; pubKey: types.cloud.UserPubKey; role: types.cloud.ContainerRole}[];
    /** Current version of the space's key: what a write has to have been made under */
    keyVersion: number;
    /** True when a recipient group has moved past the epoch the current key was wrapped to */
    keyIsStale: boolean;
    /** Public metadata, as the recipients wrote it */
    publicMeta: unknown;
}

export interface GetSpaceModel {
    /** Space's ID */
    spaceId: types.space.SpaceId;
}

export interface GetSpaceResult {
    /** Space */
    space: Space;
}

export interface ListSpacesModel extends types.core.ListModel {
    /** Context's ID */
    contextId: types.context.ContextId;
}

export interface ListSpacesResult {
    /** List of spaces */
    list: Space[];
    /** Number of all elements */
    count: number;
}

export interface DeleteSpaceModel {
    /** Space's ID */
    spaceId: types.space.SpaceId;
}

export interface SpaceCreatedEvent {
    channel: "space";
    type: "spaceCreated";
    data: SpaceChangedEventData;
    timestamp: types.core.Timestamp;
}

export interface SpaceUpdatedEvent {
    channel: "space";
    type: "spaceUpdated";
    data: SpaceChangedEventData;
    timestamp: types.core.Timestamp;
}

export interface SpaceDeletedEvent {
    channel: "space";
    type: "spaceDeleted";
    data: SpaceDeletedEventData;
    timestamp: types.core.Timestamp;
}

export type SpaceNotifyEvent = SpaceCreatedEvent|SpaceUpdatedEvent|SpaceDeletedEvent;

export interface ISpaceApi {
    
    /**
    * Fetches the space with given ID
    * @param model Space's ID
    * @returns Space's info
    */
    getSpace(model: GetSpaceModel): Promise<GetSpaceResult>;
    
    /**
    * Lists the spaces of given Context
    * @param model Context's ID
    * @returns List of spaces
    */
    listSpaces(model: ListSpacesModel): Promise<ListSpacesResult>;
    
    /**
    * Deletes the space with given ID
    * @param model Space's ID
    * @returns "OK"
    */
    deleteSpace(model: DeleteSpaceModel): Promise<types.core.OK>;
}
