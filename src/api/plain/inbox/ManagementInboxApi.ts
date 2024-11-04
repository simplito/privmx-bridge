/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as managementInboxApi from "./ManagementInboxApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { ManagementInboxApiValidator } from "./ManagementInboxApiValidator";
import { InboxService } from "../../../service/cloud/InboxService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import * as types from "../../../types";
import { ManagementInboxConverter } from "./ManagementInboxConverter";
import { ManagementBaseApi } from "../../ManagementBaseApi";

export class ManagementInboxApi extends ManagementBaseApi implements managementInboxApi.IInboxApi {
    
    constructor(
        managementInboxApiValidator: ManagementInboxApiValidator,
        private inboxService: InboxService,
        authorizationDetector: AuthorizationDetector,
        authorizationHolder: AuthorizationHolder,
        private managementInboxConverter: ManagementInboxConverter,
    ) {
        super(managementInboxApiValidator, authorizationDetector, authorizationHolder);
    }
    
    @ApiMethod({errorCodes: ["INBOX_DOES_NOT_EXIST"] })
    async getInbox(model: managementInboxApi.GetInboxModel): Promise<managementInboxApi.GetInboxResult> {
        this.validateScope("inbox");
        const inbox = await this.inboxService.getInbox(this.getPlainUser(), model.inboxId, undefined);
        return {inbox: this.managementInboxConverter.convertInbox(inbox)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listInboxes(model: managementInboxApi.ListInboxesModel): Promise<managementInboxApi.ListInboxesResult> {
        this.validateScope("inbox");
        const {inboxes} = await this.inboxService.getInboxesByContext(this.getPlainUser(), model.contextId, model);
        return {count: inboxes.count, list: inboxes.list.map(x => this.managementInboxConverter.convertInbox(x))};
    }
    
    @ApiMethod({errorCodes: ["INBOX_DOES_NOT_EXIST"] })
    async deleteInbox(model: managementInboxApi.DeleteInboxModel): Promise<types.core.OK> {
        this.validateScope("inbox");
        await this.inboxService.deleteInbox(this.getPlainUser(), model.inboxId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["RESOURCES_HAVE_DIFFERENT_CONTEXTS"] })
    async deleteManyInboxes(model: managementInboxApi.DeleteManyInboxesModel): Promise<managementInboxApi.DeleteManyInboxesResult> {
        this.validateScope("inbox");
        const {results} = await this.inboxService.deleteManyInboxes(this.getPlainUser(), model.inboxIds);
        return {results};
    }
}