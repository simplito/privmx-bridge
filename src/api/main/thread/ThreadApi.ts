/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as threadApi from "./ThreadApiTypes";
import { ThreadService } from "../../../service/cloud/ThreadService";
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { ThreadApiValidator } from "./ThreadApiValidator";
import { BaseApi } from "../../BaseApi";
import { ThreadConverter } from "./ThreadConverter";
import { RequestLogger } from "../../../service/log/RequestLogger";

export class ThreadApi extends BaseApi implements threadApi.IThreadApi {
    
    constructor(
        threadApiValidator: ThreadApiValidator,
        private threadService: ThreadService,
        private sessionService: SessionService,
        private threadConverter: ThreadConverter,
        private requestLogger: RequestLogger,
    ) {
        super(threadApiValidator);
    }
    
    @ApiMethod({})
    async threadCreate(model: threadApi.ThreadCreateModel): Promise<threadApi.ThreadCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const thread = await this.threadService.createThread(cloudUser, model.contextId, model.type, model.users, model.managers, model.data, model.keyId, model.keys, model.policy || {});
        this.requestLogger.setContextId(thread.contextId);
        return {threadId: thread.id};
    }
    
    @ApiMethod({})
    async threadUpdate(model: threadApi.ThreadUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const thread = await this.threadService.updateThread(cloudUser, model.id, model.users, model.managers, model.data, model.keyId, model.keys, model.version, model.force, model.policy);
        this.requestLogger.setContextId(thread.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async threadDelete(model: threadApi.ThreadDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const thread = await this.threadService.deleteThread(cloudUser, model.threadId);
        this.requestLogger.setContextId(thread.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async threadDeleteMany(model: threadApi.ThreadDeleteManyModel): Promise<threadApi.ThreadDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.threadService.deleteManyThreads(cloudUser, model.threadIds);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async threadGet(model: threadApi.ThreadGetModel): Promise<threadApi.ThreadGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const thread = await this.threadService.getThread(cloudUser, model.threadId, model.type);
        this.requestLogger.setContextId(thread.contextId);
        return {thread: this.threadConverter.convertThread(cloudUser.getUser(thread.contextId), thread)};
    }
    
    @ApiMethod({})
    async threadList(model: threadApi.ThreadListModel): Promise<threadApi.ThreadListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, threads} = await this.threadService.getMyThreads(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {threads: threads.list.map(x => this.threadConverter.convertThread(user.userId, x)), count: threads.count};
    }
    
    @ApiMethod({})
    async threadListAll(model: threadApi.ThreadListAllModel): Promise<threadApi.ThreadListAllResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, threads} = await this.threadService.getAllThreads(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {threads: threads.list.map(x => this.threadConverter.convertThread(user.userId, x)), count: threads.count};
    }
    
    @ApiMethod({})
    async threadMessageSend(model: threadApi.ThreadMessageSendModel): Promise<threadApi.ThreadMessageSendResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {thread, message} = await this.threadService.sendMessage(cloudUser, model.threadId, model.data, model.keyId);
        this.requestLogger.setContextId(thread.contextId);
        return {messageId: message.id};
    }
    
    @ApiMethod({})
    async threadMessageUpdate(model: threadApi.ThreadMessageUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {thread} = await this.threadService.updateMessage(cloudUser, model.messageId, model.data, model.keyId);
        this.requestLogger.setContextId(thread.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async threadMessageDelete(model: threadApi.ThreadMessageDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {thread} = await this.threadService.deleteMessage(cloudUser, model.messageId);
        this.requestLogger.setContextId(thread.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async threadMessageDeleteMany(model: threadApi.ThreadMessageDeleteManyModel): Promise<threadApi.ThreadMessageDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.threadService.deleteManyMessages(cloudUser, model.messageIds);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async threadMessageDeleteOlderThan(model: threadApi.ThreadMessageDeleteOlderThanModel): Promise<threadApi.ThreadMessageDeleteOlderThanResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.threadService.deleteMessagesOlderThan(cloudUser, model.threadId, model.timestamp);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async threadMessageGet(model: threadApi.ThreadMessageGetModel): Promise<threadApi.ThreadMessageGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {thread, message} = await this.threadService.getThreadMessage(cloudUser, model.messageId);
        this.requestLogger.setContextId(thread.contextId);
        return {message: this.threadConverter.convertMessage(thread, message)};
    }
    
    @ApiMethod({})
    async threadMessagesGet(model: threadApi.ThreadMessagesGetModel): Promise<threadApi.ThreadMessagesGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {thread, messages} = await this.threadService.getThreadMessages(cloudUser, model.threadId, model);
        this.requestLogger.setContextId(thread.contextId);
        return {
            thread: this.threadConverter.convertThread(cloudUser.getUser(thread.contextId), thread),
            messages: messages.list.map(x => this.threadConverter.convertMessage(thread, x)),
            count: messages.count,
        };
    }
    
    @ApiMethod({})
    async threadMessagesGetMy(model: threadApi.ThreadMessagesGetMyModel): Promise<threadApi.ThreadMessagesGetMyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {thread, messages} = await this.threadService.getThreadMyMessages(cloudUser, model.threadId, model);
        this.requestLogger.setContextId(thread.contextId);
        return {
            thread: this.threadConverter.convertThread(cloudUser.getUser(thread.contextId), thread),
            messages: messages.list.map(x => this.threadConverter.convertMessage(thread, x)),
            count: messages.count,
        };
    }
}
