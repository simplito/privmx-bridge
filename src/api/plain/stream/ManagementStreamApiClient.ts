/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Requester } from "../../../CommonTypes";
import * as types from "../../../types";
import * as streamApi from "./ManagementStreamApiTypes";

export class ManagementStreamApiClient implements streamApi.IStreamApi {
    
    constructor(
        private requester: Requester,
    ) {}

    async getStreamRoom(model: streamApi.GetStreamRoomModel): Promise<streamApi.GetStreamRoomResult> {
        return await this.requester.request("stream/getStreamRoom", model);
    }

    async listStreamRooms(model: streamApi.ListStreamRoomsModel): Promise<streamApi.ListStreamRoomsResult> {
        return await this.requester.request("stream/listStreamRooms", model);
    }

    async deleteStreamRoom(model: streamApi.DeleteStreamRoomModel): Promise<types.core.OK> {
        return await this.requester.request("stream/deleteStreamRoom", model);
    }

    async deleteManyStreamRooms(model: streamApi.DeleteManyStreamRoomsModel): Promise<streamApi.DeleteManyStreamRoomsResult> {
        return await this.requester.request("stream/deleteManyStreamRooms", model);
    }
}