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
import { StreamApiClient } from "../../../api/main/stream/StreamApiClient";

const streamsEnabledFake = {
    config: {
        streams: {
            enabled: "true",
            mediaServer: {
                fake: true,
            },
        },
    },
};

interface CapturedEvent {
    notificationType: string;
    data: any;
}

export class StreamEventsTest extends BaseTestSet {
    private events: CapturedEvent[] = [];
    
    @Test(streamsEnabledFake)
    async shouldEmitBroadcastMediaEventsAcrossTheLifecycle() {
        const streamRoomId = await this.createStreamRoom();
        this.captureNotifications();
        await this.helpers.subscribeToChannels([`streamroom|containerId=${streamRoomId}`]);
        
        await this.apis.streamApi.streamRoomJoin({ streamRoomId });
        const published = await this.apis.streamApi.streamPublish({ streamRoomId, offer: { type: "offer", sdp: "x" } });
        await this.apis.streamApi.streamUpdate({ streamRoomId, offer: { type: "offer", sdp: "y" } });
        await this.apis.streamApi.streamsSubscribeToRemote({ streamRoomId, subscriptionsToAdd: [{ streamId: 7 as types.stream.StreamId }] });
        await this.apis.streamApi.streamsUnsubscribeFromRemote({ streamRoomId, subscriptionsToRemove: [{ streamId: 7 as types.stream.StreamId }] });
        await this.apis.streamApi.streamUnpublish({ sessionId: published.sessionId });
        await this.apis.streamApi.streamRoomLeave({ streamRoomId });
        
        await PromiseUtils.wait(1500);
        
        this.assertEvent("streamRoomJoined", streamRoomId);
        this.assertEvent("streamPublished", streamRoomId);
        this.assertEvent("streamUpdated", streamRoomId);
        this.assertEvent("streamSubscribed", streamRoomId);
        this.assertEvent("streamUnsubscribed", streamRoomId);
        this.assertEvent("streamUnpublished", streamRoomId);
        this.assertEvent("streamRoomLeft", streamRoomId);
    }
    
    @Test(streamsEnabledFake)
    async shouldDeliverEventsOnlyOnTheirOwnChannel() {
        const streamRoomId = await this.createStreamRoom();
        this.captureNotifications();
        await this.helpers.subscribeToChannels([`streamroom/streams/publish|containerId=${streamRoomId}`]);
        
        await this.apis.streamApi.streamRoomJoin({ streamRoomId });
        await this.apis.streamApi.streamPublish({ streamRoomId, offer: { type: "offer", sdp: "x" } });
        
        await PromiseUtils.wait(1500);
        
        assert(this.has("streamPublished"), "expected streamPublished on its channel");
        assert(!this.has("streamRoomJoined"), "streamRoomJoined must NOT arrive on the publish channel");
    }
    
    @Test(streamsEnabledFake)
    async shouldEmitLeftAndUnpublishedWhenAPublisherDisconnects() {
        const streamRoomId = await this.createStreamRoom();
        this.captureNotifications();
        await this.helpers.subscribeToChannels([`streamroom|containerId=${streamRoomId}`]);
        
        const other = await this.helpers.createNewConnection(testData.userPrivKey, testData.solutionId);
        const otherStreamApi = new StreamApiClient(other);
        await otherStreamApi.streamRoomJoin({ streamRoomId });
        await otherStreamApi.streamPublish({ streamRoomId, offer: { type: "offer", sdp: "x" } });
        await PromiseUtils.wait(300);
        other.destroy();
        
        await PromiseUtils.wait(1500);
        
        this.assertEvent("streamRoomLeft", streamRoomId);
        this.assertEvent("streamUnpublished", streamRoomId);
    }
    
    @Test(streamsEnabledFake)
    async shouldEmitLeftAndUnpublishedWhenAPublisherUnauthorizes() {
        const streamRoomId = await this.createStreamRoom();
        this.captureNotifications();
        await this.helpers.subscribeToChannels([`streamroom|containerId=${streamRoomId}`]);
        
        const other = await this.helpers.createNewConnection(testData.userPrivKey, testData.solutionId);
        const otherStreamApi = new StreamApiClient(other);
        await otherStreamApi.streamRoomJoin({ streamRoomId });
        await otherStreamApi.streamPublish({ streamRoomId, offer: { type: "offer", sdp: "x" } });
        await PromiseUtils.wait(300);
        // Unauthorize (not socket close) must still tear down the user's media for the room.
        // Must run over the websocket channel so the session being de-authorized is the ws session.
        await other.call("unauthorizeWebSocket", {}, { channelType: "websocket" });
        
        await PromiseUtils.wait(1500);
        
        this.assertEvent("streamRoomLeft", streamRoomId);
        this.assertEvent("streamUnpublished", streamRoomId);
    }
    
    @Test(streamsEnabledFake)
    async shouldEmitUnsubscribedWhenASubscriberLeavesTheRoom() {
        const streamRoomId = await this.createStreamRoom();
        this.captureNotifications();
        await this.helpers.subscribeToChannels([`streamroom|containerId=${streamRoomId}`]);
        
        const other = await this.helpers.createNewConnection(testData.userPrivKey, testData.solutionId);
        const otherStreamApi = new StreamApiClient(other);
        await otherStreamApi.streamRoomJoin({ streamRoomId });
        await otherStreamApi.streamsSubscribeToRemote({ streamRoomId, subscriptionsToAdd: [{ streamId: 7 as types.stream.StreamId }] });
        await PromiseUtils.wait(300);
        // Leaving while subscribed must report the viewer gone (streamUnsubscribed), not just streamRoomLeft.
        await otherStreamApi.streamRoomLeave({ streamRoomId });
        
        await PromiseUtils.wait(1500);
        
        this.assertEvent("streamUnsubscribed", streamRoomId);
        this.assertEvent("streamRoomLeft", streamRoomId);
    }
    
    @Test(streamsEnabledFake)
    async shouldEmitUnsubscribedWhenASubscriberDisconnects() {
        const streamRoomId = await this.createStreamRoom();
        this.captureNotifications();
        await this.helpers.subscribeToChannels([`streamroom|containerId=${streamRoomId}`]);
        
        const other = await this.helpers.createNewConnection(testData.userPrivKey, testData.solutionId);
        const otherStreamApi = new StreamApiClient(other);
        await otherStreamApi.streamRoomJoin({ streamRoomId });
        await otherStreamApi.streamsSubscribeToRemote({ streamRoomId, subscriptionsToAdd: [{ streamId: 7 as types.stream.StreamId }] });
        await PromiseUtils.wait(300);
        // Disconnecting while subscribed must also report the viewer gone.
        other.destroy();
        
        await PromiseUtils.wait(1500);
        
        this.assertEvent("streamUnsubscribed", streamRoomId);
        this.assertEvent("streamRoomLeft", streamRoomId);
    }
    
    @Test(streamsEnabledFake)
    async shouldListSubscribersAndTheirSubscriptions() {
        const streamRoomId = await this.createStreamRoom();
        
        await this.apis.streamApi.streamRoomJoin({ streamRoomId });
        await this.apis.streamApi.streamPublish({ streamRoomId, offer: { type: "offer", sdp: "x" } });
        await this.apis.streamApi.streamsSubscribeToRemote({ streamRoomId, subscriptionsToAdd: [{ streamId: 7 as types.stream.StreamId }] });
        
        const subscribed = await this.apis.streamApi.streamRoomListParticipants({ streamRoomId });
        assert(subscribed.list.length === 1, `expected one subscriber, got ${subscribed.list.length}`);
        assert(subscribed.list[0].userId === testData.userId, `subscriber userId mismatch (got ${subscribed.list[0].userId})`);
        assert(subscribed.list[0].subscriptions.length === 1 && Number(subscribed.list[0].subscriptions[0].streamId) === 7, "expected the subscription to stream 7");
        
        await this.apis.streamApi.streamsUnsubscribeFromRemote({ streamRoomId, subscriptionsToRemove: [{ streamId: 7 as types.stream.StreamId }] });
        
        const afterUnsubscribe = await this.apis.streamApi.streamRoomListParticipants({ streamRoomId });
        assert(afterUnsubscribe.list.length === 0, `expected no subscribers after unsubscribe, got ${afterUnsubscribe.list.length}`);
    }
    
    private async createStreamRoom(): Promise<types.stream.StreamRoomId> {
        const res = await this.apis.streamApi.streamRoomCreate({
            contextId: testData.contextId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA",
            keyId: testData.keyId,
            keys: [{ user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData }],
            managers: [testData.userId],
            users: [testData.userId],
        });
        return res.streamRoomId;
    }
    
    private captureNotifications() {
        this.helpers.addEventListenerForNotification(evt => {
            this.events.push({ notificationType: evt.notificationType, data: evt.data });
        });
    }
    
    private has(type: string): boolean {
        return this.events.some(e => e.notificationType === type);
    }
    
    private assertEvent(type: string, streamRoomId: types.stream.StreamRoomId) {
        const found = this.events.filter(e => e.notificationType === type);
        assert(found.length >= 1, `expected event ${type}, got: [${this.events.map(e => e.notificationType).join(", ")}]`);
        assert(found[0].data.streamRoomId === streamRoomId, `${type}: streamRoomId mismatch (got ${found[0].data.streamRoomId})`);
        assert(found[0].data.userId === testData.userId, `${type}: userId mismatch (got ${found[0].data.userId})`);
    }
}
