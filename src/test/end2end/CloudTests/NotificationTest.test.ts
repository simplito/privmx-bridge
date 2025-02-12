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
    
    @Test()
    async shouldDeliverCustomThreadNotification() {
        await this.subscribeToCustomThreadNotificationChannel();
        await this.sendNewCustomThreadNotification();
        await this.checkIfSingleNotificationWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomStoreNotification() {
        await this.subscribeToCustomStoreNotificationChannel();
        await this.sendNewCustomStoreNotification();
        await this.checkIfSingleNotificationWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomInboxNotification() {
        await this.subscribeToCustomInboxNotificationChannel();
        await this.sendNewCustomInboxNotification();
        await this.checkIfSingleNotificationWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomStreamNotification() {
        await this.subscribeToCustomStreamNotificationChannel();
        await this.sendNewCustomStreamNotification();
        await this.checkIfSingleNotificationWasDelivered();
    }
    
    @Test()
    async shouldDeliverCustomContextNotification() {
        await this.subscribeToCustomContextNotificationChannel();
        await this.fetchContextUsers();
        await this.sendNewCustomContextNotification();
        await this.checkIfSingleNotificationWasDelivered();
    }
    
    @Test()
    async shouldNotDeliverInternalStreamNotification() {
        await this.subscribeToCustomStreamNotificationChannel();
        await this.sendNewInternalStreamNotification();
        await this.sendNewCustomStreamNotification();
        await this.checkIfSingleNotificationWasDelivered();
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
    
    async subscribeToCustomContextNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`context/${testData.contextId}/custom`);
    }
    
    async fetchContextUsers() {
        const res = await this.apis.contextApi.contextGetUsers({contextId: testData.contextId});
        assert(!!res && "users" in res, "Unexpected return value from contextGetUsers(");
        this.contextUsers = res.users;
    }
    
    async sendNewCustomContextNotification() {
        if (!this.contextUsers) {
            throw new Error("Context users not fetched yet");
        }
        this.message = "Context-Custom-9999";
        const res = await this.apis.contextApi.contextSendCustomEvent({
            contextId: testData.contextId,
            channel: "custom" as types.core.WsChannelName,
            data: this.message,
            users: this.contextUsers.map(user => ({
                id: user.id,
                key: btoa(user.pub) as types.core.UserKeyData,
            })),
        });
        assert(res === "OK", "Unexpected return value from: streamRoomSendCustomEvent(");
    }
    
    async subscribeToCustomStreamNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`stream/${testData.streamRoomId}/custom`);
    }
    
    async sendNewCustomStreamNotification() {
        this.message = "Stream-Custom-9999";
        const res = await this.apis.streamApi.streamRoomSendCustomEvent({
            streamRoomId: testData.streamRoomId,
            channel: "custom" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: streamRoomSendCustomEvent(");
    }
    
    async subscribeToCustomInboxNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`inbox/${testData.inboxId}/custom`);
    }
    
    async sendNewCustomInboxNotification() {
        this.message = "Inbox-Custom-9999";
        const res = await this.apis.inboxApi.inboxSendCustomEvent({
            inboxId: testData.inboxId,
            channel: "custom" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: inboxSendCustomEvent(");
    }
    
    async subscribeToCustomStoreNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`store/${testData.storeId}/custom`);
    }
    
    async sendNewCustomStoreNotification() {
        this.message = "Store-Custom-9999";
        const res = await this.apis.storeApi.storeSendCustomEvent({
            storeId: testData.storeId,
            channel: "custom" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: storeSendCustomEvent(");
    }
    
    async subscribeToCustomThreadNotificationChannel() {
        this.helpers.addEventListenerForNotification(evt => {
            this.customNotificationDataQueue.push(evt.data as {eventData: unknown});
        });
        await this.helpers.subscribeToChannel(`thread/${testData.threadId}/custom`);
    }
    
    async sendNewCustomThreadNotification() {
        this.message = "Thread-Custom-9999";
        const res = await this.apis.threadApi.threadSendCustomEvent({
            threadId: testData.threadId,
            channel: "custom" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: this.message,
        });
        assert(res === "OK", "Unexpected return value from: threadSendCustomEvent(");
    }
    
    async checkIfSingleNotificationWasDelivered() {
        await PromiseUtils.wait(1000);
        if (this.customNotificationDataQueue.length !== 1) {
            throw new Error(`Custom notification count expected: 1, got: ${this.customNotificationDataQueue.length}`);
        }
        assert((this.customNotificationDataQueue[0].eventData as unknown as string) === this.message, `NOTIFICATION MISSMATCH: got: ${this.customNotificationDataQueue[0].eventData as unknown as string} expected: ${this.message}`);
    }
}
