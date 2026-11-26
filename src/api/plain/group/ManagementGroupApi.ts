/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementBaseApi } from "../../../api/ManagementBaseApi";
import * as managementGroupApi from "./ManagementGroupApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { ManagementGroupApiValidator } from "./ManagementGroupApiValidator";
import { GroupService, ManagementGroupView } from "../../../service/cloud/GroupService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import { AppException } from "../../AppException";
import * as types from "../../../types";

/**
 * What an application's backend reads of groups: their state in the clear, and their signed statements. It
 * changes nothing a member signs - members, roles, rules and keys move only by a member's statement - and can
 * only delete.
 */
export class ManagementGroupApi extends ManagementBaseApi implements managementGroupApi.IGroupApi {
    
    constructor(
        managementGroupApiValidator: ManagementGroupApiValidator,
        authorizationDetector: AuthorizationDetector,
        authorizationHolder: AuthorizationHolder,
        private groupService: GroupService,
    ) {
        super(managementGroupApiValidator, authorizationDetector, authorizationHolder);
    }
    
    static convertGroup(view: ManagementGroupView): managementGroupApi.Group {
        const group = view.group;
        const member = (userId: types.cloud.UserId, role: types.cloud.ContainerRole) => ({userId, pubKey: view.pubKeys.get(userId) ?? null, role});
        return {
            id: group.id,
            contextId: group.contextId,
            creator: group.creator,
            createDate: group.createDate,
            lastModificationDate: group.lastModificationDate,
            keyVersion: group.keyVersion,
            rosterVersion: group.rosterVersion,
            lastCommitSeq: group.treeCommitSeq ?? 0,
            members: [
                ...group.managers.map(userId => member(userId, "manager")),
                ...group.users.filter(userId => !group.managers.includes(userId)).map(userId => member(userId, "user")),
            ],
            rules: group.policy,
            visibleTo: group.visibleTo ?? "members",
            publicMeta: view.publicMeta,
        };
    }
    
    @ApiMethod({errorCodes: ["GROUP_DOES_NOT_EXIST"] })
    async getGroup(model: managementGroupApi.GetGroupModel): Promise<managementGroupApi.GetGroupResult> {
        this.validateScope("group");
        const group = await this.groupService.getGroup(this.getPlainUser(), model.groupId, undefined);
        const [view] = await this.groupService.getManagementViews([group]);
        return {group: ManagementGroupApi.convertGroup(view)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listGroups(model: managementGroupApi.ListGroupsModel): Promise<managementGroupApi.ListGroupsResult> {
        this.validateScope("group");
        const page = await this.groupService.getGroupsForManagement(this.getPlainUser(), model.contextId, model);
        const views = await this.groupService.getManagementViews(page.list);
        return {count: page.count, list: views.map(x => ManagementGroupApi.convertGroup(x))};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listGroupsOfUser(model: managementGroupApi.ListGroupsOfUserModel): Promise<managementGroupApi.ListGroupsOfUserResult> {
        this.validateScope("group");
        const page = await this.groupService.getGroupsForManagement(this.getPlainUser(), model.contextId, model, model.userId);
        return {count: page.count, list: page.list.map(group => {
            const manager = group.managers.includes(model.userId);
            return {groupId: group.id, role: manager ? "manager" : "user", isLastManager: manager && group.managers.length === 1};
        })};
    }
    
    @ApiMethod({errorCodes: ["GROUP_DOES_NOT_EXIST"] })
    async listGroupCommits(model: managementGroupApi.ListGroupCommitsModel): Promise<managementGroupApi.ListGroupCommitsResult> {
        this.validateScope("group");
        const {commits} = await this.groupService.getTreeCommits(this.getPlainUser(), model.groupId, model.fromSeq, model.fromSeq + model.limit);
        return {commits};
    }
    
    @ApiMethod({errorCodes: ["GROUP_DOES_NOT_EXIST", "ROTATED_ALREADY"] })
    async cutHistory(model: managementGroupApi.CutHistoryModel): Promise<managementGroupApi.CutHistoryResult> {
        this.validateScope("group");
        return this.groupService.cutHistory(this.getPlainUser(), model.groupId, model.beforeEpoch);
    }
    
    @ApiMethod({errorCodes: ["GROUP_DOES_NOT_EXIST", "GROUP_IN_USE"] })
    async deleteGroup(model: managementGroupApi.DeleteGroupModel): Promise<types.core.OK> {
        this.validateScope("group");
        await this.groupService.deleteGroup(this.getPlainUser(), model.groupId);
        return "OK";
    }
    
    @ApiMethod({})
    async deleteManyGroups(model: managementGroupApi.DeleteManyGroupsModel): Promise<managementGroupApi.DeleteManyGroupsResult> {
        this.validateScope("group");
        const results: managementGroupApi.GroupDeleteStatus[] = [];
        for (const id of model.groupIds) {
            try {
                await this.groupService.deleteGroup(this.getPlainUser(), id);
                results.push({id, status: "OK"});
            }
            catch (e) {
                const status = (["GROUP_DOES_NOT_EXIST", "ACCESS_DENIED", "GROUP_IN_USE"] as const).find(code => AppException.is(e, code));
                if (!status) {
                    throw e;
                }
                results.push({id, status});
            }
        }
        return {results};
    }
}
