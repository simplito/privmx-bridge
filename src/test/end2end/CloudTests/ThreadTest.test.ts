/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode2, Test } from "../BaseTestSet";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";

export class ThreadTests extends BaseTestSet {
    
    private messageIds: types.thread.ThreadMessageId[] = [];
    private threadId?: types.thread.ThreadId;
    private messageId?: types.thread.ThreadMessageId;
    
    @Test()
    async shouldDeleteManyThreadMessages() {
        await this.createNewThread();
        await this.sendHundredMessages();
        await this.fetchMessagesAndCheckTheirCount();
        await this.deleteAllSendMessages();
        await this.fetchMessagesAndCheckIfEmpty();
    }
    
    @Test()
    async shouldUpdateThreadMessages() {
        await this.createNewThread();
        await this.sendMessage();
        await this.updateMessageWithVersion();
        await this.updateMessageWithVersionSecondTime();
        await this.updateMessage();
        await this.tryUpdateMessageWithInvalidVersionAndFail();
        await this.updateMessageWithForce();
    }
    
    private async createNewThread() {
        const newThread = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        
        this.threadId = newThread.threadId;
    }
    
    private async sendHundredMessages() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        for (let i = 0; i < 100; i++ ) {
            const res = await this.apis.threadApi.threadMessageSend({
                threadId: this.threadId,
                data: "AAAA" as types.thread.ThreadMessageData,
                keyId: testData.keyId,
            });
            this.messageIds.push(res.messageId);
        }
    }
    
    private async fetchMessagesAndCheckTheirCount() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            sortOrder: "asc",
        });
        assert(res.count === 100, `Message count does not match expected 100! instead:${res.count}`);
    }
    
    private async deleteAllSendMessages() {
        const res = await this.apis.threadApi.threadMessageDeleteMany({
            messageIds: this.messageIds,
        });
        
        for (const result of res.results) {
            assert(result.status === "OK", `Deletion failed!: ${JSON.stringify(result)}`);
        }
    }
    
    private async fetchMessagesAndCheckIfEmpty() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            sortOrder: "asc",
        });
        assert(res.count === 0, `Message count does not match expected 0! instead:${res.count}`);
    }
    
    private async sendMessage() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessageSend({
            threadId: this.threadId,
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
        });
        this.messageId = res.messageId;
    }
    
    private async updateMessage() {
        if (!this.messageId) {
            throw new Error("messageId not initialized yet");
        }
        await this.apis.threadApi.threadMessageUpdate({
            messageId: this.messageId,
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
        });
    }
    
    private async updateMessageWithVersion() {
        if (!this.messageId) {
            throw new Error("messageId not initialized yet");
        }
        await this.apis.threadApi.threadMessageUpdate({
            messageId: this.messageId,
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
            version: 1 as types.thread.ThreadMessageVersion,
        });
    }
    private async updateMessageWithVersionSecondTime() {
        if (!this.messageId) {
            throw new Error("messageId not initialized yet");
        }
        await this.apis.threadApi.threadMessageUpdate({
            messageId: this.messageId,
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
            version: 2 as types.thread.ThreadMessageVersion,
        });
    }
    
    private async tryUpdateMessageWithInvalidVersionAndFail() {
        if (!this.messageId) {
            throw new Error("messageId not initialized yet");
        }
        const messageId = this.messageId;
        await shouldThrowErrorWithCode2(() => this.apis.threadApi.threadMessageUpdate({
            messageId: messageId,
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
            version: 999 as types.thread.ThreadMessageVersion,
        }), "ACCESS_DENIED");
    }
    
    private async updateMessageWithForce() {
        if (!this.messageId) {
            throw new Error("messageId not initialized yet");
        }
        await this.apis.threadApi.threadMessageUpdate({
            messageId: this.messageId,
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
            version: 999 as types.thread.ThreadMessageVersion,
            force: true,
        });
    }
}
