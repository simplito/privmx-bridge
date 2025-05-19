/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as assert from "assert";
import * as types from "../../../types";
import { PromiseUtils } from "../../../utils/PromiseUtils";
import { testData } from "../../datasets/testData";
import { BaseTestSet, Test } from "../BaseTestSet";

export class NotificationTest extends BaseTestSet {
    
    private customNotificationDataQueue: {eventData: unknown}[] = [];
    private message: string = "";
    private contextUsers?: types.cloud.UserIdentity[];
    private channelSubscriptions: types.core.SubscriptionId[] = [];
    private newThreadId?: types.thread.ThreadId;
    
    @Test()
    async shouldDeliverCustomThreadNotification() {
        await this.subscribeToCustomMyChannelThreadNotificationChannel();
        await this.sendNewCustomMyChannelThreadNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomStoreNotification() {
        await this.subscribeToCustomMyChannelStoreNotificationChannel();
        await this.sendNewCustomMyChannelStoreNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomInboxNotification() {
        await this.subscribeToCustomInboxNotificationChannel();
        await this.sendNewCustomMyChannelInboxNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomStreamNotification() {
        await this.subscribeToCustomMyChannelStreamNotificationChannel();
        await this.sendNewCustomMyChannelStreamNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomContextNotification() {
        await this.subscribeToCustomMyChannelContextNotificationChannel();
        await this.fetchContextUsers();
        await this.sendNewCustomMyChannelContextNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldNotDeliverInternalStreamNotification() {
        await this.subscribeToCustomMyChannelStreamNotificationChannel();
        await this.sendNewInternalStreamNotification();
        await this.sendNewCustomMyChannelStreamNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldNotDeliverInternalStreamNotificationWithNewChannels() {
        await this.subscribeToCustomMyChannelStreamNotificationChannelWithNewChannels();
        await this.sendNewInternalStreamNotification();
        await this.sendNewCustomMyChannelStreamNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomStreamNotificationWithNewChannels() {
        await this.subscribeToCustomMyChannelStreamNotificationChannelWithNewChannels();
        await this.sendNewCustomMyChannelStreamNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomStreamNotificationWithNewChannelsAndSubPath() {
        await this.subscribeToAllCustomStreamNotificationChannelWithNewChannels();
        await this.sendNewCustomStreamNotificationWithSubPathAbc();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomStreamNotificationWithNewChannelsAndSubPathDefOnly() {
        await this.subscribeToCustomStreamNotificationChannelWithNewChannelsWithChannelCustomDef();
        await this.sendNewCustomStreamNotificationWithSubPathAbc();
        await this.sendNewCustomStreamNotificationWithSubPathDef();
        await this.sendNewCustomMyChannelStreamNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomContextNotificationWithNewChannels() {
        await this.subscribeToAllCustomContextNotificationChannelWithNewChannels();
        await this.fetchContextUsers();
        await this.sendNewCustomMyChannelContextNotification();
        await this.checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered();
    }
    
    @Test()
    async shouldSubcribeToAllStreamNotificationsAndReceiveAllNotifications() {
        await this.subscribeToAllCustomStreamNotifications();
        await this.sendNewCustomStreamNotificationWithSubPathAbc();
        await this.sendNewCustomStreamNotificationWithSubPathDef();
        await this.sendNewCustomMyChannelStreamNotification();
        await this.checkIfThreeNotificationWereDelivered();
    }
    
    @Test()
    async shouldSubcribeToStreamChannelsAndThenUnsubscribe() {
        await this.subscribeToAllCustomStreamNotifications();
        await this.unsubscribeFromAllCustomStreamNotifications();
        await this.sendNewCustomStreamNotificationWithSubPathAbc();
        await this.sendNewCustomStreamNotificationWithSubPathDef();
        await this.sendNewCustomMyChannelStreamNotification();
        await this.checkIfNoNotificationWasDelivered();
    }
    
    @Test()
    async shouldSubcribeThreadChannelsAndThenBulkUnsubscribe() {
        await this.startListeningOnEvents();
        await this.subscribeToThreadMessagesChannelWithoutListening();
        await this.subscribeToThreadMessagesChannelWithoutListening();
        await this.subscribeToThreadMessagesChannelWithoutListening();
        await this.sendMessageOnSubscribedThread();
        await this.checkIfSingleNotificationWasDelivered();
        await this.emptyNotificationQueue();
        await this.unsubscribeFromMessagesChannelThreadNotificationChannel();
        await this.sendMessageOnSubscribedThread();
        await this.checkIfNoNotificationWasDelivered();
    }
    
    @Test()
    async shouldSubcribeThreadMessagesDeleteChannelAndReceiveOnlyMessageDeleteNotifications() {
        await this.startListeningOnEvents();
        await this.subscribeToThreadMessagesDeleteChannelWithNewChannelsWithoutListening();
        await this.sendMessageOnSubscribedThread();
        await this.checkIfNoNotificationWasDelivered();
        await this.deleteMessageOnSubscribedThread();
        await this.checkIfSingleNotificationWasDelivered();
    }
    
    @Test()
    async shouldSubcribeThreadMessagesAndReceiveEventAsManager() {
        await this.startListeningOnEvents();
        await this.createNewThreadWithManagerOnly();
        await this.subscribeToThreadMessagesChannel();
        await this.sendMessageOnNewThread();
        await this.checkIfSingleNotificationWasDelivered();
    }
    
    async unsubscribeFromAllCustomStreamNotifications() {
        await this.helpers.unsubscribeFromChannels(this.channelSubscriptions);
    }
    
    async sendNewInternalStreamNotification() {
        const res = await this.apis.streamApi.streamRoomSendCustomEvent({
            streamRoomId: testData.streamRoomId,
            channel: "internal" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: "INTERNALMESSAGE",
        });
        assert(res === "OK", "Unexpected return value from: streamRoomSendCustomEvent(");
    }
    
    async subscribeToCustomMyChannelContextNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`context/${testData.contextId}/MyChannel`);
    }
    
    async fetchContextUsers() {
        const res = await this.apis.contextApi.contextGetUsers({contextId: testData.contextId});
        assert(!!res && "users" in res, "Unexpected return value from contextGetUsers(");
        this.contextUsers = res.users;
    }
    
    async sendNewCustomMyChannelContextNotification() {
        if (!this.contextUsers) {
            throw new Error("Context users not fetched yet");
        }
        this.message = "Context-Custom-9999";
        const res = await this.apis.contextApi.contextSendCustomEvent({
            contextId: testData.contextId,
            channel: "MyChannel" as types.core.WsChannelName,
            data: this.message,
            users: this.contextUsers.map(user => ({
                id: user.id,
                key: btoa(user.pub) as types.core.UserKeyData,
            })),
        });
        assert(res === "OK", "Unexpected return value from: streamRoomSendCustomEvent(");
    }
    
    async subscribeToCustomMyChannelStreamNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`stream/${testData.streamRoomId}/MyChannel`);
    }
    
    async sendNewCustomMyChannelStreamNotification() {
        this.message = "Stream-Custom-9999";
        const res = await this.apis.streamApi.streamRoomSendCustomEvent({
            streamRoomId: testData.streamRoomId,
            channel: "MyChannel" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: streamRoomSendCustomEvent(");
    }
    
    async subscribeToCustomInboxNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`inbox/${testData.inboxId}/MyChannel`);
    }
    
    async sendNewCustomMyChannelInboxNotification() {
        this.message = "Inbox-Custom-9999";
        const res = await this.apis.inboxApi.inboxSendCustomEvent({
            inboxId: testData.inboxId,
            channel: "MyChannel" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: inboxSendCustomEvent(");
    }
    
    async subscribeToCustomMyChannelStoreNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`store/${testData.storeId}/MyChannel`);
    }
    
    async sendNewCustomMyChannelStoreNotification() {
        this.message = "Store-Custom-9999";
        const res = await this.apis.storeApi.storeSendCustomEvent({
            storeId: testData.storeId,
            channel: "MyChannel" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: storeSendCustomEvent(");
    }
    
    async subscribeToCustomMyChannelThreadNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`thread/${testData.threadId}/MyChannel`);
    }
    
    async sendNewCustomMyChannelThreadNotification() {
        this.message = "Thread-Custom-9999";
        const res = await this.apis.threadApi.threadSendCustomEvent({
            threadId: testData.threadId,
            channel: "MyChannel" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: threadSendCustomEvent(");
    }
    
    async checkIfSingleCustomNotificationWithSpecifiedMessageWasDelivered() {
        await PromiseUtils.wait(1000);
        if (this.customNotificationDataQueue.length !== 1) {
            throw new Error(`Custom notification count expected: 1, got: ${this.customNotificationDataQueue.length}`);
        }
        assert((this.customNotificationDataQueue[0].eventData as unknown as string) === this.message, `NOTIFICATION MISSMATCH: got: ${this.customNotificationDataQueue[0].eventData as unknown as string} expected: ${this.message}`);
    }
    
    async checkIfSingleNotificationWasDelivered() {
        await PromiseUtils.wait(1000);
        if (this.customNotificationDataQueue.length !== 1) {
            throw new Error(`Custom notification count expected: 1, got: ${this.customNotificationDataQueue.length}`);
        }
    }
    
    async subscribeToCustomMyChannelStreamNotificationChannelWithNewChannels() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannels([`stream/custom/MyChannel|containerId=${testData.streamRoomId}`]);
    }
    
    async subscribeToAllCustomStreamNotificationChannelWithNewChannels() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannels([`stream/custom|containerId=${testData.streamRoomId}`]);
    }
    
    async subscribeToAllCustomContextNotificationChannelWithNewChannels() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannels([`context/custom|contextId=${testData.contextId}`]);
    }
    
    async subscribeToCustomStreamNotificationChannelWithNewChannelsWithChannelCustomDef() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannels([`stream/custom/def|containerId=${testData.streamRoomId}`]);
    }
    
    async sendNewCustomStreamNotificationWithSubPathAbc() {
        this.message = "Stream-Custom-9999";
        const res = await this.apis.streamApi.streamRoomSendCustomEvent({
            streamRoomId: testData.streamRoomId,
            channel: "abc" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: streamRoomSendCustomEvent(");
    }
    
    async sendNewCustomStreamNotificationWithSubPathDef() {
        this.message = "Stream-Custom-9999";
        const res = await this.apis.streamApi.streamRoomSendCustomEvent({
            streamRoomId: testData.streamRoomId,
            channel: "def" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: streamRoomSendCustomEvent(");
    }
    
    async subscribeToAllCustomStreamNotifications() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        const subscriptions = await this.helpers.subscribeToChannels(["stream/custom"]);
        this.channelSubscriptions = this.channelSubscriptions.concat(subscriptions.subscriptions.map(sub => sub.subscriptionId) as types.core.SubscriptionId[]);
    }
    
    async checkIfThreeNotificationWereDelivered() {
        await PromiseUtils.wait(1000);
        assert(this.customNotificationDataQueue.length === 3, `Custom notification count expected: 3, got: ${this.customNotificationDataQueue.length}`);
        assert(this.customNotificationDataQueue.every(event => event.eventData as unknown as string === this.message), "NOTIFICATION MISSMATCH");
    }
    
    async checkIfNoNotificationWasDelivered() {
        await PromiseUtils.wait(1000);
        assert(this.customNotificationDataQueue.length === 0, `Custom notification count expected: 0, got: ${this.customNotificationDataQueue.length}`);
    }
    
    async subscribeToThreadMessagesChannelWithoutListening() {
        const res = await this.helpers.subscribeToChannel(`thread/${testData.threadId}/messages`);
        this.channelSubscriptions.push(res.subscriptionId as types.core.SubscriptionId);
    }
    
    async subscribeToThreadMessagesDeleteChannelWithNewChannelsWithoutListening() {
        const res = await this.helpers.subscribeToChannels([`thread/messages/delete|containerId=${testData.threadId}`]);
        this.channelSubscriptions.push(res.subscriptions[0].subscriptionId);
    }
    
    async startListeningOnEvents() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
    }
    
    async unsubscribeFromMessagesChannelThreadNotificationChannel() {
        await this.helpers.unsubscribeFromChannel(`thread/${testData.threadId}/messages`);
    }
    
    async sendMessageOnSubscribedThread() {
        const res = await this.apis.threadApi.threadMessageSend({
            threadId: testData.threadId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
        });
        assert(!!res.messageId, "Unexpected return value from threadMessageSend(");
    }
    
    async emptyNotificationQueue() {
        this.customNotificationDataQueue = [];
    }
    
    async deleteMessageOnSubscribedThread() {
        const res = await this.apis.threadApi.threadMessageDelete({
            messageId: testData.threadMessageId,
        });
        assert(res === "OK", "Unexpected return value from threadMessageDelete(");
    }
    
    async subscribeToThreadMessagesChannel() {
        const res = await this.helpers.subscribeToChannels(["thread/messages/create"]);
        this.channelSubscriptions.push(res.subscriptions[0].subscriptionId);
    }
    
    private async createNewThreadWithManagerOnly() {
        const newThread = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [],
        });
        this.newThreadId = newThread.threadId;
    }
    
    async sendMessageOnNewThread() {
        if (!this.newThreadId) {
            throw new Error("newThreadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessageSend({
            threadId: this.newThreadId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA" as types.thread.ThreadMessageData,
            keyId: testData.keyId,
        });
        assert(!!res.messageId, "Unexpected return value from threadMessageSend(");
    }
}
