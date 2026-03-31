/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import { CloudUser, Executor, JanusSessionType } from "../../CommonTypes";
import * as types from "../../types";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { CloudKeyService } from "./CloudKeyService";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { StreamNotificationService } from "./StreamNotificationService";
import { AclFunctionNameX, CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { BasePolicy } from "./BasePolicy";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbDuplicateError } from "../../error/DbDuplicateError";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { BaseContainerService } from "./BaseContainerService";
import * as WebRtcTypes from "../webrtc/v2/WebRtcTypes";
import { WebSocketExtendedWithJanus } from "../../CommonTypes";
import { Config } from "../../cluster/common/ConfigUtils";
import { JanusContextFactory } from "./JanusContextFactory";
import { StreamSubscription } from "../../api/main/stream/StreamApiTypes";
import { Publisher, StreamId } from "../webrtc/v2/WebRtcTypes";
import { SubscribeOnExistingRequest, UnsubscribeOnExistingRequest, UpdateSubscriptionsRequest } from "../webrtc/v2/janus/videoroom/Types";
import { JanusRoomsWatcher } from "./JanusRoomsWatcher";
import { JanusContext } from "./JanusContext";

const JanusConstants = {
    PLUGIN: "janus.plugin.videoroom",
    PTYPE: {
        PUBLISHER: "publisher",
        SUBSCRIBER: "subscriber",
    },
    SESSION_TYPE: {
        MAIN: "main" as JanusSessionType,
        SUBSCRIBER: "subscriber" as JanusSessionType,
    },
    REQUEST: {
        CREATE: "create",
        JOIN: "join",
        PUBLISH: "publish",
        SUBSCRIBE: "subscribe",
        UNSUBSCRIBE: "unsubscribe",
        UPDATE: "update",
        START: "start",
        LEAVE: "leave",
        UNPUBLISH: "unpublish",
        CONFIGURE: "configure",
        EDIT: "edit",
        ENABLE_RECORDING: "enable_recording",
        DESTROY: "destroy",
    },
} as const;

export class StreamService extends BaseContainerService {
    private policy: StreamRoomPolicy;
    
    constructor(
        repositoryFactory: RepositoryFactory,
        host: types.core.Host,
        activeUsersMap: ActiveUsersMap,
        private cloudKeyService: CloudKeyService,
        private streamNotificationService: StreamNotificationService,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
        private config: Config,
        private janusContextFactory: JanusContextFactory,
        private janusRoomsWatcher: JanusRoomsWatcher,
    ) {
        super(repositoryFactory, activeUsersMap, host);
        this.policy = new StreamRoomPolicy(this.policyService);
    }
    
    async createStreamRoom(cloudUser: CloudUser, contextId: types.context.ContextId, resourceId: types.core.ClientResourceId | null, type: types.stream.StreamRoomType | undefined, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.stream.StreamRoomData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerWithoutItemPolicy) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        
        const janusRoomId = await (async () => {
            if (this.config.streams.mediaServer.fake) {
                return 1234;
            }
            try {
                const createResult = await this.janusContextFactory.withJanus(async (janusVideoRoomPluginApi, sessionId, handleId) => {
                    return await janusVideoRoomPluginApi.create({
                        janus: "message",
                        session_id: sessionId,
                        plugin: JanusConstants.PLUGIN,
                        handle_id: handleId,
                        body: {
                            request: JanusConstants.REQUEST.CREATE,
                            permanent: false,
                            rec_dir: this.config.streams.mediaServer.recordingsPath,
                            publishers: this.config.streams.mediaServer.videoRoom.maxPublishers,
                            bitrate: this.config.streams.mediaServer.videoRoom.maxBitrate,
                            bitrate_cap: this.config.streams.mediaServer.videoRoom.bitrateCap,
                        },
                    });
                });
                return createResult.plugindata.data.room;
            }
            catch {
                throw new AppException("MEDIA_SERVER_ERROR", "Failed to allocate room");
            }
        })();
        
        try {
            const streamRoom = await this.repositoryFactory.createStreamRoomRepository().createStreamRoom(contextId, resourceId, type, user.userId, managers, users, data, keyId, newKeys, policy, janusRoomId);
            this.streamNotificationService.sendStreamRoomCreated(streamRoom, context.solution);
            return streamRoom;
        }
        catch (err) {
            if (err instanceof DbDuplicateError) {
                throw new AppException("DUPLICATE_RESOURCE_ID");
            }
            throw err;
        }
    }
    
    async updateStreamRoom(cloudUser: CloudUser, id: types.stream.StreamRoomId, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.stream.StreamRoomData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.stream.StreamRoomVersion, force: boolean, policy: types.cloud.ContainerWithoutItemPolicy | undefined, resourceId: types.core.ClientResourceId | null) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        
        const { streamRoom: rStreamRoom, context: usedContext, oldStreamRoom: old } = await this.repositoryFactory.withTransaction(async session => {
            const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository(session);
            const oldStreamRoom = await streamRoomRepository.get(id);
            if (!oldStreamRoom) {
                throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
            }
            
            const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldStreamRoom.contextId);
            
            this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomUpdate", ["streamRoomId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldStreamRoom, managers, policy);
            
            const currentVersion = <types.stream.StreamRoomVersion>oldStreamRoom.history.length;
            if (currentVersion !== version && !force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldStreamRoom.contextId, [...oldStreamRoom.history.map(x => x.keyId), keyId], oldStreamRoom.keys, keys, keyId, users, managers);
            if (oldStreamRoom.clientResourceId && resourceId && oldStreamRoom.clientResourceId !== resourceId) {
                throw new AppException("RESOURCE_ID_MISSMATCH");
            }
            try {
                const streamRoom = await streamRoomRepository.updateStreamRoom(oldStreamRoom, user.userId, managers, users, data, keyId, newKeys, policy, resourceId);
                return { streamRoom, context, oldStreamRoom };
            }
            catch (err) {
                if (err instanceof DbDuplicateError) {
                    throw new AppException("DUPLICATE_RESOURCE_ID");
                }
                throw err;
            }
        });
        
        const updatedStreamRoomUsers = old.managers.concat(old.users);
        const deletedUsers = old.managers.concat(old.users).filter(u => !updatedStreamRoomUsers.includes(u));
        const additionalUsersToNotify = await this.getUsersWithStatus(deletedUsers, usedContext.id, usedContext.solution);
        this.streamNotificationService.sendStreamRoomUpdated(rStreamRoom, usedContext.solution, additionalUsersToNotify);
        
        return rStreamRoom;
    }
    
    async deleteStreamRoom(executor: Executor, id: types.stream.StreamRoomId) {
        const result = await this.repositoryFactory.withTransaction(async session => {
            const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository(session);
            const streamRoom = await streamRoomRepository.get(id);
            if (!streamRoom) {
                throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
            }
            
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, streamRoom.contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomDelete", ["streamRoomId=" + id]);
                if (!this.policy.canDeleteContainer(user, context, streamRoom)) {
                    throw new AppException("ACCESS_DENIED");
                }
            });
            await streamRoomRepository.deleteStreamRoom(streamRoom.id);
            return { streamRoom, usedContext };
        });
        this.streamNotificationService.sendStreamRoomDeleted(result.streamRoom, result.usedContext.solution);
        return result.streamRoom;
    }
    
    async deleteManyStreamRooms(executor: Executor, streamRoomIds: types.stream.StreamRoomId[]) {
        const resultMap: Map<types.stream.StreamRoomId, "OK" | "STREAM_ROOM_DOES_NOT_EXIST" | "ACCESS_DENIED"> = new Map();
        for (const id of streamRoomIds) {
            resultMap.set(id, "STREAM_ROOM_DOES_NOT_EXIST");
        }
        
        const result = await this.repositoryFactory.withTransaction(async session => {
            const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository(session);
            const streamRooms = await streamRoomRepository.getMany(streamRoomIds);
            if (streamRooms.length === 0) {
                return { context: null, toNotify: [] };
            }
            
            const contextId = streamRooms[0].contextId;
            let additionalAccessCheck: ((streamRoom: db.stream.StreamRoom) => boolean) = () => true;
            
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomDeleteMany", []);
                additionalAccessCheck = streamRoom => this.policy.canDeleteContainer(user, context, streamRoom);
            });
            
            const toDelete: types.stream.StreamRoomId[] = [];
            const toNotify: db.stream.StreamRoom[] = [];
            for (const streamRoom of streamRooms) {
                if (streamRoom.contextId !== contextId) {
                    throw new AppException("RESOURCES_HAVE_DIFFERENT_CONTEXTS");
                }
                if (!additionalAccessCheck(streamRoom)) {
                    resultMap.set(streamRoom.id, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(streamRoom.id, "OK");
                    toDelete.push(streamRoom.id);
                    toNotify.push(streamRoom);
                }
            }
            await streamRoomRepository.deleteManyStreamRooms(toDelete);
            return { context: usedContext, toNotify };
        });
        
        if (result.context) {
            for (const deletedInbox of result.toNotify) {
                this.streamNotificationService.sendStreamRoomDeleted(deletedInbox, result.context.solution);
            }
        }
        
        const resultArray: types.stream.StreamRoomDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({ id, status });
        }
        
        return { contextId: result.context ? result.context.id : null, results: resultArray };
    }
    
    async deleteStreamRoomsByContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository();
        await streamRoomRepository.deleteOneByOneByContext(contextId, async streamRoom => {
            this.streamNotificationService.sendStreamRoomDeleted(streamRoom, solutionId);
        });
    }
    
    async getStreamRoom(executor: Executor, streamRoomId: types.stream.StreamRoomId, type: types.stream.StreamRoomType | undefined) {
        const streamRoom = await this.getDbStreamRoom(streamRoomId);
        await this.verifyRoomAccess(executor, streamRoom, "stream/streamRoomGet");
        if (type && streamRoom.type !== type) {
            throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
        }
        return streamRoom;
    }
    
    // =================================================================================================
    //  WebRTC Signaling
    // =================================================================================================
    
    async subscribeToRemoteStreams(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, subscriptions: StreamSubscription[], websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const { streamRoom, ctx, user } = await this.ensureActiveStreamRoomWithAcl(cloudUser, streamRoomId, websocket, wsId, "stream/streamSubscribe");
        return this.subscribeToRemoteInternal(user.userId, streamRoom, ctx, subscriptions);
    }
    
    private async subscribeToRemoteInternal(userId: types.cloud.UserId, streamRoom: db.stream.StreamRoom, ctx: JanusContext, subscriptions: StreamSubscription[]) {
        const existingSignalingSession = this.findJanusSession(ctx, JanusConstants.SESSION_TYPE.MAIN, streamRoom.janusRoomId);
        if (!existingSignalingSession) {
            throw new AppException("NOT_CONNECTED_TO_THE_ROOM");
        }
        
        const sessionType = JanusConstants.SESSION_TYPE.SUBSCRIBER;
        const existingJanusSession = this.findJanusSession(ctx, sessionType, streamRoom.janusRoomId);
        const mappedStreams = subscriptions.map(x => ({ feed: x.streamId, mid: x.streamTrackId }));
        
        if (existingJanusSession) {
            const janusSession = existingJanusSession.session;
            const res = await ctx.ws.janusVideoRoomPluginApi.subscribeOnExisting({
                janus: "message",
                session_id: janusSession.id,
                plugin: JanusConstants.PLUGIN,
                handle_id: janusSession.handle,
                body: { request: JanusConstants.REQUEST.SUBSCRIBE, streams: mappedStreams },
            });
            if (this.hasStreamsArray(res)) {
                existingJanusSession.addStreamsOffer(res.plugindata.data.streams.map((p: any) => p.feed_id) as types.stream.StreamId[]);
            }
            return { sessionId: janusSession.id, offer: res.jsep ? res.jsep : undefined };
        }
        
        let janusSessionX;
        try {
            janusSessionX = await ctx.createJanusSession(`${sessionType}/${streamRoom.janusRoomId}`, streamRoom.id, sessionType, userId);
            const janusSession = janusSessionX.session;
            const res = await ctx.ws.janusVideoRoomPluginApi.joinAsSubscriber({
                janus: "message",
                session_id: janusSession.id,
                plugin: JanusConstants.PLUGIN,
                handle_id: janusSession.handle,
                body: {
                    request: JanusConstants.REQUEST.JOIN,
                    ptype: JanusConstants.PTYPE.SUBSCRIBER,
                    room: streamRoom.janusRoomId,
                    data: true,
                    use_msid: true,
                    streams: mappedStreams,
                },
            });
            janusSessionX.addStreamsOffer(res.plugindata.data.streams.map((p: any) => p.feed_id as WebRtcTypes.StreamId));
            return { sessionId: janusSession.id, offer: res.jsep };
        }
        catch (e) {
            if (janusSessionX) {
                try {
                    await ctx.deleteJanusSession(janusSessionX.session.id);
                }
                catch { /* ignore cleanup errors, they will be logged but user should not receive them */ }
            }
            throw e;
        }
    }
    
    async modifyRemoteSubscriptions(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, subscriptionsToAdd: StreamSubscription[], subscriptionsToRemove: StreamSubscription[], websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const { streamRoom, ctx } = await this.ensureActiveStreamRoomWithAcl(cloudUser, streamRoomId, websocket, wsId, "stream/streamModifySubscription");
        return this._modifyRemoteSubscriptionsInternal(streamRoom, ctx, subscriptionsToAdd, subscriptionsToRemove);
    }
    
    async unsubscribeFromRemoteStreams(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, subscriptionsToRemove: StreamSubscription[], websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const { streamRoom, ctx } = await this.ensureActiveStreamRoomWithAcl(cloudUser, streamRoomId, websocket, wsId, "stream/streamUnsubscribe");
        return this._modifyRemoteSubscriptionsInternal(streamRoom, ctx, [], subscriptionsToRemove);
    }
    
    private async _modifyRemoteSubscriptionsInternal(streamRoom: db.stream.StreamRoom, ctx: JanusContext, subscriptionsToAdd: StreamSubscription[], subscriptionsToRemove: StreamSubscription[]) {
        const existingSignalingSession = this.findJanusSession(ctx, JanusConstants.SESSION_TYPE.MAIN, streamRoom.janusRoomId);
        if (!existingSignalingSession) {
            throw new AppException("NOT_CONNECTED_TO_THE_ROOM");
        }
        
        const existingJanusSession = this.findJanusSession(ctx, JanusConstants.SESSION_TYPE.SUBSCRIBER, streamRoom.janusRoomId);
        if (!existingJanusSession) {
            throw new AppException("NO_SUBSCRIPTIONS_TO_MODIFY");
        }
        
        const mappedStreamsToAdd = subscriptionsToAdd.map(x => ({ feed: x.streamId, mid: x.streamTrackId }));
        const mappedStreamsToRemove = subscriptionsToRemove.map(x => ({ feed: x.streamId, mid: x.streamTrackId }));
        const janusSession = existingJanusSession.session;
        
        const baseRequest = {
            janus: "message",
            session_id: janusSession.id,
            plugin: JanusConstants.PLUGIN,
            handle_id: janusSession.handle,
            body: {} as any,
        };
        
        let res: any;
        
        try {
            if (mappedStreamsToAdd.length > 0 && mappedStreamsToRemove.length > 0) {
                baseRequest.body = { request: JanusConstants.REQUEST.UPDATE, subscribe: mappedStreamsToAdd, unsubscribe: mappedStreamsToRemove };
                res = await ctx.ws.janusVideoRoomPluginApi.updateSubscriptions(baseRequest as UpdateSubscriptionsRequest);
            }
            else if (mappedStreamsToAdd.length > 0) {
                baseRequest.body = { request: JanusConstants.REQUEST.SUBSCRIBE, streams: mappedStreamsToAdd };
                res = await ctx.ws.janusVideoRoomPluginApi.subscribeOnExisting(baseRequest as SubscribeOnExistingRequest);
            }
            else if (mappedStreamsToRemove.length > 0) {
                baseRequest.body = { request: JanusConstants.REQUEST.UNSUBSCRIBE, streams: mappedStreamsToRemove };
                res = await ctx.ws.janusVideoRoomPluginApi.unsubscribeOnExisting(baseRequest as UnsubscribeOnExistingRequest);
            }
            else {
                throw new AppException("NO_SUBSCRIPTIONS_TO_MODIFY");
            }
        }
        catch {
            throw new AppException("MEDIA_SERVER_ERROR", "Modify subscription failed");
        }
        
        if (this.hasStreamsArray(res)) {
            existingJanusSession.addStreamsOffer(res.plugindata.data.streams.map((p: any) => p.feed_id) as types.stream.StreamId[]);
        }
        return { sessionId: janusSession.id, offer: res.jsep ? res.jsep : undefined };
    }
    
    async acceptStreamOffer(cloudUser: CloudUser, answer: { type: "answer", sdp: string }, sessionId: types.stream.SessionId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const ctx = await this.janusContextFactory.prepareJanusContext(websocket, wsId);
        const session = ctx.findJanusSession(sessionId);
        
        const streamRoom = await this.getDbStreamRoom(session.streamRoomId);
        if (streamRoom.closed) {
            throw new AppException("STREAM_ROOM_CLOSED");
        }
        await this.verifyRoomAccess(cloudUser, streamRoom, "stream/streamAcceptOffer");
        
        try {
            await ctx.ws.janusVideoRoomPluginApi.start({
                janus: "message",
                session_id: session.session.id,
                plugin: JanusConstants.PLUGIN,
                handle_id: session.session.handle,
                body: { request: JanusConstants.REQUEST.START },
                jsep: answer,
            });
            session.acceptStreamsOffer();
        }
        catch {
            throw new AppException("MEDIA_SERVER_ERROR", "Failed to start media session");
        }
    }
    
    async setStreamOffer(_cloudUser: CloudUser, offer: { type: "offer", sdp: string }, sessionId: types.stream.SessionId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const ctx = await this.janusContextFactory.prepareJanusContext(websocket, wsId);
        const session = ctx.findJanusSession(sessionId);
        const janusSession = session.session;
        
        let res;
        try {
            res = await ctx.ws.janusVideoRoomPluginApi.configure({
                janus: "message",
                session_id: janusSession.id,
                plugin: JanusConstants.PLUGIN,
                handle_id: janusSession.handle,
                body: { request: JanusConstants.REQUEST.CONFIGURE },
                jsep: offer,
            });
        }
        catch {
            throw new AppException("MEDIA_INVALID_SDP", "Failed to configure stream");
        }
        
        return {
            sessionId: janusSession.id,
            answer: res.jsep,
        };
        
    }
    
    async trickle(cloudUser: CloudUser, rtcCandidate: WebRtcTypes.RTCIceCandidate, sessionId: types.stream.SessionId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const ctx = await this.janusContextFactory.prepareJanusContext(websocket, wsId);
        const session = ctx.findJanusSession(sessionId);
        
        const streamRoom = await this.getDbStreamRoom(session.streamRoomId);
        if (streamRoom.closed) {
            throw new AppException("STREAM_ROOM_CLOSED");
        }
        await this.verifyRoomAccess(cloudUser, streamRoom, "stream/streamTrickle");
        
        await ctx.ws.janusVideoRoomPluginApi.trickle({
            janus: "trickle",
            session_id: session.session.id,
            plugin: JanusConstants.PLUGIN,
            handle_id: session.session.handle,
            body: { candidate: rtcCandidate },
        });
    }
    
    async publishStream(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, offer: { type: "offer", sdp: string }, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const { streamRoom, ctx, user } = await this.ensureActiveStreamRoomWithAcl(cloudUser, streamRoomId, websocket, wsId, "stream/streamPublish");
        
        const sessionType = JanusConstants.SESSION_TYPE.MAIN;
        
        const existingSession = this.findJanusSession(ctx, sessionType, streamRoom.janusRoomId);
        const isAlreadyJoined = !!(existingSession && existingSession.janusPublisherId);
        
        if (isAlreadyJoined && (existingSession as any).__mediaPublished) {
            throw new AppException("MEDIA_SERVER_ERROR", "Stream already published");
        }
        
        const janusSessionX = existingSession || await ctx.createJanusSession(`${sessionType}/${streamRoom.janusRoomId}`, streamRoomId, sessionType, user.userId);
        const janusSession = janusSessionX.session;
        
        if (!isAlreadyJoined) {
            const joinRes = await ctx.ws.janusVideoRoomPluginApi.joinAsPublisher({
                janus: "message",
                session_id: janusSession.id,
                plugin: JanusConstants.PLUGIN,
                handle_id: janusSession.handle,
                body: {
                    request: JanusConstants.REQUEST.JOIN,
                    ptype: JanusConstants.PTYPE.PUBLISHER,
                    room: streamRoom.janusRoomId,
                    display: user.userId,
                },
            });
            
            janusSessionX.janusPublisherId = joinRes.plugindata.data.id as WebRtcTypes.VideoRoomPublisherId;
            
            await this.janusRoomsWatcher.addSessionToWatch({
                host: this.host,
                streamRoomId: streamRoomId,
                janusRoomId: streamRoom.janusRoomId as number,
                publisherId: Number(janusSessionX.janusPublisherId),
            });
        }
        
        const publisherId = Number(janusSessionX.janusPublisherId);
        
        try {
            const res = await ctx.ws.janusVideoRoomPluginApi.publish({
                janus: "message",
                session_id: janusSession.id,
                plugin: JanusConstants.PLUGIN,
                handle_id: janusSession.handle,
                body: { request: JanusConstants.REQUEST.PUBLISH, e2ee: true, display: user.userId, data: true },
                jsep: offer,
            });
            
            if ("streams" in res.plugindata.data && Array.isArray(res.plugindata.data.streams)) {
                const publisher: Publisher = { id: publisherId, streams: res.plugindata.data.streams, display: janusSessionX.userId };
                const convertedPublisher = this.janusContextFactory.convertPublisherToPublisherAsStream(publisher);
                
                janusSessionX.keepPublishedStream(publisher);
                (janusSessionX as any).__mediaPublished = true;
                
                this.streamNotificationService.sendStreamPublishedEvent(streamRoom, { streamRoomId: streamRoom.id, stream: convertedPublisher, userId: user.userId });
                
                return {
                    sessionId: janusSession.id,
                    answer: res.jsep,
                    publishedData: { streamRoomId: streamRoomId, userId: user.userId, stream: convertedPublisher },
                };
            }
            
            throw new AppException("MEDIA_SERVER_ERROR", "Publish returned no streams");
        }
        catch (e) {
            if (AppException.is(e, "MEDIA_SERVER_ERROR")) {
                throw e;
            }
            throw new AppException("MEDIA_INVALID_SDP", "Failed to publish stream");
        }
    }
    
    async updateStream(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, offer: { type: "offer", sdp: string }, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const { streamRoom, ctx, user } = await this.ensureActiveStreamRoomWithAcl(cloudUser, streamRoomId, websocket, wsId, "stream/streamUpdate");
        
        const janusSessionX = this.findJanusSession(ctx, JanusConstants.SESSION_TYPE.MAIN, streamRoom.janusRoomId);
        if (!janusSessionX) {
            throw new AppException("NOT_CONNECTED_TO_THE_ROOM");
        }
        
        const janusSession = janusSessionX.session;
        const publisherId = janusSessionX.janusPublisherId as unknown as StreamId;
        
        const streamsBeforeUpdate = await this.listStreamsInternal(streamRoom);
        
        let res;
        try {
            res = await ctx.ws.janusVideoRoomPluginApi.configure({
                janus: "message",
                session_id: janusSession.id,
                plugin: JanusConstants.PLUGIN,
                handle_id: janusSession.handle,
                body: { request: JanusConstants.REQUEST.CONFIGURE },
                jsep: offer,
            });
        }
        catch {
            throw new AppException("MEDIA_INVALID_SDP", "Failed to configure stream");
        }
        
        const streamsAfterUpdate = await this.listStreamsInternal(streamRoom);
        const diffs = this.diffStreams(streamsBeforeUpdate, streamsAfterUpdate);
        
        this.streamNotificationService.sendStreamUpdatedEvent(streamRoom, {
            streamRoomId: streamRoom.id,
            streamsAdded: diffs.streamsAdded,
            streamsRemoved: diffs.streamsRemoved,
            streamsModified: diffs.streamsModified,
        });
        
        if ("streams" in res.plugindata.data && Array.isArray(res.plugindata.data.streams)) {
            const publisher: Publisher = { id: publisherId, streams: res.plugindata.data.streams, display: janusSessionX.userId };
            const convertedPublisher = this.janusContextFactory.convertPublisherToPublisherAsStream(publisher);
            janusSessionX.keepPublishedStream(publisher);
            
            return {
                sessionId: janusSession.id,
                answer: res.jsep,
                publishedData: { streamRoomId: streamRoomId, userId: user.userId, stream: convertedPublisher },
            };
        }
        else {
            throw new AppException("MEDIA_SERVER_ERROR", "Update returned no streams");
        }
    }
    
    async unpublishStream(cloudUser: CloudUser, sessionId: types.stream.SessionId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const ctx = await this.janusContextFactory.prepareJanusContext(websocket, wsId);
        const session = ctx.findJanusSession(sessionId);
        
        const streamRoom = await this.getDbStreamRoom(session.streamRoomId);
        const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, streamRoom.contextId);
        
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamUnpublish", ["streamRoomId=" + streamRoom.id]);
        if (!this.policy.canUpdateContainer(user, context, streamRoom)) {
            throw new AppException("ACCESS_DENIED");
        }
        
        await ctx.ws.janusVideoRoomPluginApi.unpublish({
            janus: "message",
            session_id: session.session.id,
            plugin: JanusConstants.PLUGIN,
            handle_id: session.session.handle,
            body: { request: JanusConstants.REQUEST.UNPUBLISH },
        });
        
        await ctx.deleteJanusSession(sessionId);
        const signalingSessionType = JanusConstants.SESSION_TYPE.MAIN;
        await ctx.createJanusSession(`${signalingSessionType}/${streamRoom.janusRoomId}`, streamRoom.id, signalingSessionType, user.userId);
    }
    
    async joinStreamRoom(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const { streamRoom, ctx, user } = await this.ensureActiveStreamRoomWithAcl(cloudUser, streamRoomId, websocket, wsId, "stream/streamRoomJoin");
        const signalingSessionType = JanusConstants.SESSION_TYPE.MAIN;
        const currentSession = this.findJanusSession(ctx, signalingSessionType, streamRoom.janusRoomId);
        
        if (!currentSession) {
            const newSession = await ctx.createJanusSession(`${signalingSessionType}/${streamRoom.janusRoomId}`, streamRoom.id, signalingSessionType, user.userId);
            try {
                const joinRes = await ctx.ws.janusVideoRoomPluginApi.joinAsPublisher({
                    janus: "message",
                    session_id: newSession.session.id,
                    plugin: JanusConstants.PLUGIN,
                    handle_id: newSession.session.handle,
                    body: {
                        request: JanusConstants.REQUEST.JOIN,
                        ptype: JanusConstants.PTYPE.PUBLISHER, // Join as publisher WITHOUT media
                        room: streamRoom.janusRoomId,
                        display: user.userId,
                    },
                });
                
                newSession.janusPublisherId = joinRes.plugindata.data.id as WebRtcTypes.VideoRoomPublisherId;
                
                await this.janusRoomsWatcher.addSessionToWatch({
                    host: this.host,
                    streamRoomId: streamRoomId,
                    janusRoomId: streamRoom.janusRoomId as number,
                    publisherId: Number(newSession.janusPublisherId),
                });
            }
            catch {
                throw new AppException("MEDIA_SERVER_ERROR", "Failed to join room");
            }
        }
    }
    
    async leaveStreamRoom(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const streamRoom = await this.getDbStreamRoom(streamRoomId);
        await this.verifyRoomAccess(cloudUser, streamRoom, "stream/streamRoomLeave");
        
        const ctx = await this.janusContextFactory.prepareJanusContext(websocket, wsId);
        await ctx.deleteAllJanusSessionsByRoom(streamRoomId);
    }
    
    async listStreams(executor: Executor, streamRoomId: types.stream.StreamRoomId) {
        const streamRoom = await this.getDbStreamRoom(streamRoomId);
        if (streamRoom.closed) {
            throw new AppException("STREAM_ROOM_CLOSED");
        }
        await this.verifyRoomAccess(executor, streamRoom, "stream/streamList");
        
        return this.listStreamsInternal(streamRoom);
    }
    
    private async listStreamsInternal(streamRoom: db.stream.StreamRoom) {
        const streams = await this.janusContextFactory.withJanus(async (janusVideoRoomPluginApi, sessionId, handleId) => {
            const joinRes = await janusVideoRoomPluginApi.joinAsPublisher({
                janus: "message",
                session_id: sessionId,
                plugin: JanusConstants.PLUGIN,
                handle_id: handleId,
                body: {
                    request: JanusConstants.REQUEST.JOIN,
                    ptype: JanusConstants.PTYPE.PUBLISHER,
                    room: streamRoom.janusRoomId,
                },
            });
            
            const publishers = "publishers" in joinRes.plugindata.data && Array.isArray(joinRes.plugindata.data.publishers)
                ? joinRes.plugindata.data.publishers
                : [];
            
            const publishersAsStreams = publishers.map(x => this.janusContextFactory.convertPublisherToPublisherAsStream(x));
            
            await janusVideoRoomPluginApi.leave({
                janus: "message",
                session_id: sessionId,
                plugin: JanusConstants.PLUGIN,
                handle_id: handleId,
                body: { request: JanusConstants.REQUEST.LEAVE },
            });
            return publishersAsStreams;
        });
        return streams;
    }
    
    async getAllStreamRooms(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.stream.StreamRoomType | undefined, listParams: types.core.ListModel, sortBy: keyof db.stream.StreamRoom) {
        const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomListAll", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const streamRooms = await this.repositoryFactory.createStreamRoomRepository().getAllStreams(contextId, type, listParams, sortBy);
        return { user, streamRooms };
    }
    
    async getMyStreamRooms(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.stream.StreamRoomType | undefined, listParams: types.core.ListModel, sortBy: keyof db.stream.StreamRoom, scope: types.core.ContainerAccessScope) {
        const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomList", []);
        
        const canList = scope === "ALL"
            ? this.policy.canListAllContainers(user, context)
            : this.policy.canListMyContainers(user, context);
        
        if (!canList) {
            throw new AppException("ACCESS_DENIED");
        }
        
        const streamRooms = await this.repositoryFactory.createStreamRoomRepository().getPageByContextAndUser(contextId, type, user.userId, cloudUser.solutionId, listParams, sortBy, scope);
        return { user, streamRooms };
    }
    
    async getStreamRoomsByContext(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel2<types.stream.StreamRoomId>, state: "closed" | "all" | "active") {
        const ctx = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!ctx) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, ctx, (user, context) => {
            if (!this.policy.canListAllContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomList", []);
        });
        
        const repo = this.repositoryFactory.createStreamRoomRepository();
        switch (state) {
            case "all": return { streamRooms: await repo.getPageByContext(contextId, listParams) };
            case "active": return { streamRooms: await repo.getPageOfActiveStreamsByContext(contextId, listParams) };
            case "closed": return { streamRooms: await repo.getPageOfClosedStreamsByContext(contextId, listParams) };
            default: throw new AppException("INVALID_PARAMS");
        }
    }
    
    async sendCustomNotification(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, keyId: types.core.KeyId, data: unknown, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        const streamRoom = await this.getDbStreamRoom(streamRoomId);
        const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, streamRoom.contextId);
        
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamSendCustomNotification", ["streamRoomId=" + streamRoomId]);
        if (!this.policy.canSendCustomNotification(user, context, streamRoom)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (users && users.some(element => !streamRoom.users.includes(element))) {
            throw new AppException("USER_DOES_NOT_HAVE_ACCESS_TO_CONTAINER");
        }
        
        this.streamNotificationService.sendStreamCustomEvent(streamRoom, keyId, data, { id: user.userId, pub: user.userPubKey }, customChannelName, users);
        return streamRoom;
    }
    
    async enableStreamRoomRecording(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId) {
        const { streamRoom, ctx, user, context } = await this.ensureActiveStreamRoomWithAcl(cloudUser, streamRoomId, websocket, wsId, "stream/streamRoomEnableRecording");
        
        if (!this.policy.canUpdateContainer(user, context, streamRoom)) {
            throw new AppException("ACCESS_DENIED");
        }
        
        const existingSignalingSession = this.findJanusSession(ctx, JanusConstants.SESSION_TYPE.MAIN, streamRoom.janusRoomId);
        if (!existingSignalingSession) {
            throw new AppException("MAIN_MEDIA_SESSION_FOR_USER_MISSING");
        }
        
        const janusSession = existingSignalingSession.session;
        await ctx.ws.janusVideoRoomPluginApi.edit({
            janus: "message",
            session_id: janusSession.id,
            plugin: JanusConstants.PLUGIN,
            handle_id: janusSession.handle,
            body: {
                request: JanusConstants.REQUEST.EDIT,
                room: streamRoom.janusRoomId as WebRtcTypes.VideoRoomId,
                new_rec_dir: `${this.config.streams.mediaServer.recordingsPath}/${streamRoomId}`,
            },
        });
        await ctx.ws.janusVideoRoomPluginApi.enableRcording({
            janus: "message",
            session_id: janusSession.id,
            plugin: JanusConstants.PLUGIN,
            handle_id: janusSession.handle,
            body: {
                request: JanusConstants.REQUEST.ENABLE_RECORDING,
                room: streamRoom.janusRoomId as WebRtcTypes.VideoRoomId,
                record: true,
            },
        });
    }
    
    async closeStreamRoom(cloudUser: CloudUser, id: types.stream.StreamRoomId) {
        const streamRoom = await this.getDbStreamRoom(id);
        const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, streamRoom.contextId);
        
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomClose", ["streamRoomId=" + id]);
        if (!this.policy.canUpdateContainer(user, context, streamRoom)) {
            throw new AppException("ACCESS_DENIED");
        }
        
        await this.repositoryFactory.createStreamRoomRepository().closeStreamRoom(id);
        return streamRoom;
    }
    
    private diffStreams(before: WebRtcTypes.PublisherAsStream[], after: WebRtcTypes.PublisherAsStream[]) {
        const beforeMap = new Map<number, WebRtcTypes.PublisherAsStream>(before.map(s => [s.id, s]));
        const afterMap = new Map<number, WebRtcTypes.PublisherAsStream>(after.map(s => [s.id, s]));
        
        const streamsAdded = after.filter(a => !beforeMap.has(a.id));
        const streamsRemoved = before.filter(b => !afterMap.has(b.id));
        
        const streamsModified: { streamId: number, tracks: { before?: WebRtcTypes.Stream, after?: WebRtcTypes.Stream }[] }[] = [];
        
        for (const a of after) {
            const b = beforeMap.get(a.id);
            if (!b) {
                continue;
            }
            const trackDiffs = this.diffTracks(b.tracks, a.tracks);
            if (trackDiffs.length > 0) {
                streamsModified.push({ streamId: a.id, tracks: trackDiffs });
            }
        }
        
        return { streamsAdded, streamsRemoved, streamsModified };
    }
    
    private diffTracks(beforeTracks: WebRtcTypes.Stream[], afterTracks: WebRtcTypes.Stream[]) {
        const beforeTrackMap = new Map(beforeTracks.map(t => [t.mid, t]));
        const afterTrackMap = new Map(afterTracks.map(t => [t.mid, t]));
        const diffs: { before?: WebRtcTypes.Stream, after?: WebRtcTypes.Stream }[] = [];
        
        for (const bt of beforeTracks) {
            const at = afterTrackMap.get(bt.mid);
            if (!at) {
                diffs.push({ before: bt, after: undefined });
            }
            else if (!this.janusStreamEqual(bt, at)) {
                diffs.push({ before: bt, after: at });
            }
        }
        
        for (const at of afterTracks) {
            if (!beforeTrackMap.has(at.mid)) {
                diffs.push({ before: undefined, after: at });
            }
        }
        return diffs;
    }
    
    private janusStreamEqual(a: Omit<WebRtcTypes.Stream, "mid">, b: Omit<WebRtcTypes.Stream, "mid">): boolean {
        return (
            a.type === b.type &&
            a.mindex === b.mindex &&
            a.codec === b.codec &&
            a.disabled === b.disabled &&
            a.description === b.description &&
            a.moderated === b.moderated &&
            a.simulcast === b.simulcast &&
            a.svc === b.svc &&
            a.talking === b.talking
        );
    }
    
    private async getDbStreamRoom(streamRoomId: types.stream.StreamRoomId) {
        const streamRoom = await this.repositoryFactory.createStreamRoomRepository().get(streamRoomId);
        if (!streamRoom) {
            throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
        }
        return streamRoom;
    }
    
    private async verifyRoomAccess(executor: Executor, streamRoom: db.stream.StreamRoom, requiredAcl: AclFunctionNameX) {
        return await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, streamRoom.contextId, (user, context) => {
            this.cloudAclChecker.verifyAccess(user.acl, requiredAcl, ["streamRoomId=" + streamRoom.id]);
            if (!this.policy.canReadContainer(user, context, streamRoom)) {
                throw new AppException("ACCESS_DENIED");
            }
        });
    }
    
    private async ensureActiveStreamRoomWithAcl(cloudUser: CloudUser, streamRoomId: types.stream.StreamRoomId, websocket: WebSocketExtendedWithJanus, wsId: types.core.WsId, requiredAcl: AclFunctionNameX) {
        const streamRoom = await this.getDbStreamRoom(streamRoomId);
        if (streamRoom.closed) {
            throw new AppException("STREAM_ROOM_CLOSED");
        }
        
        const { user, context } = await this.cloudAccessValidator.getUserFromContext(cloudUser, streamRoom.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, requiredAcl, ["streamRoomId=" + streamRoom.id]);
        if (!this.policy.canReadContainer(user, context, streamRoom)) {
            throw new AppException("ACCESS_DENIED");
        }
        
        const ctx = await this.janusContextFactory.prepareJanusContext(websocket, wsId);
        return { streamRoom, ctx, user, context };
    }
    
    private findJanusSession(ctx: JanusContext, type: JanusSessionType, janusRoomId: number) {
        return ctx.findJanusSessionBySourceOrReturnNull(`${type}/${janusRoomId}`);
    }
    
    private hasStreamsArray(res: any): boolean {
        const streams = res?.plugindata?.data?.streams;
        return streams !== undefined && Array.isArray(streams);
    }
    
}

class StreamRoomPolicy extends BasePolicy<db.stream.StreamRoom, unknown> {
    protected isItemCreator() {
        return false;
    }
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.stream || {};
    }
}
