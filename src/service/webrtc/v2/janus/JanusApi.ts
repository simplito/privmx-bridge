/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { randomUUID } from "crypto";
import { JanusError } from "./JanusError";
import { JanusRequester } from "./JanusRequester";
import * as janus from "./JanusTypes";
import { Logger } from "../../../log/Logger";
import { AppException } from "../../../../api/AppException";

export class JanusApi {
    
    constructor(
        private janusRequester: JanusRequester,
        private logger: Logger,
    ) {
    }
    
    async create(model: janus.CreateRequest): Promise<janus.CreateResponse> {
        return this.sync(model);
    }
    
    async destroy(model: janus.DestroyRequest): Promise<janus.DestroyResponse> {
        return this.sync(model);
    }
    
    async keepAlive(model: janus.KeepAliveRequest): Promise<janus.KeepAliveResponse> {
        return this.sync(model);
    }
    
    async attach(model: janus.AttachRequest): Promise<janus.AttachResponse> {
        return this.sync(model);
    }
    
    async detach(model: janus.DetachRequest): Promise<janus.DetachResponse> {
        return this.sync(model);
    }
    
    private async sync<T>(model: object): Promise<T> {
        try {
            return await this.janusRequester.requestSync<T>(model);
        }
        catch (e) {
            throw this.mapToAppException(e);
        }
    }
    
    private mapToAppException(e: unknown): Error {
        if (e instanceof AppException) {
            return e;
        }
        
        const referenceId = randomUUID();
        
        if (e instanceof JanusError) {
            this.logger.error(e, `[JanusCoreErrorID: ${referenceId}] Code: ${e.errorCode}, Message: ${e.message}`);
            
            switch (e.errorCode) {
                case 458: // JANUS_ERROR_SESSION_NOT_FOUND
                case 459: // JANUS_ERROR_HANDLE_NOT_FOUND
                    return new AppException("UNKNOWN_SESSION", { referenceId });
                default:
                    return new AppException("MEDIA_SERVER_ERROR", { referenceId });
            }
        }
        
        this.logger.error(e, `[UnknownErrorID: ${referenceId}] Exception in Janus core API:`);
        return new AppException("UNKNOWN_MEDIA_SERVER_EXCEPTION", { referenceId });
    }
}