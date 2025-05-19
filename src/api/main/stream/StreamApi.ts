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

export class StreamApi extends BaseApi implements streamApi.IStreamApi {
    
    constructor(
        storeApiValidator: StreamApiValidator,
        private sessionService: SessionService,
        private streamService: StreamService,
        private streamConverter: StreamConverter,
        private requestLogger: RequestLogger,
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
        const {user, streamRooms} = await this.streamService.getMyStreamRooms(cloudUser, model.contextId, model.type, model, model.sortBy || "createDate");
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
    async streamRoomSendCustomEvent(model: streamApi.StreamRoomSendCustomEventModel): Promise<types.core.OK> {
        const cloudUser = this.sessionService.validateContextSessionAndGetCloudUser();
        const store = await this.streamService.sendCustomNotification(cloudUser, model.streamRoomId, model.keyId, model.data, model.channel, model.users);
        this.requestLogger.setContextId(store.contextId);
        return "OK";
    }
}
