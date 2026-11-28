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
import { AppException } from "../../AppException";
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { ContextApiValidator } from "./ContextApiValidator";
import { BaseApi } from "../../BaseApi";
import { GroupConverter } from "./GroupConverter";
import { SpaceConverter } from "./SpaceConverter";
import { SpaceService } from "../../../service/cloud/SpaceService";
import { RequestLogger } from "../../../service/log/RequestLogger";
import * as db from "../../../db/Model";
import * as contextApi from "./ContextApiTypes";
import * as types from "../../../types";
export class ContextApi extends BaseApi implements contextApi.IContextApi {
    
    /** What one `groupGetMany` answer may carry before the rest of its ids are left for single reads. */
    static readonly GROUP_GET_MANY_MAX_BYTES = 32 * 1024 * 1024;
    
    private static batchSizeExceeded(): contextApi.GroupGetManyEntry {
        const e = new AppException("GROUP_BATCH_SIZE_EXCEEDED");
        return {error: {code: e.getCode(), message: e.getMessage()}};
    }
    
    constructor(
        contextApiValidator: ContextApiValidator,
        private contextService: ContextService,
        private sessionService: SessionService,
        private groupService: GroupService,
        private groupConverter: GroupConverter,
        private requestLogger: RequestLogger,
        private spaceService: SpaceService,
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
        const group = await this.groupService.createGroup(cloudUser, model.resourceId, model.contextId, model.type, model.groupPubKey, model.users, model.managers, model.data, model.publicMeta, model.privateMeta, model.keyId, model.commit.policy!, model.tree, model.commit, model.groupKeys, model.visibleTo);
        this.requestLogger.setContextId(group.contextId);
        return {groupId: group.id};
    }
    
    @ApiMethod({})
    async groupUpdatePublicMeta(model: contextApi.GroupUpdatePublicMetaModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.updatePublicMeta(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupUpdatePrivateMeta(model: contextApi.GroupUpdatePrivateMetaModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.updatePrivateMeta(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupUpdatePolicy(model: contextApi.GroupUpdatePolicyModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.updatePolicy(cloudUser, model);
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
        const {group, state} = await this.groupService.getGroupWithState(cloudUser, model.groupId, model.type, model.fromRosterVersion);
        this.requestLogger.setContextId(group.contextId);
        const info = this.groupConverter.convertGroup(
            cloudUser.getUser(group.contextId), group, state, model.scope ?? "path", model.forUserIds, model.forNewMembers,
        );
        // Only the statements vouching for what this response serves — a path view needs a handful, not the chain.
        info.treeCommits = await this.groupService.getTreeCommitsAt(group, GroupConverter.vouchingSeqs(info.treeNodes));
        return {group: info};
    }
    
    @ApiMethod({})
    async groupGetMany(model: contextApi.GroupGetManyModel): Promise<contextApi.GroupGetManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const results: contextApi.GroupGetManyEntry[] = [];
        // Each group can be megabytes (its roster data and both metadata planes), so the answer stops growing past a
        // budget: what is left is answered GROUP_BATCH_SIZE_EXCEEDED, unread, for the caller to read one by one.
        // The first group is always served, so no batch fails outright.
        let size = 0;
        let full = false;
        for (const groupId of model.groupIds) {
            if (full) {
                results.push(ContextApi.batchSizeExceeded());
                continue;
            }
            try {
                const {group, state} = await this.groupService.getGroupWithState(cloudUser, groupId, undefined, undefined);
                const info = this.groupConverter.convertGroup(cloudUser.getUser(group.contextId), group, state, "path");
                info.treeCommits = await this.groupService.getTreeCommitsAt(group, GroupConverter.vouchingSeqs(info.treeNodes));
                const bytes = Buffer.byteLength(JSON.stringify(info));
                if (size > 0 && size + bytes > ContextApi.GROUP_GET_MANY_MAX_BYTES) {
                    full = true;
                    results.push(ContextApi.batchSizeExceeded());
                    continue;
                }
                size += bytes;
                results.push({group: info});
            }
            catch (e) {
                // One group that is gone, or that the caller left, must not take the rest of the list with it.
                if (!(e instanceof AppException)) {
                    throw e;
                }
                results.push({error: {code: e.getCode(), message: e.getMessage()}});
            }
        }
        return {results};
    }
    
    @ApiMethod({})
    async groupGetPublicKey(model: contextApi.GroupGetPublicKeyModel): Promise<contextApi.GroupGetPublicKeyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {group, treeCommit} = await this.groupService.getGroupPublicKey(cloudUser, model.groupId);
        this.requestLogger.setContextId(group.contextId);
        return {group: this.groupConverter.convertGroupPublicInfo(group, treeCommit)};
    }
    
    @ApiMethod({})
    async groupSetVisibility(model: contextApi.GroupSetVisibilityModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.setVisibility(cloudUser, model.groupId, model.visibleTo);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupList(model: contextApi.GroupListModel): Promise<contextApi.GroupListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {groups} = await this.groupService.getGroupsByContext(cloudUser, model.contextId, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {groups: groups.list.map(x => this.groupConverter.convertGroupSummary(x)), count: groups.count};
    }
    
    @ApiMethod({})
    async groupAddMembers(model: contextApi.GroupAddMembersModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.addMembers(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupRemoveMembers(model: contextApi.GroupRemoveMembersModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.removeMembers(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupReseat(model: contextApi.GroupRemoveMembersModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.reseatMembers(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupSetRoles(model: contextApi.GroupSetRolesModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.setRoles(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupSelfUpdate(model: contextApi.GroupSelfUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.selfUpdate(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupGetTreeCommits(model: contextApi.GroupGetTreeCommitsModel): Promise<contextApi.GroupGetTreeCommitsResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {group, commits, genesis} = await this.groupService.getTreeCommits(cloudUser, model.groupId, model.fromSeq, model.toSeq);
        this.requestLogger.setContextId(group.contextId);
        return {commits, ...(genesis ? {genesisUsers: genesis.users, genesisManagers: genesis.managers} : {})};
    }
    
    @ApiMethod({})
    async groupRepairRung(model: contextApi.GroupRepairRungModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.repairRung(cloudUser, model);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async groupGetKeyArchive(model: contextApi.GroupGetKeyArchiveModel): Promise<contextApi.GroupGetKeyArchiveResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {group, rungs, epochKeys} = await this.groupService.getKeyArchive(cloudUser, model.id, model.fromKeyVersion, model.toKeyVersion, model.spans);
        this.requestLogger.setContextId(group.contextId);
        return this.groupConverter.convertKeyArchive(group, rungs, epochKeys);
    }
    
    @ApiMethod({})
    async groupGetEpochKeys(model: contextApi.GroupGetEpochKeysModel): Promise<contextApi.GroupGetEpochKeysResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {group, epochKeys} = await this.groupService.getEpochKeys(cloudUser, model.id, model.keyIds ?? [], model.groupPubKeys ?? []);
        this.requestLogger.setContextId(group.contextId);
        return this.groupConverter.convertEpochKeys(group, epochKeys);
    }
    
    @ApiMethod({})
    async groupSendCustomEvent(model: contextApi.GroupSendCustomEventModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const group = await this.groupService.sendCustomNotification(cloudUser, model.groupId, model.data, model.channel, model.users);
        this.requestLogger.setContextId(group.contextId);
        return "OK";
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
    
    @ApiMethod({})
    async spaceCreate(model: contextApi.SpaceCreateModel): Promise<contextApi.SpaceCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const space = await this.spaceService.createSpace(cloudUser, model);
        this.requestLogger.setContextId(space.contextId);
        return {spaceId: space.id};
    }
    
    @ApiMethod({})
    async spaceGet(model: contextApi.SpaceIdModel): Promise<contextApi.SpaceGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const view = await this.spaceService.getSpace(cloudUser, model.id);
        this.requestLogger.setContextId(view.space.contextId);
        return {space: SpaceConverter.convertSpace(view)};
    }
    
    @ApiMethod({})
    async spaceGetKeyArchive(model: contextApi.SpaceGetKeyArchiveModel): Promise<contextApi.SpaceGetKeyArchiveResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {space, rungs, keys, nextKeyVersion} = await this.spaceService.getKeyArchive(cloudUser, model);
        this.requestLogger.setContextId(space.contextId);
        return {rungs, keys: keys.map(k => SpaceConverter.convertKey(k)), ...(nextKeyVersion === undefined ? {} : {nextKeyVersion})};
    }
    
    @ApiMethod({})
    async spaceGetStatements(model: contextApi.SpaceGetStatementsModel): Promise<contextApi.SpaceGetStatementsResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {space, statements} = await this.spaceService.getStatements(cloudUser, model);
        this.requestLogger.setContextId(space.contextId);
        return {statements};
    }
    
    @ApiMethod({})
    async spaceList(model: contextApi.SpaceListModel): Promise<contextApi.SpaceListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const page = await this.spaceService.listSpaces(cloudUser, model.contextId, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {spaces: page.list.map(x => SpaceConverter.convertSpace(x)), count: page.count};
    }
    
    @ApiMethod({})
    async spaceDelete(model: contextApi.SpaceIdModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const space = await this.spaceService.deleteSpace(cloudUser, model.id);
        this.requestLogger.setContextId(space.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async spaceAddRecipients(model: contextApi.SpaceAddRecipientsModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const space = await this.spaceService.addRecipients(cloudUser, model);
        this.requestLogger.setContextId(space.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async spaceRemoveRecipients(model: contextApi.SpaceRemoveRecipientsModel): Promise<contextApi.SpaceRotateKeyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const space = await this.spaceService.rotateKey(cloudUser, model, "context/spaceRemoveRecipients");
        this.requestLogger.setContextId(space.contextId);
        return {keyVersion: space.keyVersion};
    }
    
    @ApiMethod({})
    async spaceRotateKey(model: contextApi.SpaceRotateKeyModel): Promise<contextApi.SpaceRotateKeyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const space = await this.spaceService.rotateKey(cloudUser, model, "context/spaceRotateKey");
        this.requestLogger.setContextId(space.contextId);
        return {keyVersion: space.keyVersion};
    }
    
    @ApiMethod({})
    async spaceUpdatePublicMeta(model: contextApi.SpaceUpdateMetaModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const space = await this.spaceService.updateMeta(cloudUser, model, "publicMeta");
        this.requestLogger.setContextId(space.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async spaceUpdatePrivateMeta(model: contextApi.SpaceUpdateMetaModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const space = await this.spaceService.updateMeta(cloudUser, model, "privateMeta");
        this.requestLogger.setContextId(space.contextId);
        return "OK";
    }
}
