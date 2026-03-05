/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as streamApi from "./StreamApiTypes";
import { BaseApiClient } from "../../BaseApiClient";

export class StreamApiClient extends BaseApiClient implements streamApi.IStreamApi {
    
    streamRoomClose(model: streamApi.StreamRoomCloseModel): Promise<types.core.OK> {
        return this.request("stream.streamRoomClose", model);
    }
    
    streamRoomDeleteMany(model: streamApi.StreamRoomDeleteManyModel): Promise<streamApi.SteramRoomDeleteManyResult> {
        return this.request("stream.streamRoomDeleteMany", model);
    }
    
    streamRoomCreate(model: streamApi.StreamRoomCreateModel): Promise<streamApi.StreamRoomCreateResult> {
        return this.request("stream.streamRoomCreate", model);
    }
    
    streamRoomUpdate(model: streamApi.StreamRoomUpdateModel): Promise<types.core.OK> {
        return this.request("stream.streamRoomUpdate", model);
    }
    
    streamRoomDelete(model: streamApi.StreamRoomDeleteModel): Promise<types.core.OK> {
        return this.request("stream.streamRoomDelete", model);
    }
    
    streamRoomGet(model: streamApi.StreamRoomGetModel): Promise<streamApi.StreamRoomGetResult> {
        return this.request("stream.streamRoomGet", model);
    }
    
    streamRoomList(model: streamApi.StreamRoomListModel): Promise<streamApi.StreamRoomListResult> {
        return this.request("stream.streamRoomList", model);
    }
    
    streamRoomListAll(model: streamApi.StreamRoomListAllModel): Promise<streamApi.StreamRoomListAllResult> {
        return this.request("stream.streamRoomListAll", model);
    }
    
    streamList(model: streamApi.StreamListModel): Promise<streamApi.StreamListResult> {
        return this.request("stream.streamList", model);
    }
    
    streamPublish(model: streamApi.StreamPublishModel): Promise<streamApi.StreamPublishResult> {
        return this.requestWS("stream.streamPublish", model);
    }
    
    streamAcceptOffer(model: streamApi.StreamAcceptOfferModel): Promise<types.core.OK> {
        return this.requestWS("stream.streamAcceptOffer", model);
    }
    
    streamSetNewOffer(model: streamApi.StreamSetNewOfferModel): Promise<types.core.OK> {
        return this.requestWS("stream.streamSetNewOffer", model);
    }
    
    streamTrickle(model: streamApi.StreamTrickleModel): Promise<types.core.OK> {
        return this.requestWS("stream.streamTrickle", model);
    }
    
    streamGetTurnCredentials(): Promise<streamApi.StreamGetTurnCredentialsResult> {
        return this.request("stream.streamGetTurnCredentials", {});
    }
    
    streamRoomSendCustomEvent(model: streamApi.StreamRoomSendCustomEventModel): Promise<types.core.OK> {
        return this.request("stream.streamRoomSendCustomEvent", model);
    }
    
    streamsSubscribeToRemote(model: streamApi.StreamsSubscribeModel): Promise<streamApi.StreamSubscribeResult> {
        return this.requestWS("stream.streamsSubscribeToRemote", model);
    }
    
    streamsUnsubscribeFromRemote(model: streamApi.StreamsUnsubscribeModel): Promise<streamApi.StreamSubscribeResult> {
        return this.requestWS("stream.streamsUnsubscribeFromRemote", model);
    }
    
    streamsModifyRemoteSubscriptions(model: streamApi.StreamModifySubscriptionModel): Promise<streamApi.StreamSubscribeResult> {
        return this.requestWS("stream.streamsModifyRemoteSubscriptions", model);
    }
    
    streamUnpublish(model: streamApi.StreamUnpublishModel): Promise<types.core.OK> {
        return this.requestWS("stream.streamUnpublish", model);
    }
    
    streamRoomJoin(model: streamApi.StreamRoomJoinModel): Promise<types.core.OK> {
        return this.requestWS("stream.streamRoomJoin", model);
    }
    
    streamRoomLeave(model: streamApi.StreamRoomLeaveModel): Promise<types.core.OK> {
        return this.requestWS("stream.streamRoomLeave", model);
    }
    
    streamRoomEnableRecording(model: streamApi.StreamRoomRecordingModel): Promise<types.core.OK> {
        return this.requestWS("stream.streamRoomEnableRecording", model);
    }
}
