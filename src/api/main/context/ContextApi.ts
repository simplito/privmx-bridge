/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ContextService } from "../../../service/cloud/ContextService";
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { ContextApiValidator } from "./ContextApiValidator";
import { BaseApi } from "../../BaseApi";
import * as db from "../../../db/Model";
import * as contextApi from "./ContextApiTypes";
import * as types from "../../../types";
export class ContextApi extends BaseApi implements contextApi.IContextApi {
    
    constructor(
        contextApiValidator: ContextApiValidator,
        private contextService: ContextService,
        private sessionService: SessionService,
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
        const entries = await this.contextService.getAllForUser(cloudUser, model);
        return {contexts: entries.list.map(x => this.convertContextUser(x)), count: entries.count};
    }
    
    @ApiMethod({})
    async contextGetUsers(model: contextApi.ContextGetUsersModel): Promise<contextApi.ContextGetUserResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const users = await this.contextService.getAllContextUsers(cloudUser, model.contextId);
        return {users: users.map(user => this.convertUser(user))};
    }
    
    @ApiMethod({})
    async contextSendCustomEvent(model: contextApi.ContextSendCustomEventModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        await this.contextService.sendCustomNotification(cloudUser, model.contextId, model.data, model.channel, model.users);
        return "OK";
    }
    
    private convertContext(x: db.context.ContextUser, context: db.context.Context) {
        const res: contextApi.ContextInfo = {
            contextId: x.contextId,
            userId: x.userId,
            acl: x.acl,
            policy: context.policy || {},
        };
        return res;
    }
    
    private convertContextUser(context: db.context.Context&{users: db.context.ContextUser[]}) {
        const x = context.users[0];
        const res: contextApi.ContextInfo = {
            contextId: x.contextId,
            userId: x.userId,
            acl: x.acl,
            policy: context.policy || {},
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
}
