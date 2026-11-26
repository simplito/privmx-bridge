/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import type { GroupChangedEventData, GroupDeletedEventData } from "../../main/context/ContextApiTypes";

export interface GroupMember {
    /** User's ID */
    userId: types.cloud.UserId;
    /** User's public key in the Context, null when the user is no longer in the Context */
    pubKey: types.cloud.UserPubKey|null;
    /** User's role in the group */
    role: types.cloud.ContainerRole;
}

/** What the bridge knows of a group in the clear. The private metadata and every key stay with the members. */
export interface Group {
    /** Group's ID */
    id: types.group.GroupId;
    /** Context's ID */
    contextId: types.context.ContextId;
    /** Creator of the group */
    creator: types.cloud.UserId;
    /** Creation date */
    createDate: types.core.Timestamp;
    /** Last modification date */
    lastModificationDate: types.core.Timestamp;
    /** Current epoch of the group's key: what a write has to have been made under */
    keyVersion: number;
    /** Moves with every change of members, roles or key */
    rosterVersion: number;
    /** Number of the group's latest signed statement */
    lastCommitSeq: number;
    /** Members with their roles */
    members: GroupMember[];
    /** The group's signed rules: who may do what to the group (see `types.cloud.GroupRules`); absent for a group
     *  stored before the rules format */
    rules?: types.cloud.GroupRules;
    /** Who beside the members may read the group's key and roster */
    visibleTo: "members"|"context";
    /** Public metadata, as the members wrote it */
    publicMeta: unknown;
}

export interface GetGroupModel {
    /** Group's ID */
    groupId: types.group.GroupId;
}

export interface GetGroupResult {
    /** Group */
    group: Group;
}

export interface ListGroupsModel extends types.core.ListModel {
    /** Context's ID */
    contextId: types.context.ContextId;
}

export interface ListGroupsResult {
    /** List of groups */
    list: Group[];
    /** Number of all elements */
    count: number;
}

export interface ListGroupsOfUserModel extends types.core.ListModel {
    /** Context's ID */
    contextId: types.context.ContextId;
    /** User's ID */
    userId: types.cloud.UserId;
}

export interface GroupOfUser {
    /** Group's ID */
    groupId: types.group.GroupId;
    /** User's role in the group */
    role: types.cloud.ContainerRole;
    /** True when the user is the group's only manager */
    isLastManager: boolean;
}

export interface ListGroupsOfUserResult {
    /** Groups the user belongs to */
    list: GroupOfUser[];
    /** Number of all elements */
    count: number;
}

export interface ListGroupCommitsModel {
    /** Group's ID */
    groupId: types.group.GroupId;
    /** Statements after this number are returned; 0 starts at the group's creation */
    fromSeq: number;
    /** Maximal number of statements */
    limit: number;
}

export interface ListGroupCommitsResult {
    /** Signed statements, in order */
    commits: types.cloud.GroupTreeCommitStatement[];
}

export interface DeleteGroupModel {
    /** Group's ID */
    groupId: types.group.GroupId;
}

export interface CutHistoryModel {
    /** Group's ID */
    groupId: types.group.GroupId;
    /** Epoch to cut below; defaults to the group's current epoch. Clamped down to the lowest epoch still needed. */
    beforeEpoch?: number;
}

export interface CutHistoryResult {
    /** The group's era floor afterwards: everything below it is deleted */
    eraFloor: number;
    /** What held the floor below the requested epoch, if anything: a metadata plane, or a Space */
    clampedBy?: "metadata"|"space";
    /** With clampedBy "space": the Space that holds the group at the lowest epoch */
    spaceId?: types.space.SpaceId;
}

export interface DeleteManyGroupsModel {
    /** List of groups to delete */
    groupIds: types.group.GroupId[];
}

export interface GroupDeleteStatus {
    /** Group's ID */
    id: types.group.GroupId;
    /** Status */
    status: "OK"|"GROUP_DOES_NOT_EXIST"|"ACCESS_DENIED"|"GROUP_IN_USE";
}

export interface DeleteManyGroupsResult {
    /** List of deletions status */
    results: GroupDeleteStatus[];
}

export interface GroupCreatedEvent {
    channel: "group";
    type: "groupCreated";
    data: GroupChangedEventData;
    timestamp: types.core.Timestamp;
}

export interface GroupUpdatedEvent {
    channel: "group";
    type: "groupUpdated";
    data: GroupChangedEventData;
    timestamp: types.core.Timestamp;
}

export interface GroupDeletedEvent {
    channel: "group";
    type: "groupDeleted";
    data: GroupDeletedEventData;
    timestamp: types.core.Timestamp;
}

export type GroupNotifyEvent = GroupCreatedEvent|GroupUpdatedEvent|GroupDeletedEvent;

export interface IGroupApi {
    
    /**
    * Fetches the group with given ID
    * @param model Group's ID
    * @returns Group's info
    */
    getGroup(model: GetGroupModel): Promise<GetGroupResult>;
    
    /**
    * Lists the groups of given Context
    * @param model Context's ID
    * @returns List of groups
    */
    listGroups(model: ListGroupsModel): Promise<ListGroupsResult>;
    
    /**
    * Lists the groups of given Context a user belongs to
    * @param model Context's ID, user's ID
    * @returns List of group IDs with the user's role in each
    */
    listGroupsOfUser(model: ListGroupsOfUserModel): Promise<ListGroupsOfUserResult>;
    
    /**
    * Lists the signed statements of a group: its creation and every change of members, roles, rules and key
    * @param model Group's ID, the statement to start after, limit
    * @returns List of statements
    */
    listGroupCommits(model: ListGroupCommitsModel): Promise<ListGroupCommitsResult>;
    
    /**
    * Deletes a group's history below an epoch: raises its era floor and deletes the archive rungs and epoch keys
    * below it, so members cannot reach those epochs any more. Does not rotate (the server holds no keys), so the
    * floor is at most the current epoch, and it is clamped down to the lowest epoch still needed: each metadata
    * plane's and every Space's that holds the group. A floor is never lowered; when nothing changes this is a
    * no-op. Members get a groupUpdated event with changeKind "eraCut". Meant for a periodic retention job.
    * @param model Group's ID, optional epoch to cut below (default: the current epoch)
    * @returns The effective era floor
    */
    cutHistory(model: CutHistoryModel): Promise<CutHistoryResult>;
    
    /**
    * Deletes the group with given ID
    * @param model Group's ID
    * @returns "OK"
    */
    deleteGroup(model: DeleteGroupModel): Promise<types.core.OK>;
    
    /**
    * Deletes given groups
    * @param model List of group IDs
    * @returns List of ID and status for every deletion attempt
    */
    deleteManyGroups(model: DeleteManyGroupsModel): Promise<DeleteManyGroupsResult>;
}
