/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementBaseApi } from "../../../api/ManagementBaseApi";
import * as managementThreadApi from "./ManagementThreadApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { ManagementThreadApiValidator } from "./ManagementThreadApiValidator";
import { ThreadService } from "../../../service/cloud/ThreadService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import * as types from "../../../types";
import { ManagementThreadConverter } from "./ManagementThreadConverter";

export class ManagementThreadApi extends ManagementBaseApi implements managementThreadApi.IThreadApi {
    
    constructor(
        managementThreadApiValidator: ManagementThreadApiValidator,
        authorizationDetector: AuthorizationDetector,
        authorizationHolder: AuthorizationHolder,
        private threadService: ThreadService,
        private managementThreadConverter: ManagementThreadConverter,
    ) {
        super(managementThreadApiValidator, authorizationDetector, authorizationHolder);
    }
    
    @ApiMethod({errorCodes: ["THREAD_DOES_NOT_EXIST"] })
    async getThread(model: managementThreadApi.GetThreadModel): Promise<managementThreadApi.GetThreadResult> {
        this.validateScope("thread");
        const thread = await this.threadService.getThread(this.getPlainUser(), model.threadId, undefined);
        return {thread: this.managementThreadConverter.convertThread(thread)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listThreads(model: managementThreadApi.ListThreadsModel): Promise<managementThreadApi.ListThreadsResult> {
        const info = await this.threadService.getThreadsByContext(this.getPlainUser(), model.contextId, model);
        return {count: info.count, list: info.list.map(x => this.managementThreadConverter.convertThread(x))};
    }
    
    @ApiMethod({errorCodes: ["THREAD_DOES_NOT_EXIST"] })
    async deleteThread(model: managementThreadApi.DeleteThreadModel): Promise<types.core.OK> {
        this.validateScope("thread");
        await this.threadService.deleteThread(this.getPlainUser(), model.threadId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["RESOURCES_HAVE_DIFFERENT_CONTEXTS"] })
    async deleteManyThreads(model: managementThreadApi.DeleteManyThreadsModel): Promise<managementThreadApi.DeleteManyThreadsResult> {
        this.validateScope("thread");
        const {results} = await this.threadService.deleteManyThreads(this.getPlainUser(), model.threadIds);
        return {results};
    }
    
    @ApiMethod({errorCodes: ["THREAD_MESSAGE_DOES_NOT_EXIST"] })
    async getThreadMessage(model: managementThreadApi.GetThreadMessageModel): Promise<managementThreadApi.GetThreadMessageResult> {
        this.validateScope("thread");
        const {thread, message} = await this.threadService.getThreadMessage(this.getPlainUser(), model.threadMessageId);
        return {threadMessage: this.managementThreadConverter.convertThreadMessage(thread, message)};
    }
    
    @ApiMethod({errorCodes: ["THREAD_DOES_NOT_EXIST"] })
    async listThreadMessages(model: managementThreadApi.ListThreadMessagesModel): Promise<managementThreadApi.ListThreadMessagesResult> {
        this.validateScope("thread");
        const {thread, messages} = await this.threadService.getThreadMessages2(this.getPlainUser(), model.threadId, model);
        return {count: messages.count, list: messages.list.map(x => this.managementThreadConverter.convertThreadMessage(thread, x))};
    }
    
    @ApiMethod({errorCodes: ["THREAD_MESSAGE_DOES_NOT_EXIST"] })
    async deleteThreadMessage(model: managementThreadApi.DeleteThreadMessageModel): Promise<types.core.OK> {
        this.validateScope("thread");
        await this.threadService.deleteMessage(this.getPlainUser(), model.threadMessageId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["MESSAGES_BELONGS_TO_DIFFERENT_THREADS"] })
    async deleteManyThreadMessages(model: managementThreadApi.DeleteManyThreadMessagesModel): Promise<managementThreadApi.DeleteManyThreadMessagesResult> {
        this.validateScope("thread");
        const {results} = await this.threadService.deleteManyMessages(this.getPlainUser(), model.messageIds);
        return {results};
    }
    
    @ApiMethod({errorCodes: ["THREAD_DOES_NOT_EXIST"] })
    async deleteThreadMessagesOlderThan(model: managementThreadApi.DeleteThreadMessagesOlderThanModel): Promise<managementThreadApi.DeleteThreadMessagesOlderThanResult> {
        this.validateScope("thread");
        const {results} = await this.threadService.deleteMessagesOlderThan(this.getPlainUser(), model.threadId, model.timestamp);
        return {results};
    }
}
