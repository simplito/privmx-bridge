/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ContextService } from "../../../service/cloud/ContextService";
import { GroupService } from "../../../service/cloud/GroupService";
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { ContextApiValidator } from "./ContextApiValidator";
import { BaseApi } from "../../BaseApi";
import { GroupConverter } from "./GroupConverter";
import { RequestLogger } from "../../../service/log/RequestLogger";
import * as db from "../../../db/Model";
import * as contextApi from "./ContextApiTypes";
import * as types from "../../../types";
export class ContextApi extends BaseApi implements contextApi.IContextApi {
    
    constructor(
        contextApiValidator: ContextApiValidator,
        private contextService: ContextService,
        private sessionService: SessionService,
        private groupService: GroupService,
        private groupConverter: GroupConverter,
        private requestLogger: RequestLogger,
    ) {
        super(contextApiValidator);
    }
    
    @ApiMethod({})
    async contextGet(model: contextApi.ContextGetModel): Promise<contextApi.ContextGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {context, user} = await this.contextService.getContext(cloudUser, model.id);
        return {context: this.convertContext(user, context)};
    }
    
    @ApiMethod({})
    async contextList(model: contextApi.ContextListModel): Promise<contextApi.ContextListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const entries = await this.contextService.getContextsOfUser(cloudUser, model);
        return {contexts: entries.list.map(x => this.convertContextUser(x)), count: entries.count};
    }
    
    @ApiMethod({})
    async contextGetUsers(model: contextApi.ContextGetUsersModel): Promise<contextApi.ContextGetUserResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const users = await this.contextService.getAllContextUsers(cloudUser, model.contextId);
        return {users: users.map(user => this.convertUser(user))};
    }
    
    @ApiMethod({})
    async contextListUsers(model: contextApi.ContextListUsersModel): Promise<contextApi.ContextListUsersResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const usersList = await this.contextService.getPageOfContextUsersWithStatus(cloudUser, model.contextId, model);
        return {count: usersList.count, users: usersList.users.map(user => this.convertUserWithStatusChange(user))};
    }
    
    @ApiMethod({})
    async contextSendCustomEvent(model: contextApi.ContextSendCustomEventModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        await this.contextService.sendCustomNotification(cloudUser, model.contextId, model.data, model.channel, model.users);
        return "OK";
    }
    
    @ApiMethod({})
    async groupCreate(model: contextApi.GroupCreateModel): Promise<contextApi.GroupCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.createGroup(cloudUser, model.resourceId || null, model.contextId, model.type, model.groupPubKey, model.users, model.managers, model.data, model.keyId, model.policy || {}, model.tree, model.groupKeys);
        this.requestLogger.setContextId(group.contextId);
        return {groupId: group.id};
    }
    
    @ApiMethod({})
    async groupUpdate(model: contextApi.GroupUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.updateGroup(cloudUser, model.id, model.data, model.keyId, model.version, model.force, model.policy, model.resourceId || null);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupGenerateNewKey(model: contextApi.GroupGenerateNewKeyModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.generateNewGroupKey(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupDelete(model: contextApi.GroupDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.deleteGroup(cloudUser, model.groupId);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupGet(model: contextApi.GroupGetModel): Promise<contextApi.GroupGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {group, state} = await this.groupService.getGroupWithState(cloudUser, model.groupId, model.type, model.fromVersion);
        this.requestLogger.setContextId(group.contextId);
        return {group: this.groupConverter.convertGroup(
            cloudUser.getUser(group.contextId), group, state, model.scope ?? "path", model.forUserId, model.forPosition,
        )};
    }
    
    @ApiMethod({})
    async groupList(model: contextApi.GroupListModel): Promise<contextApi.GroupListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {groups} = await this.groupService.getGroupsByContext(cloudUser, model.contextId, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {groups: groups.list.map(x => this.groupConverter.convertGroupSummary(x)), count: groups.count};
    }
    
    @ApiMethod({})
    async groupAddMember(model: contextApi.GroupAddMemberModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.addMember(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupRemoveMember(model: contextApi.GroupRemoveMemberModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.removeMember(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupCutEra(model: contextApi.GroupCutEraModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.cutEra(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupPruneArchive(model: contextApi.GroupPruneArchiveModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.pruneArchive(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupGetKeyArchive(model: contextApi.GroupGetKeyArchiveModel): Promise<contextApi.GroupGetKeyArchiveResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {group, rungs} = await this.groupService.getKeyArchive(cloudUser, model.id, model.fromKeyVersion, model.toKeyVersion);
        this.requestLogger.setContextId(group.contextId);
        return this.groupConverter.convertKeyArchive(group, rungs);
    }
    
    private convertContext(x: db.context.ContextUser, context: db.context.Context) {
        const res: contextApi.ContextInfo = {
            contextId: x.contextId,
            userId: x.userId,
            acl: x.acl,
            policy: context.policy || {},
            created: context.created,
            modified: context.modified,
            name: context.name,
            description: context.description,
            scope: context.scope,
        };
        return res;
    }
    
    private convertContextUser(contextUser: db.context.ContextUser&{contextObj: db.context.Context}) {
        const x = contextUser.contextObj;
        const res: contextApi.ContextInfo = {
            contextId: contextUser.contextId,
            userId: contextUser.userId,
            acl: contextUser.acl,
            policy: x.policy || {},
            created: x.created,
            modified: x.modified,
            name: x.name,
            description: x.description,
            scope: x.scope,
        };
        return res;
    }
    
    private convertUser(x: db.context.ContextUserWithStatus): types.cloud.UserIdentityWithStatus {
        const res: types.cloud.UserIdentityWithStatus = {
            id: x.userId,
            pub: x.userPubKey,
            status: x.status,
        };
        return res;
    }
    
    private convertUserWithStatusChange(x: db.context.ContextUserWithStatus): types.cloud.UserIdentityWithStatusAndAction {
        const res: types.cloud.UserIdentityWithStatusAndAction = {
            id: x.userId,
            pub: x.userPubKey,
            status: x.status,
            lastStatusChange: x.lastStatusChange ? x.lastStatusChange : null,
        };
        return res;
    }
}
