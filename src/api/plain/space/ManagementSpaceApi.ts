/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementBaseApi } from "../../../api/ManagementBaseApi";
import * as managementSpaceApi from "./ManagementSpaceApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { ManagementSpaceApiValidator } from "./ManagementSpaceApiValidator";
import { SpaceService, SpaceView } from "../../../service/cloud/SpaceService";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import * as types from "../../../types";

/** What an application's backend reads of spaces. It changes neither recipients nor keys, and can only delete. */
export class ManagementSpaceApi extends ManagementBaseApi implements managementSpaceApi.ISpaceApi {
    
    constructor(
        managementSpaceApiValidator: ManagementSpaceApiValidator,
        authorizationDetector: AuthorizationDetector,
        authorizationHolder: AuthorizationHolder,
        private spaceService: SpaceService,
    ) {
        super(managementSpaceApiValidator, authorizationDetector, authorizationHolder);
    }
    
    static convertSpace(view: SpaceView): managementSpaceApi.Space {
        const space = view.space;
        return {
            id: space.id,
            contextId: space.contextId,
            creator: space.creator,
            createDate: space.createDate,
            lastModificationDate: space.lastModificationDate,
            groups: space.groups,
            users: space.users,
            keyVersion: space.keyVersion,
            keyIsStale: view.keyIsStale,
            publicMeta: space.publicMeta,
        };
    }
    
    @ApiMethod({errorCodes: ["SPACE_DOES_NOT_EXIST"] })
    async getSpace(model: managementSpaceApi.GetSpaceModel): Promise<managementSpaceApi.GetSpaceResult> {
        this.validateScope("space");
        return {space: ManagementSpaceApi.convertSpace(await this.spaceService.getSpace(this.getPlainUser(), model.spaceId))};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"] })
    async listSpaces(model: managementSpaceApi.ListSpacesModel): Promise<managementSpaceApi.ListSpacesResult> {
        this.validateScope("space");
        const page = await this.spaceService.listSpaces(this.getPlainUser(), model.contextId, model, "createDate");
        return {count: page.count, list: page.list.map(x => ManagementSpaceApi.convertSpace(x))};
    }
    
    @ApiMethod({errorCodes: ["SPACE_DOES_NOT_EXIST"] })
    async deleteSpace(model: managementSpaceApi.DeleteSpaceModel): Promise<types.core.OK> {
        this.validateScope("space");
        await this.spaceService.deleteSpace(this.getPlainUser(), model.spaceId);
        return "OK";
    }
}
