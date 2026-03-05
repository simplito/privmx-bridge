/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { StreamRoomId } from "privmx-cloud-server-api/src/context";
import { PublisherAsStream, RTCIceCandidate, StreamTrackModification} from "../../../service/webrtc/v2/WebRtcTypes";
import * as types from "../../../types";
import { UserId } from "../../../types/cloud";

export interface StreamRoom {
    id: types.stream.StreamRoomId
    resourceId?: types.core.ClientResourceId;
    contextId: types.context.ContextId;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: types.stream.StreamRoomDataEntry[];
    keyId: types.core.KeyId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.stream.StreamRoomVersion;
    type?: types.stream.StreamRoomType;
    policy: types.cloud.ContainerWithoutItemPolicy;
    closed: boolean;
}

export interface StreamRoomCreateModel {
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.stream.StreamRoomType;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.stream.StreamRoomData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerWithoutItemPolicy;
}

export interface StreamRoomCreateResult {
    streamRoomId: types.stream.StreamRoomId;
}

export interface StreamRoomUpdateModel {
    id: types.stream.StreamRoomId;
    resourceId?: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.stream.StreamRoomData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.stream.StreamRoomVersion;
    force: boolean;
    policy?: types.cloud.ContainerWithoutItemPolicy;
}

export interface StreamRoomDeleteModel {
    id: types.stream.StreamRoomId;
}

export interface StreamRoomDeleteManyModel {
    ids: types.stream.StreamRoomId[];
}

export interface StreamRoomGetModel {
    id: types.stream.StreamRoomId;
    type?: types.stream.StreamRoomType;
}

export interface StreamRoomGetResult {
    streamRoom: StreamRoom;
}

export interface SteramRoomDeleteManyResult {
    results: types.stream.StreamRoomDeleteStatus[];
}

export interface StreamRoomListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    scope?: types.core.ContainerAccessScope;
    type?: types.stream.StreamRoomType;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface  StreamRoomListAllModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.stream.StreamRoomType;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface StreamRoomListResult {
    list: StreamRoom[];
    count: number;
}

export interface StreamListModel {
    streamRoomId: types.stream.StreamRoomId;
}

export interface StreamListResult {
    list: PublisherAsStream[];
}

export interface StreamPublishModel {
    streamRoomId: types.stream.StreamRoomId;
    offer: {
        type: "offer";
        sdp: string;
    };
}

export interface StreamPublishResult {
    sessionId: types.stream.SessionId;
    answer?: {
        type: "answer";
        sdp: string;
    };
    publishedData?: {
        streamRoomId: StreamRoomId;
        stream: PublisherAsStream;
        userId: UserId;
    }
}

export interface StreamUpdateModel {
    streamRoomId: types.stream.StreamRoomId;
    offer: {
        type: "offer";
        sdp: string;
    };
}

export interface StreamUpdateResult {
    sessionId: types.stream.SessionId;
    answer?: {
        type: "answer";
        sdp: string;
    };
    publishedData?: {
        streamRoomId: StreamRoomId;
        stream: PublisherAsStream;
        userId: UserId;
    }
}

export interface StreamSubscription {
    streamId: types.stream.StreamId;
    streamTrackId?: types.stream.StreamTrackId;
}

export interface StreamsSubscribeModel {
    streamRoomId: types.stream.StreamRoomId;
    subscriptionsToAdd: StreamSubscription[];
}

export interface StreamsUnsubscribeModel {
    streamRoomId: types.stream.StreamRoomId;
    subscriptionsToRemove: StreamSubscription[];
}

export interface StreamModifySubscriptionModel {
    streamRoomId: types.stream.StreamRoomId;
    subscriptionsToAdd: StreamSubscription[];
    subscriptionsToRemove: StreamSubscription[];
}

export interface StreamTrickleModel {
    sessionId: types.stream.SessionId;
    rtcCandidate: RTCIceCandidate;
}

export interface StreamSubscribeResult {
    offer?: {
        type: "offer";
        sdp: string;
    };
    sessionId: types.stream.SessionId;
}

export interface StreamAcceptOfferModel {
    sessionId: types.stream.SessionId;
    answer: {
        type: "answer";
        sdp: string;
    };
}

export interface StreamSetNewOfferModel {
    sessionId: types.stream.SessionId;
    offer: {
        type: "offer";
        sdp: string;
    };
}

export interface StreamGetTurnCredentialsResult {
    credentials: TurnCredentials[];
}

export interface TurnCredentials {
    url: string;
    username: string;
    password: string;
    expirationTime: number;
}

export type StreamRoomListAllResult = StreamRoomListResult;

export type StreamRoomCreatedEvent = types.cloud.Event<"streamRoomCreated", "stream", StreamRoomCreatedEventData>;
export type StreamRoomCreatedEventData = StreamRoom;

export type StreamRoomUpdatedEvent = types.cloud.Event<"streamRoomUpdated", "stream", StreamRoomUpdatedEventData>;
export type StreamRoomUpdatedEventData = StreamRoom;

export type StreamRoomDeletedEvent = types.cloud.Event<"streamRoomDeleted", "stream", StreamRoomDeletedEventData>;
export interface StreamRoomDeletedEventData {
    streamRoomId: types.stream.StreamRoomId;
    type?: types.stream.StreamRoomType;
}

export type JanusGenericEvent = types.cloud.Event<"janus", "stream", unknown>;
export type JanusCloseEvent = types.cloud.Event<"janusclose", "stream", true>;

export type StreamRoomCustomEvent = types.cloud.Event<"custom", `stream/${types.stream.StreamRoomId}/${types.core.WsChannelName}`, StreamRoomCustomEventData>;

export type StreamPublishedEvent = types.cloud.Event<"streamPublished", "stream", StreamPublishedEventData>;
export type StreamUpdatedEvent = types.cloud.Event<"streamUpdated", "stream", StreamUpdatedEventData>;
export type StreamJoinedEvent = types.cloud.Event<"streamJoined", "stream", StreamJoinedEventData>;
export type StreamUnpublishedEvent = types.cloud.Event<"streamUnpublished", "stream", StreamUnpublishedEventData>;
export type StreamLeftEvent = types.cloud.Event<"streamLeft", "stream", StreamLeftEventData>;

export interface StreamPublishedEventData {
    streamRoomId: types.stream.StreamRoomId;
    stream: PublisherAsStream;
    userId: types.cloud.UserId;
}
export interface StreamUpdatedEventData {
    streamRoomId: types.stream.StreamRoomId;
    streamsAdded: PublisherAsStream[];
    streamsRemoved: PublisherAsStream[];
    streamsModified: StreamTrackModification[];
}
export interface StreamJoinedEventData {
    streamRoomId: types.stream.StreamRoomId;
    stream: PublisherAsStream;
    userId: types.cloud.UserId;
}
export interface StreamUnpublishedEventData {
    streamRoomId: types.stream.StreamRoomId;
    streamId: number;
    userId: types.cloud.UserId;
}
export interface StreamLeftEventData {
    streamRoomId: types.stream.StreamRoomId;
    streamId: number;
    userId: types.cloud.UserId;
}

export interface StreamRoomCustomEventData {
    id: types.stream.StreamRoomId;
    keyId: types.core.KeyId;
    eventData: unknown;
    author: types.cloud.UserIdentity;
}

export interface StreamRoomSendCustomEventModel {
    streamRoomId: types.stream.StreamRoomId;
    channel: types.core.WsChannelName;
    keyId: types.core.KeyId;
    data: unknown;
    users?: types.cloud.UserId[];
}

export interface StreamLeaveModel {
    streamRoomId: types.stream.StreamRoomId;
    streamIds: number[];
}

export interface StreamUnpublishModel {
    sessionId: types.stream.SessionId;
}

export interface StreamRoomJoinModel {
    streamRoomId: types.stream.StreamRoomId;
}

export interface StreamRoomLeaveModel {
    streamRoomId: types.stream.StreamRoomId;
}

export interface StreamRoomRecordingModel {
    streamRoomId: types.stream.StreamRoomId;
}

export interface StreamRoomCloseModel {
    streamRoomId: types.stream.StreamRoomId;
}

export interface IStreamApi {
    streamRoomCreate(model: StreamRoomCreateModel): Promise<StreamRoomCreateResult>;
    streamRoomUpdate(model: StreamRoomUpdateModel): Promise<types.core.OK>;
    streamRoomDelete(model: StreamRoomDeleteModel): Promise<types.core.OK>;
    streamRoomDeleteMany(model: StreamRoomDeleteManyModel): Promise<SteramRoomDeleteManyResult>;
    streamRoomGet(model: StreamRoomGetModel): Promise<StreamRoomGetResult>;
    streamRoomList(model: StreamRoomListModel): Promise<StreamRoomListResult>;
    streamRoomListAll(model: StreamRoomListAllModel): Promise<StreamRoomListAllResult>;
    streamList(model: StreamListModel): Promise<StreamListResult>;
    streamPublish(model: StreamPublishModel): Promise<StreamPublishResult>;
    streamsSubscribeToRemote(model: StreamsSubscribeModel): Promise<StreamSubscribeResult>;
    streamsModifyRemoteSubscriptions(model: StreamModifySubscriptionModel): Promise<StreamSubscribeResult>;
    streamsUnsubscribeFromRemote(model: StreamsUnsubscribeModel): Promise<StreamSubscribeResult>
    streamAcceptOffer(model: StreamAcceptOfferModel): Promise<types.core.OK>;
    streamSetNewOffer(model: StreamSetNewOfferModel): Promise<types.core.OK>;
    streamTrickle(model: StreamTrickleModel): Promise<types.core.OK>;
    streamGetTurnCredentials(): Promise<StreamGetTurnCredentialsResult>;
    streamRoomSendCustomEvent(model: StreamRoomSendCustomEventModel): Promise<types.core.OK>;
    streamUnpublish(model: StreamUnpublishModel): Promise<types.core.OK>
    streamRoomJoin(model: StreamRoomJoinModel): Promise<types.core.OK>
    streamRoomLeave(model: StreamRoomLeaveModel): Promise<types.core.OK>
    streamRoomClose(model: StreamRoomCloseModel): Promise<types.core.OK>
}
