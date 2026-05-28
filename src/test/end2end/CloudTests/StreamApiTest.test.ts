/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode2, Test } from "../BaseTestSet";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";

export class StreamTests extends BaseTestSet {
    private streamRoomId?: types.stream.StreamRoomId;
    
    @Test({
        config: {
            streams: {
                enabled: "true",
                mediaServer: {
                    fake: false,
                    url: "127.0.0.256", // Invalid on purpose
                    port: "8989",
                },
            },
        },
    })
    async tryUseStreamApiWithoutMediaServer() {
        // Execute checks for all methods
        await this.tryStreamPublish();
        await this.tryStreamRoomUpdate();
        await this.tryStreamRoomGet();
        await this.tryStreamRoomList();
        await this.tryStreamRoomListAll();
        await this.tryStreamList();
        await this.tryStreamAcceptOffer();
        await this.tryStreamTrickle();
        await this.tryStreamGetTurnCredentials();
        await this.tryStreamRoomSendCustomEvent();
        await this.tryStreamsSubscribeToRemote();
        await this.tryStreamsUnsubscribeFromRemote();
        await this.tryStreamsModifyRemoteSubscriptions();
        await this.tryStreamUnpublish();
        await this.tryStreamRoomJoin();
        await this.tryStreamRoomLeave();
    }
    
    @Test({
        config: {
            streams: {
                enabled: "true",
            },
        },
    })
    async tryUseStreamApiOnClosedRoom() {
        await this.createNewStreamRoomForClosedTest();
        
        // Immediately close the room
        await this.tryStreamRoomClose();
        
        // 1. Verify that media/signaling methods fail with STREAM_ROOM_CLOSED
        await this.tryStreamPublishOnClosedRoom();
        await this.tryStreamListOnClosedRoom();
        await this.tryStreamsSubscribeToRemoteOnClosedRoom();
        await this.tryStreamsModifyRemoteSubscriptionsOnClosedRoom();
        await this.tryStreamRoomJoinOnClosedRoom();
        
        // 2. Verify that CRUD methods still work
        await this.tryStreamRoomUpdateOnClosedRoom();
        await this.tryStreamRoomGetOnClosedRoom();
        await this.tryStreamRoomListOnClosedRoom();
        
        // TURN credentials are independent of room state
        await this.tryStreamGetTurnCredentialsOnClosedRoom();
        
        // 3. Cleanup
        await this.tryStreamRoomDeleteOnClosedRoom();
    }
    
    private async createNewStreamRoomForClosedTest() {
        const newStreamRoom = await this.apis.streamApi.streamRoomCreate({
            contextId: testData.contextId,
            data: "AAAA",
            resourceId: this.helpers.generateResourceId(),
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        this.streamRoomId = newStreamRoom.streamRoomId;
    }
    
    private async tryStreamRoomClose() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await this.apis.streamApi.streamRoomClose({
            streamRoomId: this.streamRoomId as types.stream.StreamRoomId,
        });
    }
    
    // --- Methods expected to FAIL with STREAM_ROOM_CLOSED ---
    
    private async tryStreamPublishOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamPublish({
            streamRoomId: this.streamRoomId!,
            offer: {
                type: "offer",
                sdp: "dsadsa",
            },
        }), "STREAM_ROOM_CLOSED");
    }
    
    private async tryStreamListOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamList({
            streamRoomId: this.streamRoomId!,
        }), "STREAM_ROOM_CLOSED");
    }
    
    private async tryStreamsSubscribeToRemoteOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamsSubscribeToRemote({
            streamRoomId: this.streamRoomId!,
            subscriptionsToAdd: [{ streamId: 123 as types.stream.StreamId }],
        }), "STREAM_ROOM_CLOSED");
    }
    
    private async tryStreamsModifyRemoteSubscriptionsOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamsModifyRemoteSubscriptions({
            streamRoomId: this.streamRoomId!,
            subscriptionsToAdd: [{
                streamId: 1 as types.stream.StreamId,
            }],
            subscriptionsToRemove: [],
        }), "STREAM_ROOM_CLOSED");
    }
    
    private async tryStreamRoomJoinOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamRoomJoin({
            streamRoomId: this.streamRoomId!,
        }), "STREAM_ROOM_CLOSED");
    }
    
    // --- Methods expected to SUCCEED (CRUD) ---
    
    private async tryStreamRoomUpdateOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await this.apis.streamApi.streamRoomUpdate({
            id: this.streamRoomId!,
            users: [testData.userId],
            managers: [testData.userId],
            data: "BBBB",
            keyId: testData.keyId,
            keys: [],
            version: 1 as types.stream.StreamRoomVersion,
            force: true,
        });
    }
    
    private async tryStreamRoomGetOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await this.apis.streamApi.streamRoomGet({
            id: this.streamRoomId!,
        });
    }
    
    private async tryStreamRoomListOnClosedRoom() {
        await this.apis.streamApi.streamRoomList({
            contextId: testData.contextId,
            sortOrder: "desc",
            limit: 100,
            skip: 0,
        });
    }
    
    private async tryStreamGetTurnCredentialsOnClosedRoom() {
        await this.apis.streamApi.streamGetTurnCredentials();
    }
    
    private async tryStreamRoomDeleteOnClosedRoom() {
        if (!this.streamRoomId) {
            throw new Error("StreamRoom not initialized");
        }
        await this.apis.streamApi.streamRoomDelete({
            id: this.streamRoomId!,
        });
    }
    
    private async tryStreamPublish() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamPublish({
            streamRoomId: testData.streamRoomId,
            offer: {
                type: "offer",
                sdp: "dsadsa",
            },
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamRoomUpdate() {
        await this.apis.streamApi.streamRoomUpdate({
            id: testData.streamRoomId,
            users: [testData.userId],
            managers: [testData.userId],
            data: "BBBB",
            keyId: testData.keyId,
            keys: [],
            version: 1 as types.stream.StreamRoomVersion,
            force: true,
        });
    }
    
    private async tryStreamRoomGet() {
        await this.apis.streamApi.streamRoomGet({
            id: testData.streamRoomId,
        });
    }
    
    private async tryStreamRoomList() {
        await this.apis.streamApi.streamRoomList({
            contextId: testData.contextId,
            sortOrder: "desc",
            limit: 100,
            skip: 0,
        });
    }
    
    private async tryStreamRoomListAll() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamRoomListAll({
            contextId: testData.contextId,
            sortOrder: "desc",
            limit: 100,
            skip: 0,
        }), "ACCESS_DENIED"); // Default policy
    }
    
    private async tryStreamList() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamList({
            streamRoomId: testData.streamRoomId,
        }), "ERROR_DURING_REQUEST_TO_MEDIA_SERVER");
    }
    
    private async tryStreamAcceptOffer() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamAcceptOffer({
            sessionId: 1234 as types.stream.SessionId,
            answer: {
                type: "answer",
                sdp: "dummy-sdp",
            },
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamTrickle() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamTrickle({
            sessionId: 1234 as types.stream.SessionId,
            rtcCandidate: {
                address: "127.0.0.1",
                candidate: "candidate:1 1 udp 12345678 127.0.0.1 12345 typ host",
                component: "rtp",
                foundation: "1",
                port: 12345,
                priority: 1,
                protocol: "udp",
                relatedAddress: null,
                relatedPort: null,
                sdpMLineIndex: 0,
                sdpMid: "0",
                tcpType: "active",
                type: "host",
                usernameFragment: null,
            },
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamGetTurnCredentials() {
        await this.apis.streamApi.streamGetTurnCredentials();
    }
    
    private async tryStreamRoomSendCustomEvent() {
        await this.apis.streamApi.streamRoomSendCustomEvent({
            streamRoomId: testData.streamRoomId,
            channel: "stream" as types.core.WsChannelName,
            keyId: testData.keyId,
            data: { some: "data" },
        });
    }
    
    private async tryStreamsSubscribeToRemote() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamsSubscribeToRemote({
            streamRoomId: testData.streamRoomId,
            subscriptionsToAdd: [{ streamId: 123 as types.stream.StreamId }],
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamsUnsubscribeFromRemote() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamsUnsubscribeFromRemote({
            streamRoomId: testData.streamRoomId,
            subscriptionsToRemove: [{ streamId: 123 as types.stream.StreamId }],
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamsModifyRemoteSubscriptions() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamsModifyRemoteSubscriptions({
            streamRoomId: testData.streamRoomId,
            subscriptionsToAdd: [],
            subscriptionsToRemove: [],
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamUnpublish() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamUnpublish({
            sessionId: 1234 as types.stream.SessionId,
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamRoomJoin() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamRoomJoin({
            streamRoomId: testData.streamRoomId,
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
    
    private async tryStreamRoomLeave() {
        await shouldThrowErrorWithCode2(() => this.apis.streamApi.streamRoomLeave({
            streamRoomId: testData.streamRoomId,
        }), "CANNOT_CONNECT_TO_MEDIA_SERVER");
    }
}