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
}
