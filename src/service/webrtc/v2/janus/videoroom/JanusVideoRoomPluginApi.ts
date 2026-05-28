/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { randomUUID } from "crypto";
import { AppException } from "../../../../../api/AppException";
import { JanusError } from "../JanusError";
import { JanusRequester } from "../JanusRequester";
import * as videoroom from "./Types";
import { Logger } from "../../../../log/Logger";

export class JanusVideoRoomPluginApi {
    
    constructor(
        private janusRequester: JanusRequester,
        private logger: Logger,
    ) {}
    
    async create(model: videoroom.CreateRequest) {
        return this.sync<videoroom.CreateResponse>(model);
    }
    async edit(model: videoroom.EditRequest) {
        return this.sync<videoroom.EditResponse>(model);
    }
    async destroy(model: videoroom.DestroyRequest) {
        return this.sync<videoroom.DestroyResponse>(model);
    }
    async exists(model: videoroom.ExistsRequest) {
        return this.sync<videoroom.ExistsResponse>(model);
    }
    async allowed(model: videoroom.AllowedRequest) {
        return this.sync<videoroom.AllowedResponse>(model);
    }
    async kick(model: videoroom.KickRequest) {
        return this.sync<videoroom.KickResponse>(model);
    }
    async moderate(model: videoroom.ModerateRequest) {
        return this.sync<videoroom.ModerateResponse>(model);
    }
    async list(model: videoroom.ListRequest) {
        return this.sync<videoroom.ListResponse>(model);
    }
    async listParticipants(model: videoroom.ListParticipantsRequest) {
        return this.sync<videoroom.ListParticipantsResponse>(model);
    }
    
    async enableRcording(model: videoroom.EnableRecordingRequest) {
        return this.async<videoroom.EnableRecordingResponse>(model);
    }
    async joinAsPublisher(model: videoroom.JoinAsPublisherRequest) {
        return this.async<videoroom.JoinAsPublisherResponse>(model);
    }
    async joinAsSubscriber(model: videoroom.JoinAsSubscriberRequest) {
        return this.async<videoroom.JoinAsSubscriberResponse>(model);
    }
    async subscribeOnExisting(model: videoroom.SubscribeOnExistingRequest) {
        return this.async<videoroom.SubscribeOnExistingResponse>(model);
    }
    async updateSubscriptions(model: videoroom.UpdateSubscriptionsRequest) {
        return this.async<videoroom.UpdateSubscriptionsResponse>(model);
    }
    async unsubscribeOnExisting(model: videoroom.UnsubscribeOnExistingRequest) {
        return this.async<videoroom.UnubscribeOnExistingResponse>(model);
    }
    async leave(model: videoroom.LeaveRequest) {
        return this.async<videoroom.LeaveResponse>(model);
    }
    async publish(model: videoroom.PublishRequest) {
        return this.async<videoroom.PublishResponse>(model);
    }
    async configure(model: videoroom.ConfigureRequest) {
        return this.async<videoroom.ConfigureResponse>(model);
    }
    async unpublish(model: videoroom.UnpublishRequest) {
        return this.async<videoroom.UnpublishResponse>(model);
    }
    async start(model: videoroom.StartRequest) {
        return this.async<videoroom.StartResponse>(model);
    }
    async reconfigure(model: videoroom.ConfigureRequest) {
        return this.async<videoroom.ConfigureResponse>(model);
    }
    
    async trickle(model: videoroom.TrickleRequest): Promise<void> {
        try {
            return await this.janusRequester.createJanusCall("trickle", model.body, model.session_id, model.handle_id);
        }
        catch (e) {
            throw this.mapToAppException(e);
        }
    }
    
    private async sync<T>(data: object): Promise<T> {
        try {
            return await this.janusRequester.requestSync<T>(data);
        }
        catch (e) {
            throw this.mapToAppException(e);
        }
    }
    
    private async async<T>(data: object): Promise<T> {
        try {
            return await this.janusRequester.requestAsync<T>(data);
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
            this.logger.error(e, `[JanusErrorID: ${referenceId}] Code: ${e.errorCode}, Message: ${e.message}`);
            
            switch (e.errorCode) {
                case 424: return new AppException("MEDIA_USER_NOT_JOINED", { referenceId });
                case 425: return new AppException("MEDIA_USER_ALREADY_JOINED", { referenceId });
                case 426: return new AppException("MEDIA_ROOM_NOT_FOUND", { referenceId });
                case 427: return new AppException("MEDIA_ROOM_ALREADY_EXISTS", { referenceId });
                case 428: return new AppException("MEDIA_FEED_NOT_FOUND", { referenceId });
                case 431: return new AppException("MEDIA_INVALID_SDP_TYPE", { referenceId });
                case 432: return new AppException("MEDIA_ROOM_FULL", { referenceId });
                case 433: return new AppException("MEDIA_UNAUTHORIZED", { referenceId });
                case 434: return new AppException("MEDIA_ALREADY_PUBLISHING", { referenceId });
                case 435: return new AppException("MEDIA_NOT_PUBLISHING", { referenceId });
                case 436: return new AppException("MEDIA_PARTICIPANT_ID_EXISTS", { referenceId });
                case 437: return new AppException("MEDIA_INVALID_SDP", { referenceId });
                default:
                    return new AppException("MEDIA_SERVER_ERROR", { referenceId });
            }
        }
        this.logger.error(e, `[UnknownErrorID: ${referenceId}] Exception in Janus plugin:`);
        return new AppException("UNKNOWN_MEDIA_SERVER_EXCEPTION", { referenceId });
    }
}