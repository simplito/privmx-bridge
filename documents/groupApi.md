<!-- ⚠️ ORIGINAL DRAFT SKETCH — not the implemented design. Kept for history. The real contract is in
     documents/plan/02-bridge-api-contract.md and the phase dirs. Notable divergences decided since:
     • the standalone `group.` namespace was folded into ContextApi (context.group*);
     • `modifyGroupMembers` (delta) is DEFERRED — membership change is full-replace groupUpdate (plan/08);
     • the bridge does NOT sign/verify; membership integrity is in the endpoint DIO inside `data`
       (GroupMembershipSignature was dropped — plan/10 §3b). -->

``` js
export type GroupData = unknown;
export type GroupKeyData = Base64&{__groupKeyData: never};

export interface GroupKeyEntry {
    groupPubKey: types.cloud.GroupPubKey;
    data: GroupKeyData;
}

export interface GroupKeyEntrySet {
    user: UserId;
    groupPubKey: types.cloud.GroupPubKey;
    data: GroupKeyData;
}

export interface GroupCreateModel {
    contextId: types.context.ContextId;
    groupPubKey: types.cloud.GroupPubKey;
    resourceId: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.group.GroupData;
    keys: GroupKeyEntrySet[];
}

export interface GroupUpdateModel {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    resourceId: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.group.GroupData;
    keys: GroupKeyEntrySet[];
    version: types.group.GropuVersion;
    force: boolean;
}

export interface GroupCreateResult {
    groupId: types.group.GroupId;
}

export interface GroupDeleteModel {
    groupId: types.group.GroupId;
}

export interface GroupGetModel {
    groupId: types.group.GroupId;
}

export interface GroupGetResult {
    group: GroupInfo;
}

export interface GroupListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    scope?: types.core.ContainerAccessScope;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface GroupListResult {
    groups: GroupInfo[];
    count: number;
}

export interface GroupDataEntry {
    groupPubKey: types.cloud.GroupPubKey;
    data: types.group.GroupData;
}

export interface GroupInfo {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    contextId: types.context.ContextId;
    resourceId: types.core.ClientResourceId;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: GroupDataEntry[];
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.GroupKeyEntry[];
    version: types.group.GroupVersion;
}

export interface IGroupApi {
    groupCreate(model: GroupCreateModel): Promise<GroupCreateResult>;
    groupUpdate(model: GroupUpdateModel): Promise<types.core.OK>;
    groupDelete(model: GroupDeleteModel): Promise<types.core.OK>;
    groupGet(model: GroupGetModel): Promise<GroupGetResult>;
    groupList(model: GroupListModel): Promise<GroupListResult>;
}
```

```cpp
#ifndef _PRIVMXLIB_ENDPOINT_GROUP_GROUPAPI_HPP_
#define _PRIVMXLIB_ENDPOINT_GROUP_GROUPAPI_HPP_

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "privmx/endpoint/core/Connection.hpp"
#include "privmx/endpoint/core/Types.hpp"
#include "privmx/endpoint/group/Types.hpp"
#include <privmx/endpoint/core/ExtendedPointer.hpp>

namespace privmx {
namespace endpoint {
namespace group {

class GroupApiImpl;

/**
 * 'GroupApi' is a class representing Endpoint's API for user groups.
 */
class GroupApi : public privmx::endpoint::core::ExtendedPointer<GroupApiImpl>  {
public:
    /**
     * Creates an instance of 'GroupApi'.
     * 
     * @param connection instance of 'Connection'
     * 
     * @return GroupApi object
     */
    static GroupApi create(core::Connection& connetion);

    /**
     * //doc-gen:ignore
     */
    GroupApi();
    GroupApi(const GroupApi& obj);
    GroupApi& operator=(const GroupApi& obj);
    GroupApi(GroupApi&& obj);
    ~GroupApi();

    /**
     * Creates a new group in given Context.
     *
     * @param contextId ID of the Context to create the group in
     * @param users vector of UserWithPubKey structs which indicates who will have access to the created group and its resources
     * @param managers vector of UserWithPubKey structs which indicates who will have access (and management rights) to
     * the created group and its resources
     * @param publicMeta public (unencrypted) metadata
     * @param privateMeta private (encrypted) metadata
     * @return ID of the created group
     */
    std::string createGroup(const std::string& contextId, const std::vector<core::UserWithPubKey>& users,
                             const std::vector<core::UserWithPubKey>& managers, const core::Buffer& publicMeta, 
                             const core::Buffer& privateMeta);
    
    /**
     * Updates an existing group.
     *
     * @param groupId ID of the group to update
     * @param publicMeta public (unencrypted) metadata
     * @param privateMeta private (encrypted) metadata
     * @param version current version of the group
     * @param force force update (without checking version)
     */
    void updateGroup(const std::string& groupId, const core::Buffer& publicMeta, const core::Buffer& privateMeta,
                      const int64_t version, const bool force);

    /**
     * Modifies the group's membership by adding and removing specific users.
     * 
     * This is a partial update (delta). Users provided in usersToAddOrUpdate or managersToAddOrUpdate will be 
     * granted access, while users in usersToRemove or managersToRemove will have their access revoked.
     * Existing members not mentioned in either list remain unaffected.
     * 
     * @param groupId ID of the group to be modified
     * @param usersToAddOrUpdate list of users as UserWithPubKey to be added or, if already present, updated within the group
     * @param usersToRemove list of users as ID to be removed from the group, ignored if the user is not a user member
     * @param managersToAddOrUpdate list of managers as UserWithPubKey to be added or, if already present, updated within the group
     * @param managersToRemove list of managers as ID to be removed from the group, ignored if the user is not a manager member
     */
    void modifyGroupMembers(const std::string& groupId,
        const std::vector<core::UserWithPubKey>& usersToAddOrUpdate, const std::vector<std::string>& usersToRemove,
        const std::vector<core::UserWithPubKey>& managersToAddOrUpdate, const std::vector<std::string>& managersToRemove);

    /**
     * Deletes a group by given group ID.
     *
     * @param groupId ID of the group to delete
     */
    void deleteGroup(const std::string& groupId);

    /**
     * Gets a group by given group ID.
     *
     * @param groupId ID of group to get
     * @return `Group` struct containing info about the group
     */
    Group getGroup(const std::string& groupId);

    /**
     * Gets a list of group in given Context.
     *
     * @param contextId ID of the Context to get the groups from
     * @param pagingQuery struct with list query parameters
     * @return struct containing a list of groups
     */
    core::PagingList<Group> listGroups(const std::string& contextId, const core::PagingQuery& pagingQuery);

private:
    GroupApi(const std::shared_ptr<GroupApiImpl>& impl);
};

}  // namespace group
}  // namespace endpoint
}  // namespace privmx

#endif  // _PRIVMXLIB_ENDPOINT_GROUP_GROUPAPI_HPP_
```