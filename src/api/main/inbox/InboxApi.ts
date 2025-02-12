/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as inboxApi from "./InboxApiTypes";
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { BaseApi } from "../../BaseApi";
import { InboxApiValidator } from "./InboxApiValidator";
import { InboxService } from "../../../service/cloud/InboxService";
import { InboxConverter } from "./InboxConverter";
import { RequestLogger } from "../../../service/log/RequestLogger";

export class InboxApi extends BaseApi implements inboxApi.IInboxApi {
    
    constructor(
        inboxApiValidator: InboxApiValidator,
        private sessionService: SessionService,
        private inboxService: InboxService,
        private inboxConverter: InboxConverter,
        private requestLogger: RequestLogger,
    ) {
        super(inboxApiValidator);
    }
    
    @ApiMethod({})
    async inboxCreate(model: inboxApi.InboxCreateModel): Promise<inboxApi.InboxCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const inbox = await this.inboxService.createInbox(cloudUser, model);
        this.requestLogger.setContextId(inbox.contextId);
        return {inboxId: inbox.id};
    }
    
    @ApiMethod({})
    async inboxUpdate(model: inboxApi.InboxUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const inbox = await this.inboxService.updateInbox(cloudUser, model);
        this.requestLogger.setContextId(inbox.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async inboxDelete(model: inboxApi.InboxDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const inbox = await this.inboxService.deleteInbox(cloudUser, model.inboxId);
        this.requestLogger.setContextId(inbox.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async inboxDeleteMany(model: inboxApi.InboxDeleteManyModel): Promise<inboxApi.InboxDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.inboxService.deleteManyInboxes(cloudUser, model.inboxIds);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async inboxGet(model: inboxApi.InboxGetModel): Promise<inboxApi.InboxGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const inbox = await this.inboxService.getInbox(cloudUser, model.id, model.type);
        this.requestLogger.setContextId(inbox.contextId);
        return {inbox: this.inboxConverter.convertInbox(cloudUser.getUser(inbox.contextId), inbox)};
    }
    
    @ApiMethod({})
    async inboxGetPublicView(model: inboxApi.InboxGetModel): Promise<inboxApi.InboxGetPublicViewResult> {
        const sessionSolution = this.sessionService.getSessionUser().get("solution");
        const inbox = await this.inboxService.getInboxWithoutCheckingAccess(model.id, sessionSolution);
        this.requestLogger.setContextId(inbox.contextId);
        return this.inboxConverter.convertInboxToPublicView(inbox);
    }
    
    @ApiMethod({})
    async inboxList(model: inboxApi.InboxListModel): Promise<inboxApi.InboxListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {inboxes, user} = await this.inboxService.getMyInboxes(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {inboxes: inboxes.list.map(x => this.inboxConverter.convertInbox(user.userId, x)), count: inboxes.count};
    }
    
    @ApiMethod({})
    async inboxListAll(model: inboxApi.InboxListAllModel): Promise<inboxApi.InboxListAllResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {inboxes, user} = await this.inboxService.getAllInboxes(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {inboxes: inboxes.list.map(x => this.inboxConverter.convertInbox(user.userId, x)), count: inboxes.count};
    }
    
    @ApiMethod({})
    async inboxSend(model: inboxApi.InboxSendModel): Promise<types.core.OK> {
        const sessionUsername = this.sessionService.getSessionUser().get("username");
        const sessionSolution = this.sessionService.getSessionUser().get("solution");
        const {inbox} = await this.inboxService.send(sessionUsername, model, sessionSolution);
        this.requestLogger.setContextId(inbox.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async inboxSendCustomEvent(model: inboxApi.InboxSendCustomEventModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const inbox = await this.inboxService.sendCustomNotification(cloudUser, model.inboxId, model.keyId, model.data, model.channel, model.users);
        this.requestLogger.setContextId(inbox.contextId);
        return "OK";
    }
}
