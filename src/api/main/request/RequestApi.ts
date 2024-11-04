/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { RequestApiValidator } from "./RequestApiValidator";
import { ApiMethod } from "../../Decorators";
import * as types from "../../../types";
import * as requestApi from "./RequestApiTypes";
import { Permission } from "../../Permission";
import { SessionService } from "../../session/SessionService";
import { RequestService } from "../../../service/request/RequestService";
import { BaseApi } from "../../BaseApi";

export class RequestApi extends BaseApi implements requestApi.IRequestApi {
    
    constructor(
        requestApiValidator: RequestApiValidator,
        private sessionService: SessionService,
        private requestService: RequestService,
    ) {
        super(requestApiValidator);
    }
    
    private getSession() {
        return this.sessionService.getSessionUser();
    }
    
    private getSessionUsername() {
        return this.getSession().get("username");
    }
    
    @ApiMethod({})
    async getRequestConfig(): Promise<types.request.RequestConfig> {
        return this.requestService.getConfig();
    }
    
    @ApiMethod({})
    async createRequest(model: requestApi.CreateRequestModel): Promise<requestApi.CreateRequestResult> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        const req = await this.requestService.createRequest(this.getSessionUsername(), model);
        return {id: req.id};
    }
    
    @ApiMethod({})
    async destroyRequest(model: requestApi.DestroyRequestModel): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.USER_SESSION);
        await this.requestService.destroyRequest(this.getSessionUsername(), model.id);
        return "OK";
    }
    
    @ApiMethod({})
    async sendChunk(model: requestApi.ChunkModel): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        await this.requestService.sendChunk(this.getSessionUsername(), model);
        return "OK";
    }
    
    @ApiMethod({})
    async commitFile(model: requestApi.CommitFileModel): Promise<types.core.OK> {
        this.sessionService.assertMethod(Permission.HAS_ANY_SESSION);
        await this.requestService.commitFile(this.getSessionUsername(), model);
        return "OK";
    }
}
