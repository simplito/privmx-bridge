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
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { BaseApi } from "../../BaseApi";
import { StreamApiValidator } from "./StreamApiValidator";
import { StreamService } from "../../../service/cloud/StreamService";
import { StreamConverter } from "./StreamConverter";
import { RequestLogger } from "../../../service/log/RequestLogger";
import { WebSocketExtendedWithJanus } from "../../../CommonTypes";
import { AppException } from "../../AppException";
import { TurnCredentialsService } from "../../../service/webrtc/v2/TurnCredentialsService";

export class StreamApi extends BaseApi implements streamApi.IStreamApi {
    
    constructor(
        storeApiValidator: StreamApiValidator,
        private sessionService: SessionService,
        private streamService: StreamService,
        private streamConverter: StreamConverter,
        private requestLogger: RequestLogger,
        private websocket: WebSocketExtendedWithJanus|null,
        private turnCredentialsService: TurnCredentialsService,
    ) {
        super(storeApiValidator);
    }
    
    @ApiMethod({})
    async streamRoomCreate(model: streamApi.StreamRoomCreateModel): Promise<streamApi.StreamRoomCreateResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const streamRoom = await this.streamService.createStreamRoom(cloudUser, model.contextId, model.resourceId || null, model.type, model.users, model.managers, model.data, model.keyId, model.keys, model.policy || {});
        this.requestLogger.setContextId(streamRoom.contextId);
        return {streamRoomId: streamRoom.id};
    }
    
    @ApiMethod({})
    async streamRoomUpdate(model: streamApi.StreamRoomUpdateModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const streamRoom = await this.streamService.updateStreamRoom(cloudUser, model.id, model.users, model.managers, model.data, model.keyId, model.keys, model.version, model.force, model.policy, model.resourceId || null);
        this.requestLogger.setContextId(streamRoom.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamRoomDelete(model: streamApi.StreamRoomDeleteModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const streamRoom = await this.streamService.deleteStreamRoom(cloudUser, model.id);
        this.requestLogger.setContextId(streamRoom.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamRoomDeleteMany(model: streamApi.StreamRoomDeleteManyModel): Promise<streamApi.SteramRoomDeleteManyResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {contextId, results} = await this.streamService.deleteManyStreamRooms(cloudUser, model.ids);
        if (contextId) {
            this.requestLogger.setContextId(contextId);
        }
        return {results};
    }
    
    @ApiMethod({})
    async streamRoomGet(model: streamApi.StreamRoomGetModel): Promise<streamApi.StreamRoomGetResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const streamRoom = await this.streamService.getStreamRoom(cloudUser, model.id, model.type);
        this.requestLogger.setContextId(streamRoom.contextId);
        return {streamRoom: this.streamConverter.convertStreamRoom(cloudUser.getUser(streamRoom.contextId), streamRoom)};
    }
    
    @ApiMethod({})
    async streamRoomList(model: streamApi.StreamRoomListModel): Promise<streamApi.StreamRoomListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, streamRooms} = await this.streamService.getMyStreamRooms(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate", model.scope || "MEMBER");
        this.requestLogger.setContextId(model.contextId);
        return {list: streamRooms.list.map(x => this.streamConverter.convertStreamRoom(user.userId, x)), count: streamRooms.count};
    }
    
    @ApiMethod({})
    async streamRoomListAll(model: streamApi.StreamRoomListAllModel): Promise<streamApi.StreamRoomListAllResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const {user, streamRooms} = await this.streamService.getAllStreamRooms(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
        this.requestLogger.setContextId(model.contextId);
        return {list: streamRooms.list.map(x => this.streamConverter.convertStreamRoom(user.userId, x)), count: streamRooms.count};
    }
    
    @ApiMethod({})
    async streamList(model: streamApi.StreamListModel): Promise<streamApi.StreamListResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const streams = await this.streamService.listStreams(cloudUser, model.streamRoomId);
        return {list: streams};
    }
    
    @ApiMethod({})
    async streamPublish(model: streamApi.StreamPublishModel): Promise<streamApi.StreamPublishResult> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        const res = await this.streamService.publishStream(cloudUser, model.streamRoomId, model.offer, this.websocket, wsId);
        return res;
    }
    
    @ApiMethod({})
    async streamUpdate(model: streamApi.StreamUpdateModel): Promise<streamApi.StreamUpdateResult> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        const res = await this.streamService.updateStream(cloudUser, model.streamRoomId, model.offer, this.websocket, wsId);
        return res;
    }
    
    @ApiMethod({})
    async streamsSubscribeToRemote(model: streamApi.StreamsSubscribeModel): Promise<streamApi.StreamSubscribeResult> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        const res = await this.streamService.subscribeToRemoteStreams(cloudUser, model.streamRoomId, model.subscriptionsToAdd, this.websocket, wsId);
        return res;
    }
    
    @ApiMethod({})
    async streamsModifyRemoteSubscriptions(model: streamApi.StreamModifySubscriptionModel): Promise<streamApi.StreamSubscribeResult> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        const res = await this.streamService.modifyRemoteSubscriptions(cloudUser, model.streamRoomId, model.subscriptionsToAdd, model.subscriptionsToRemove, this.websocket, wsId);
        return res;
    }
    
    @ApiMethod({})
    async streamsUnsubscribeFromRemote(model: streamApi.StreamsUnsubscribeModel): Promise<streamApi.StreamSubscribeResult> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        const res = await this.streamService.unsubscribeFromRemoteStreams(cloudUser, model.streamRoomId, model.subscriptionsToRemove, this.websocket, wsId);
        return res;
    }
    
    @ApiMethod({})
    async streamTrickle(model: streamApi.StreamTrickleModel): Promise<types.core.OK> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        await this.streamService.trickle(cloudUser, model.rtcCandidate, model.sessionId, this.websocket, wsId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamAcceptOffer(model: streamApi.StreamAcceptOfferModel): Promise<types.core.OK> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        await this.streamService.acceptStreamOffer(cloudUser, model.answer, model.sessionId, this.websocket, wsId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamSetNewOffer(model: streamApi.StreamSetNewOfferModel): Promise<types.core.OK> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        await this.streamService.setStreamOffer(cloudUser, model.offer, model.sessionId, this.websocket, wsId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamGetTurnCredentials(): Promise<streamApi.StreamGetTurnCredentialsResult> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        return {credentials: this.turnCredentialsService.getTurnCredentials(cloudUser.pub)};
    }
    
    @ApiMethod({})
    async streamUnpublish(model: streamApi.StreamUnpublishModel): Promise<types.core.OK> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        await this.streamService.unpublishStream(cloudUser, model.sessionId, this.websocket, wsId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamRoomSendCustomEvent(model: streamApi.StreamRoomSendCustomEventModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const store = await this.streamService.sendCustomNotification(cloudUser, model.streamRoomId, model.keyId, model.data, model.channel, model.users);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamRoomJoin(model: streamApi.StreamRoomJoinModel): Promise<types.core.OK> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        await this.streamService.joinStreamRoom(cloudUser, model.streamRoomId, this.websocket, wsId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamRoomLeave(model: streamApi.StreamRoomJoinModel): Promise<types.core.OK> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        await this.streamService.leaveStreamRoom(cloudUser, model.streamRoomId, this.websocket, wsId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamRoomEnableRecording(model: streamApi.StreamRoomRecordingModel): Promise<types.core.OK> {
        if (!this.websocket) {
            throw new AppException("METHOD_CALLABLE_WITH_WEBSOCKET_ONLY");
        }
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const wsId = this.sessionService.getSessionUser().getWsId();
        await this.streamService.enableStreamRoomRecording(cloudUser, model.streamRoomId, this.websocket, wsId);
        return "OK";
    }
    
    @ApiMethod({})
    async streamRoomClose(model: streamApi.StreamRoomCloseModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const streamRoom = await this.streamService.closeStreamRoom(cloudUser, model.streamRoomId);
        this.requestLogger.setContextId(streamRoom.contextId);
        return "OK";
    }
}
