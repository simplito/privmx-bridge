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
    private resourceId?: types.core.ClientResourceId;
    
    @Test()
    async shouldDeleteManyThreadMessages() {
        await this.createNewThreadWithResourceId();
        await this.sendHundredMessages();
        await this.fetchMessagesAndCheckTheirCount();
        await this.deleteAllSendMessages();
        await this.fetchMessagesAndCheckIfEmpty();
    }
    
    @Test()
    async shouldUpdateThreadMessages() {
        await this.createNewThreadWithResourceId();
        await this.sendMessage();
        await this.updateMessageWithVersion();
        await this.updateMessageWithVersionSecondTime();
        await this.updateMessage();
        await this.tryUpdateMessageWithInvalidVersionAndFail();
        await this.updateMessageWithForce();
    }
    
    @Test()
    async shouldCreateNewThreadWithResourceIdAndReceiveResourceIdThenCheckIfItCanBeUpdated() {
        await this.createNewThreadWithResourceId();
        await this.fetchThreadAndCheckIfResourceIdIsSet();
        await this.updateThreadWithProvidedResourceId();
        await this.fetchThreadAndCheckIfResourceIdIsSet();
        await this.tryUpdateThreadWithInvalidResourceId();
        await this.updateThreadWithoutResourceId();
        await this.fetchThreadAndCheckIfResourceIdIsSet();
    }
    
    @Test()
    async shouldCreateNewThreadWithoutResourceIdAndReceiveResourceIdThenSetResourceIdAndTestBehavior() {
        await this.createNewThreadWithoutResourceId();
        await this.fetchThreadAndCheckIfResourceIdIsNotSet();
        await this.updateThreadAndSetItsResourceId();
        await this.fetchThreadAndCheckIfResourceIdIsSet();
        await this.updateThreadWithProvidedResourceId();
        await this.fetchThreadAndCheckIfResourceIdIsSet();
        await this.tryUpdateThreadWithInvalidResourceId();
        await this.updateThreadWithoutResourceId();
        await this.fetchThreadAndCheckIfResourceIdIsSet();
    }
    
    @Test()
    async shouldUpdateTwoThreadWithoutResourceIdAndThenMigrateThem() {
        await this.createNewThreadWithoutResourceId();
        await this.updateThreadWithoutResourceId();
        await this.updateExistingThreadWithoutResourceId();
        await this.addResourceIdToExistingThread();
        await this.tryAddDuplicatedResourceIdWithUpdateAndFail();
        await this.addResourceIdToNewThread();
    }
    
    @Test()
    async shouldNotBeAbleToCreateThreadWithDuplicatedResourceId() {
        await this.createNewThreadWithResourceId();
        await this.tryCreateThreadWithDuplicatedResourceIdAndFail();
    }
    
    @Test()
    async shouldFetchThreadMessagesSortedByCreateDate() {
        await this.createNewThreadWithResourceId();
        await this.sendHundredMessages();
        await this.fetchMessagesByNewestAndCheckTheirOrder();
        await this.fetchMessagesByOldestAndCheckTheirOrder();
    }
    
    @Test()
    async shouldFetchThreadMessagesSortedByUpdates() {
        await this.createNewThreadWithResourceId();
        await this.sendHundredMessages();
        await this.fetchMessagesByUpdatesAndCheckTheirCount();
        await this.updateSendMessages();
        await this.fetchMessagesByLastModifiedAndCheckTheirOrder();
        await this.fetchMessagesByFirstModifiedAndCheckTheirOrder();
    }
    
    @Test()
    async shouldFetchThreadsInDifferentScopes() {
        this.helpers.authorizePlainApi();
        await this.updateContextPolicyToAllowListingAllContainers();
        await this.createNewThreadWithManagerOnly();
        await this.tryListAllThreadByContextOnly();
        await this.tryListThreadByCreator();
        await this.tryListThreadByUser();
        await this.tryListThreadByManager();
        await this.tryListThreadByMember();
    }
    
    private async addResourceIdToExistingThread() {
        this.resourceId = this.helpers.generateResourceId();
        const res = await this.apis.threadApi.threadUpdate({
            id: testData.threadId,
            resourceId: this.resourceId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async addResourceIdToNewThread() {
        if (!this.threadId) {
            throw new Error("threadId not set or initialized yet");
        }
        const res = await this.apis.threadApi.threadUpdate({
            id: this.threadId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async tryAddDuplicatedResourceIdWithUpdateAndFail() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const threadId = this.threadId;
        const resourceId = this.resourceId;
        await shouldThrowErrorWithCode2(() => this.apis.threadApi.threadUpdate({
            id: threadId,
            resourceId: resourceId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        }), "DUPLICATE_RESOURCE_ID");
    }
    
    private async createNewThreadWithResourceId() {
        this.resourceId = this.helpers.generateResourceId();
        const newThread = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            resourceId: this.resourceId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        
        this.threadId = newThread.threadId;
    }
    
    private async updateContextPolicyToAllowListingAllContainers() {
        const result = await this.plainApis.contextApi.updateContext({
            contextId: testData.contextId,
            policy: {
                thread: {
                    listAll: "all",
                },
            },
        });
        assert(result === "OK", "Unexpected response from updateContext");
    }
    
    private async createNewThreadWithManagerOnly() {
        this.resourceId = this.helpers.generateResourceId();
        const newThread = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            resourceId: this.resourceId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [],
        });
        
        this.threadId = newThread.threadId;
    }
    
    private async tryListAllThreadByContextOnly() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const result = await this.apis.threadApi.threadList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc", scope: "ALL"});
        assert(result.count === 2, "thread count missmatch");
    }
    
    private async tryListThreadByManager() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const result = await this.apis.threadApi.threadList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc", scope: "MANAGER"});
        assert(result.count === 2, "thread count missmatch");
    }
    
    private async tryListThreadByMember() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const result = await this.apis.threadApi.threadList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc", scope: "MEMBER"});
        assert(result.count === 2, "thread count missmatch");
    }
    
    private async tryListThreadByUser() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const result = await this.apis.threadApi.threadList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc", scope: "USER"});
        assert(result.count === 1, "thread count missmatch");
    }
    
    private async tryListThreadByCreator() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const result = await this.apis.threadApi.threadList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc", scope: "OWNER"});
        assert(result.count === 2, "thread count missmatch");
    }
    
    private async createNewThreadWithoutResourceId() {
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
    
    private async fetchThreadAndCheckIfResourceIdIsSet() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const res = await this.apis.threadApi.threadGet({
            threadId: this.threadId,
        });
        assert(!!res && !!res.thread.resourceId && res.thread.resourceId === this.resourceId, "Invalid response object");
    }
    
    private async fetchThreadAndCheckIfResourceIdIsNotSet() {
        if (!this.threadId) {
            throw new Error("threadId not set or initialized yet");
        }
        const res = await this.apis.threadApi.threadGet({
            threadId: this.threadId,
        });
        assert(!!res && !res.thread.resourceId, "Invalid response object");
    }
    
    private async sendHundredMessages() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        for (let i = 0; i < 100; i++ ) {
            const res = await this.apis.threadApi.threadMessageSend({
                threadId: this.threadId,
                resourceId: this.helpers.generateResourceId(),
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
        assert(res.count === 100 && res.messages.length === 100, `Message count does not match expected 100! instead:${res.count}`);
        
        const firstMessageId = res.messages[0].id;
        const secondMessageId = res.messages[1].id;
        const thirdMessageId = res.messages[2].id;
        
        const res2 = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            lastId: firstMessageId,
            sortOrder: "asc",
        });
        assert(res2.count === 99 && res2.messages.length === 99, `Message count does not match expected 99! instead:${res2.count}`);
        
        const res3 = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            lastId: secondMessageId,
            sortOrder: "asc",
        });
        assert(res3.count === 98 && res3.messages.length === 98, `Message count does not match expected 98! instead:${res3.count}`);
        
        const res4 = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            lastId: thirdMessageId,
            sortOrder: "asc",
        });
        assert(res4.count === 97 && res4.messages.length === 97, `Message count does not match expected 97! instead:${res4.count}`);
    }
    
    private async fetchMessagesByUpdatesAndCheckTheirCount() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            sortBy: "updates",
            sortOrder: "asc",
        });
        assert(res.count === 100, `Message count does not match expected 100! instead:${res.count}`);
    }
    
    private async fetchMessagesByNewestAndCheckTheirOrder() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            sortBy: "createDate",
            sortOrder: "desc",
        });
        
        assert(res.count === 100, `Message count does not match expected 100! instead:${res.count}`);
        let lastMessageTimestamp = Infinity;
        for (const message of res.messages) {
            assert(message.createDate < lastMessageTimestamp, "Messages are in wrong order");
            lastMessageTimestamp = message.createDate;
        }
    }
    
    private async fetchMessagesByOldestAndCheckTheirOrder() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            sortBy: "createDate",
            sortOrder: "asc",
        });
        
        assert(res.count === 100, `Message count does not match expected 100! instead:${res.count}`);
        let lastMessageTimestamp = 0;
        for (const message of res.messages) {
            assert(message.createDate > lastMessageTimestamp, "Messages are in wrong order");
            lastMessageTimestamp = message.createDate;
        }
    }
    
    private async fetchMessagesByLastModifiedAndCheckTheirOrder() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            sortBy: "updates",
            sortOrder: "desc",
        });
        
        assert(res.count === 100, `Message count does not match expected 100! instead:${res.count}`);
        let lastMessageTimestamp = Infinity;
        for (const message of res.messages) {
            assert(message.updates.length === 1 && message.updates[0].createDate < lastMessageTimestamp, "Messages are in wrong order");
            lastMessageTimestamp = message.updates[0].createDate;
        }
    }
    
    private async fetchMessagesByFirstModifiedAndCheckTheirOrder() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 100,
            skip: 0,
            sortBy: "updates",
            sortOrder: "asc",
        });
        
        assert(res.count === 100, `Message count does not match expected 100! instead:${res.count}`);
        let lastMessageTimestamp = 0;
        for (const message of res.messages) {
            assert(message.updates.length === 1 && message.updates[0].createDate > lastMessageTimestamp, "Messages are in wrong order");
            lastMessageTimestamp = message.updates[0].createDate;
        }
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
            resourceId: this.helpers.generateResourceId(),
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
        }), "INVALID_VERSION");
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
    
    private async tryCreateThreadWithDuplicatedResourceIdAndFail() {
        if (!this.resourceId) {
            throw new Error("resourceId not set yet");
        }
        const resourceId = this.resourceId;
        await shouldThrowErrorWithCode2(() => this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        }), "DUPLICATE_RESOURCE_ID");
    }
    
    private async updateThreadWithProvidedResourceId() {
        if (!this.threadId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const res = await this.apis.threadApi.threadUpdate({
            id: this.threadId,
            resourceId: this.resourceId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async tryUpdateThreadWithInvalidResourceId() {
        if (!this.threadId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const threadId = this.threadId;
        const randomResourceId = this.helpers.generateResourceId();
        await shouldThrowErrorWithCode2(() => this.apis.threadApi.threadUpdate({
            id: threadId,
            resourceId: randomResourceId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        }), "RESOURCE_ID_MISSMATCH");
    }
    
    private async updateThreadWithoutResourceId() {
        if (!this.threadId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const res = await this.apis.threadApi.threadUpdate({
            id: this.threadId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async updateThreadAndSetItsResourceId() {
        if (!this.threadId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        this.resourceId = this.helpers.generateResourceId();
        const res = await this.apis.threadApi.threadUpdate({
            id: this.threadId,
            resourceId: this.resourceId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async updateExistingThreadWithoutResourceId() {
        const res = await this.apis.threadApi.threadUpdate({
            id: testData.threadId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.thread.ThreadVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async updateSendMessages() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        for (const messageId of this.messageIds) {
            await this.apis.threadApi.threadMessageUpdate({
                messageId: messageId,
                data: "AAAA" as types.thread.ThreadMessageData,
                keyId: testData.keyId,
            });
        }
    }
}
