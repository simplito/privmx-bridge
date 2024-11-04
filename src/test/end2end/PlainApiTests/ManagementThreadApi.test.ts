/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, Test, verifyResponseFor, verifyResponseIsOK } from "../BaseTestSet";
import * as types from "../../../types";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import { DateUtils } from "../../../utils/DateUtils";

export class ManagementThreadApiTest extends BaseTestSet {
    
    private newThreads: types.thread.ThreadId[] = [];
    private newThreadMessages: types.thread.ThreadMessageId[] = [];
    
    @Test()
    async shouldGetThread() {
        this.helpers.authorizePlainApi();
        await this.fetchThread()
    }
    
    @Test()
    async shouldDeleteThread() {
        this.helpers.authorizePlainApi();
        await this.deleteSingleThread();
    }
    
    @Test()
    async shouldDeleteManyThreads() {
        this.helpers.authorizePlainApi();
        await this.createNewThreads();
        await this.listAllThreads();
        await this.deleteAllNewThreads();
        await this.validateThreadCount();
    }
    
    @Test()
    async shouldGetThreadMessage() {
        this.helpers.authorizePlainApi();
        await this.fetchThreadMessage();
    }
    
    @Test()
    async shouldDeleteThreadMessage() {
        this.helpers.authorizePlainApi();
        await this.deleteSingleThreadMessage();
    }
    
    @Test()
    async shouldListThreadMessages() {
        this.helpers.authorizePlainApi();
        await this.listAllThreadMessages()
    }
    
    @Test()
    async shouldDeleteManyThreadMessages() {
        this.helpers.authorizePlainApi();
        await this.createManyThreadMessages();
        await this.deleteManyThreadMessages();
        await this.validateThreadMessageCount();
    }
    
    @Test()
    async shouldMessagesOlderThan() {
        this.helpers.authorizePlainApi();
        await this.createManyThreadMessages();
        await this.deleteAllMessagesOlderThanNow();
        await this.checkIfAllMessagesAreDeleted();
    }
    
    private async fetchThread() {
        const result = await this.plainApis.threadApi.getThread({
            threadId: testData.threadId,
        });
        verifyResponseFor("getThread", result, ["thread"]);
    }

    private async listAllThreads() {
        const result = await this.plainApis.threadApi.listThreads({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listThreads", result, ["list", "count"]);
        assert(result.count === this.newThreads.length + 1);
    }

    private async deleteSingleThread() {
        const result = await this.plainApis.threadApi.deleteThread({
            threadId: testData.threadId,
        });
        verifyResponseIsOK("deleteThread", result);
    }

    private async createNewThreads() {
        for (let i = 0; i < 5; i++) {
            const newThread = await this.apis.threadApi.threadCreate({
                contextId: testData.contextId,
                data: "AAAA" as types.thread.ThreadData,
                keyId: testData.keyId,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
            this.newThreads.push(newThread.threadId);
        }
    }
    
    private async deleteAllNewThreads() {
        const result = await this.plainApis.threadApi.deleteManyThreads({
            threadIds: this.newThreads,
        });
        verifyResponseFor("deleteManyThreads", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async validateThreadCount() {
        const result = await this.plainApis.threadApi.listThreads({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listThreads", result, ["list", "count"]);
        assert(result.count === 1);
    }
    
    private async fetchThreadMessage() {
        const result = await this.plainApis.threadApi.getThreadMessage({
            threadMessageId: testData.threadMessageId,
        });
        verifyResponseFor("getThreadMessage", result, ["threadMessage"])
    }
    
    private async listAllThreadMessages() {
        const result = await this.plainApis.threadApi.listThreadMessages({
            from: null,
            limit: 10,
            sortOrder: "asc",
            threadId: testData.threadId,
        });
        verifyResponseFor("listThreadMessages", result, ["list", "count"]);
        assert(result.count === this.newThreadMessages.length + 4);
    }
    
    private async createManyThreadMessages() {
        for (let i = 0; i < 5; i++) {
            const result = await this.apis.threadApi.threadMessageSend({
                data: "New Data!",
                keyId: testData.keyId,
                threadId: testData.threadId
            });
            this.newThreadMessages.push(result.messageId);
        }
    }
    
    private async deleteManyThreadMessages() {
        const result = await this.plainApis.threadApi.deleteManyThreadMessages({
            messageIds: this.newThreadMessages,
        });
        verifyResponseFor("deleteManyThreadMessages", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async validateThreadMessageCount() {
        const result = await this.plainApis.threadApi.listThreadMessages({
            threadId: testData.threadId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listThreads", result, ["list", "count"]);
        assert(result.count === 4);
    }
    
    private async deleteAllMessagesOlderThanNow() {
        const result = await this.plainApis.threadApi.deleteThreadMessagesOlderThan({
            threadId: testData.threadId,
            timestamp: DateUtils.now(),
        });
        verifyResponseFor("deleteManyThreadMessages", result, ["results"]);
        for (const entry of result.results) {
            assert(entry.status === "OK");
        }
    }
    
    private async checkIfAllMessagesAreDeleted() {
        const result = await this.plainApis.threadApi.listThreadMessages({
            threadId: testData.threadId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listThreads", result, ["list", "count"]);
        assert(result.count === 0);
    }
    
    private async deleteSingleThreadMessage() {
        const result = await this.plainApis.threadApi.deleteThreadMessage({
            threadMessageId: testData.threadMessageId,
        });
        verifyResponseIsOK("deleteThreadMessage", result);
    }
}