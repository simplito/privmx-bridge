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
        return {contexts: entries.list.map(x => this.convertContext(x, x.contextObj)), count: entries.count};
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
}