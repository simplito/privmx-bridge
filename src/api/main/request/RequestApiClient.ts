/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as requestApi from "./RequestApiTypes";
import { BaseApiClient } from "../../BaseApiClient";

export class RequestApiClient extends BaseApiClient implements requestApi.IRequestApi {
    
    getRequestConfig(): Promise<types.request.RequestConfig> {
        return this.request("getRequestConfig", {});
    }
    
    createRequest(model: requestApi.CreateRequestModel): Promise<requestApi.CreateRequestResult> {
        return this.request("createRequest", model);
    }
    
    destroyRequest(model: requestApi.DestroyRequestModel): Promise<types.core.OK> {
        return this.request("destroyRequest", model);
    }
    
    sendChunk(model: requestApi.ChunkModel): Promise<types.core.OK> {
        return this.request("sendChunk", model);
    }
    
    commitFile(model: requestApi.CommitFileModel): Promise<types.core.OK> {
        return this.request("commitFile", model);
    }
}
