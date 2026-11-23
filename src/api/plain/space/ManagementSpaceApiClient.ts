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
import * as spaceApi from "./ManagementSpaceApiTypes";

export class ManagementSpaceApiClient implements spaceApi.ISpaceApi {
    
    constructor(
        private requester: Requester,
    ) {}
    
    async getSpace(model: spaceApi.GetSpaceModel): Promise<spaceApi.GetSpaceResult> {
        return await this.requester.request("space/getSpace", model);
    }
    
    async listSpaces(model: spaceApi.ListSpacesModel): Promise<spaceApi.ListSpacesResult> {
        return await this.requester.request("space/listSpaces", model);
    }
    
    async deleteSpace(model: spaceApi.DeleteSpaceModel): Promise<types.core.OK> {
        return await this.requester.request("space/deleteSpace", model);
    }
}
