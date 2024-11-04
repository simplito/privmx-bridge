/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementBaseApi } from "../../../api/ManagementBaseApi";
import * as managementStreamApi from "./ManagementStreamApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { ManagementStreamApiValidator } from "./ManagementStreamApiValidator";
import { StreamService } from "../../../service/cloud/StreamService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import * as types from "../../../types";
import { ManagementStreamConverter } from "./ManagementStreamConverter";

export class ManagementStreamApi extends ManagementBaseApi implements managementStreamApi.IStreamApi {
    
    constructor(
        managementStreamApiValidator: ManagementStreamApiValidator,
        authorizationDetector: AuthorizationDetector,
        authorizationHolder: AuthorizationHolder,
        private streamService: StreamService,
        private managementStreamConverter: ManagementStreamConverter,
    ) {
        super(managementStreamApiValidator, authorizationDetector, authorizationHolder);
    }
    
    @ApiMethod({errorCodes: ["STREAM_ROOM_DOES_NOT_EXIST"] })
    async getStreamRoom(model: managementStreamApi.GetStreamRoomModel): Promise<managementStreamApi.GetStreamRoomResult> {
        this.validateScope("stream");
        const streamRoom = await this.streamService.getStreamRoom(this.getPlainUser(), model.streamRoomId, undefined);
        return {streamRoom: this.managementStreamConverter.convertStreamRoom(streamRoom)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listStreamRooms(model: managementStreamApi.ListStreamRoomsModel): Promise<managementStreamApi.ListStreamRoomsResult> {
        this.validateScope("stream");
        const {streamRooms} = await this.streamService.getStreamRoomsByContext(this.getPlainUser(), model.contextId, model);
        return {count: streamRooms.count, list: streamRooms.list.map(x => this.managementStreamConverter.convertStreamRoom(x))};
    }
    
    @ApiMethod({errorCodes: ["STREAM_ROOM_DOES_NOT_EXIST"] })
    async deleteStreamRoom(model: managementStreamApi.DeleteStreamRoomModel): Promise<types.core.OK> {
        this.validateScope("stream");
        await this.streamService.deleteStreamRoom(this.getPlainUser(), model.streamRoomId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["RESOURCES_HAVE_DIFFERENT_CONTEXTS"] })
    async deleteManyStreamRooms(model: managementStreamApi.DeleteManyStreamRoomsModel): Promise<managementStreamApi.DeleteManyStreamRoomsResult> {
        this.validateScope("stream");
        const {results} = await this.streamService.deleteManyStreamRooms(this.getPlainUser(), model.streamRoomIds);
        return {results};
    }
}