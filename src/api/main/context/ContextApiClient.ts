/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as contextApi from "./ContextApiTypes";
import { BaseApiClient } from "../../BaseApiClient";
import * as types from "../../../types";

export class ContextApiClient extends BaseApiClient implements contextApi.IContextApi {
    
    contextGet(model: contextApi.ContextGetModel): Promise<contextApi.ContextGetResult> {
        return this.request("context.contextGet", model);
    }
    
    contextList(model: contextApi.ContextListModel): Promise<contextApi.ContextListResult> {
        return this.request("context.contextList", model);
    }
    
    contextGetUsers(model: contextApi.ContextGetUsersModel): Promise<contextApi.ContextGetUserResult> {
        return this.request("context.contextGetUsers", model);
    }
    
    contextListUsers(model: contextApi.ContextListUsersModel): Promise<contextApi.ContextListUsersResult> {
        return this.request("context.contextListUsers", model);
    }
    
    contextSendCustomEvent(model: contextApi.ContextSendCustomEventModel): Promise<types.core.OK> {
        return this.request("context.contextSendCustomEvent", model);
    }
    
    groupCreate(model: contextApi.GroupCreateModel): Promise<contextApi.GroupCreateResult> {
        return this.request("context.groupCreate", model);
    }
    
    groupUpdatePublicMeta(model: contextApi.GroupUpdatePublicMetaModel): Promise<types.core.OK> {
        return this.request("context.groupUpdatePublicMeta", model);
    }
    
    groupUpdatePrivateMeta(model: contextApi.GroupUpdatePrivateMetaModel): Promise<types.core.OK> {
        return this.request("context.groupUpdatePrivateMeta", model);
    }
    
    groupUpdatePolicy(model: contextApi.GroupUpdatePolicyModel): Promise<types.core.OK> {
        return this.request("context.groupUpdatePolicy", model);
    }
    
    groupGenerateNewKey(model: contextApi.GroupGenerateNewKeyModel): Promise<types.core.OK> {
        return this.request("context.groupGenerateNewKey", model);
    }
    
    groupDelete(model: contextApi.GroupDeleteModel): Promise<types.core.OK> {
        return this.request("context.groupDelete", model);
    }
    
    groupGet(model: contextApi.GroupGetModel): Promise<contextApi.GroupGetResult> {
        return this.request("context.groupGet", model);
    }
    
    groupList(model: contextApi.GroupListModel): Promise<contextApi.GroupListResult> {
        return this.request("context.groupList", model);
    }
    
    groupAddMembers(model: contextApi.GroupAddMembersModel): Promise<types.core.OK> {
        return this.request("context.groupAddMembers", model);
    }
    
    groupRemoveMembers(model: contextApi.GroupRemoveMembersModel): Promise<types.core.OK> {
        return this.request("context.groupRemoveMembers", model);
    }
    
    groupReseat(model: contextApi.GroupRemoveMembersModel): Promise<types.core.OK> {
        return this.request("context.groupReseat", model);
    }
    
    groupSetRoles(model: contextApi.GroupSetRolesModel): Promise<types.core.OK> {
        return this.request("context.groupSetRoles", model);
    }
    
    groupSelfUpdate(model: contextApi.GroupSelfUpdateModel): Promise<types.core.OK> {
        return this.request("context.groupSelfUpdate", model);
    }
    
    groupGetTreeCommits(model: contextApi.GroupGetTreeCommitsModel): Promise<contextApi.GroupGetTreeCommitsResult> {
        return this.request("context.groupGetTreeCommits", model);
    }
    
    groupGetMany(model: contextApi.GroupGetManyModel): Promise<contextApi.GroupGetManyResult> {
        return this.request("context.groupGetMany", model);
    }
    
    groupGetPublicKey(model: contextApi.GroupGetPublicKeyModel): Promise<contextApi.GroupGetPublicKeyResult> {
        return this.request("context.groupGetPublicKey", model);
    }
    
    groupSetVisibility(model: contextApi.GroupSetVisibilityModel): Promise<types.core.OK> {
        return this.request("context.groupSetVisibility", model);
    }
    
    groupCutEra(model: contextApi.GroupCutEraModel): Promise<types.core.OK> {
        return this.request("context.groupCutEra", model);
    }
    
    groupPruneArchive(model: contextApi.GroupPruneArchiveModel): Promise<types.core.OK> {
        return this.request("context.groupPruneArchive", model);
    }
    
    groupRepairRung(model: contextApi.GroupRepairRungModel): Promise<types.core.OK> {
        return this.request("context.groupRepairRung", model);
    }
    
    groupGetKeyArchive(model: contextApi.GroupGetKeyArchiveModel): Promise<contextApi.GroupGetKeyArchiveResult> {
        return this.request("context.groupGetKeyArchive", model);
    }
    
    groupGetEpochKeys(model: contextApi.GroupGetEpochKeysModel): Promise<contextApi.GroupGetEpochKeysResult> {
        return this.request("context.groupGetEpochKeys", model);
    }
    
    groupSendCustomEvent(model: contextApi.GroupSendCustomEventModel): Promise<types.core.OK> {
        return this.request("context.groupSendCustomEvent", model);
    }
    
    spaceCreate(model: contextApi.SpaceCreateModel): Promise<contextApi.SpaceCreateResult> {
        return this.request("context.spaceCreate", model);
    }
    
    spaceGet(model: contextApi.SpaceIdModel): Promise<contextApi.SpaceGetResult> {
        return this.request("context.spaceGet", model);
    }
    
    spaceList(model: contextApi.SpaceListModel): Promise<contextApi.SpaceListResult> {
        return this.request("context.spaceList", model);
    }
    
    spaceDelete(model: contextApi.SpaceIdModel): Promise<types.core.OK> {
        return this.request("context.spaceDelete", model);
    }
    
    spaceAddRecipients(model: contextApi.SpaceAddRecipientsModel): Promise<types.core.OK> {
        return this.request("context.spaceAddRecipients", model);
    }
    
    spaceRemoveRecipients(model: contextApi.SpaceRemoveRecipientsModel): Promise<contextApi.SpaceRotateKeyResult> {
        return this.request("context.spaceRemoveRecipients", model);
    }
    
    spaceRotateKey(model: contextApi.SpaceRotateKeyModel): Promise<contextApi.SpaceRotateKeyResult> {
        return this.request("context.spaceRotateKey", model);
    }
    
    spaceUpdatePublicMeta(model: contextApi.SpaceUpdateMetaModel): Promise<types.core.OK> {
        return this.request("context.spaceUpdatePublicMeta", model);
    }
    
    spaceUpdatePrivateMeta(model: contextApi.SpaceUpdateMetaModel): Promise<types.core.OK> {
        return this.request("context.spaceUpdatePrivateMeta", model);
    }
}
