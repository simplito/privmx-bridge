/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { SessionId } from "../webrtc/v2/WebRtcTypes";
import * as webRtcTypes from "../webrtc/v2/WebRtcTypes";
import { Logger } from "../log/Logger";
import { AppException } from "../../api/AppException";
import { JanusConnection } from "../../CommonTypes";
import { StreamRoomId } from "../../types/stream";
import { JanusRoomsWatcherCache } from "../../cluster/master/ipcServices/JanusRoomsWatcherCache";
import { JanusApi } from "../webrtc/v2/janus/JanusApi";
import { JanusContextFactory } from "./JanusContextFactory";
import { JobService } from "../job/JobService";
import { RepositoryFactory } from "../../db/RepositoryFactory";

export interface JanusRoomWatch {
    host: string;
    streamRoomId: StreamRoomId;
    janusRoomId: number;
    publisherId: number;
}
interface VideoPluginEvent {
    janus: "event";
    session_id: number;
    sender: number;
    plugindata: {
        plugin: "janus.plugin.videoroom";
        data: unknown;
    }
}

export class JanusRoomsWatcher {
    
    private janusConnection: JanusConnection | undefined;
    private mainSessionId: SessionId | undefined;
    
    private roomHandles: Map<number, webRtcTypes.VideoRoomPluginHandleId> = new Map();
    private initializationPromise: Promise<void> | null = null;
    
    constructor(
        private cache: JanusRoomsWatcherCache,
        private logger: Logger,
        private janusContextFactory: JanusContextFactory,
        private jobService: JobService,
        private repositoryFactory: RepositoryFactory,
    ) {
        this.logger.debug({}, "JanusRoomsWatcher initialized.");
    }
    
    private async onJanusEvent(evt: unknown) {
        if (!this.isVideoPluginEvent(evt)) {
            return;
        }
        if (!this.isPublisherLeavingOrUnpublishing(evt)) {
            return;
        }
        
        const data = evt.plugindata.data as Record<string, unknown>;
        const rawPublisherId = data.leaving ?? data.unpublished;
        
        // Janus sends "ok" to the person who clicked leave, we ignore it.
        if (rawPublisherId === "ok") {
            return;
        }
        
        const publisherId = Number(rawPublisherId);
        const janusRoomId = Number(data.room);
        
        const lookup = await this.cache.janusRoomIdToStreamRoomId({janusRoomId});
        if (!lookup) {
            this.logger.debug("NO LOOKUP");
            return;
        }
        
        const { host, streamRoomId } = lookup;
        const roomPublishers = await this.cache.getRoomPublishers({host, streamRoomId});
        
        if (!roomPublishers || !(publisherId in roomPublishers)) {
            this.logger.debug("NO ROOMPUBLISHERS");
            return;
        }
        
        const watcherModel = roomPublishers[publisherId];
        const isRoomEmpty = await this.cache.removePublisher(watcherModel);
        
        this.logger.debug({ publisherId, isRoomEmpty }, "Publisher removed via Watcher");
        
        if (isRoomEmpty) {
            this.logger.debug({ host, streamRoomId }, "LAST PUBLISHER LEFT. SETTING ROOM TO CLOSED");
            await this.closeDbRoomAndTriggerAutoDestroy(host, streamRoomId);
        }
    }
    
    private async closeDbRoomAndTriggerAutoDestroy(host: string, id: StreamRoomId) {
        await this.repositoryFactory.withTransaction(async (session) => {
            const repo = this.repositoryFactory.createStreamRoomRepository(session);
            const streamRoom = await repo.get(id);
            
            if (!streamRoom || streamRoom.closed) {
                return;
            }
            
            this.logger.debug("CLOSING STREAM ROOM IN DATABASE", id);
            await repo.closeStreamRoom(id);
            
            await this.cache.removeRoomWatcher({host, streamRoomId: id});
            
            if (streamRoom.janusRoomId) {
                await this.stopWatchingJanusRoom(streamRoom.janusRoomId);
            }
        });
    }
    
    async cleanupEmptyRooms(host: string, emptyRoomIds: StreamRoomId[]): Promise<void> {
        if (!emptyRoomIds || emptyRoomIds.length === 0) {
            return;
        }
        
        this.logger.debug({ host }, `Job Cleaner: Closing ${emptyRoomIds.length} empty rooms`);
        
        const results = await Promise.allSettled(
            emptyRoomIds.map(id => this.closeDbRoomAndTriggerAutoDestroy(host, id)),
        );
        
        results.forEach((res, index) => {
            if (res.status === "rejected") {
                this.logger.debug({ id: emptyRoomIds[index], error: res.reason }, "Failed to close empty room");
            }
        });
    }
    
    async addSessionToWatch(model: JanusRoomWatch) {
        await this.ensureConnection();
        await this.cache.addPublisher(model);
        
        if (this.roomHandles.has(model.janusRoomId)) {
            return;
        }
        
        try {
            await this.attachAndJoinRoom(model.janusRoomId as webRtcTypes.VideoRoomId);
        }
        catch (error) {
            this.logger.debug({ error, model }, "Failed to attach watcher to room");
            await this.cache.removePublisher(model);
        }
    }
    
    async removeSessionFromWatch(model: JanusRoomWatch) {
        const isRoomEmpty = await this.cache.removePublisher(model);
        if (isRoomEmpty) {
            await this.closeDbRoomAndTriggerAutoDestroy(model.host, model.streamRoomId);
        }
    }
    
    async removeRoomWatcher(host: string, streamRoomId: StreamRoomId) {
        await this.cache.removeRoomWatcher({host, streamRoomId});
    }
    
    async stopWatchingJanusRoom(janusRoomId: number) {
        if (this.roomHandles.has(janusRoomId)) {
            await this.detachAndLeaveRoom(janusRoomId);
        }
    }
    
    private async ensureConnection(): Promise<void> {
        if (this.janusConnection && this.mainSessionId && !this.janusConnection.janusWs.CLOSED) {
            return;
        }
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        
        this.initializationPromise = this.connectAndSetup();
        
        try {
            await this.initializationPromise;
        }
        finally {
            this.initializationPromise = null;
        }
    }
    
    private async connectAndSetup() {
        this.logger.debug({}, "JanusRoomsWatcher: Connecting to Janus...");
        try {
            this.janusConnection = await this.janusContextFactory.openWs(undefined, async (notification) => {
                try {
                    await this.onJanusEvent(notification);
                }
                catch (err) {
                    this.logger.debug(err, "onJanusEvent threw an error");
                }
            });
            
            const createSessionResponse = await this.janusConnection.janusApi.create({ janus: "create" });
            this.mainSessionId = createSessionResponse.data.id;
            
            this.startKeepAlive(this.janusConnection.janusApi, this.mainSessionId);
            
            this.janusConnection.janusWs.addEventListener("close", () => {
                this.logger.debug({}, "JanusRoomsWatcher: Connection lost.");
                this.cleanup();
            });
            this.logger.debug({ sessionId: this.mainSessionId }, "JanusRoomsWatcher: Connected.");
        }
        catch (e) {
            this.logger.debug(e, "JanusRoomsWatcher: Failed to connect.");
            this.cleanup();
            throw new AppException("MEDIA_SERVER_ERROR");
        }
    }
    
    private cleanup() {
        this.janusConnection = undefined;
        this.mainSessionId = undefined;
        this.roomHandles.clear();
    }
    
    private async attachAndJoinRoom(janusRoomId: webRtcTypes.VideoRoomId) {
        if (!this.janusConnection || !this.mainSessionId) {
            throw new AppException("MEDIA_SERVER_ERROR", "Not connected");
        }
        
        const attachResponse = await this.janusConnection.janusApi.attach({
            janus: "attach",
            session_id: this.mainSessionId,
            plugin: "janus.plugin.videoroom",
        });
        
        const handleId = attachResponse.data.id as webRtcTypes.VideoRoomPluginHandleId;
        
        await this.janusConnection.janusVideoRoomPluginApi.joinAsPublisher({
            janus: "message",
            session_id: this.mainSessionId,
            plugin: "janus.plugin.videoroom",
            handle_id: handleId,
            body: {
                request: "join",
                ptype: "publisher",
                room: janusRoomId,
            },
        });
        
        this.roomHandles.set(janusRoomId, handleId);
    }
    
    private async detachAndLeaveRoom(janusRoomId: number) {
        const handleId = this.roomHandles.get(janusRoomId);
        if (!handleId || !this.janusConnection || !this.mainSessionId) {
            return;
        }
        
        this.roomHandles.delete(janusRoomId);
        
        try {
            await this.janusConnection.janusApi.detach({
                janus: "detach",
                session_id: this.mainSessionId,
                handle_id: handleId,
            });
        }
        catch (e) {
            this.logger.debug({ janusRoomId, error: e }, "Failed to detach handle (maybe already closed)");
        }
    }
    
    private startKeepAlive(janusApi: JanusApi, sessionId: SessionId) {
        this.jobService.addPeriodicJob(async () => {
            if (!this.janusConnection || !this.mainSessionId || this.mainSessionId !== sessionId) {
                return;
            }
            try {
                await janusApi.keepAlive({ janus: "keepalive", session_id: sessionId });
            }
            catch (err) {
                this.logger.debug(err, "JanusRoomsWatcher keepalive failed");
            }
        }, 25000, "JanusRoomsChecker KeepAlive");
    }
    
    private isVideoPluginEvent(evt: unknown): evt is VideoPluginEvent {
        return (
            typeof evt === "object" && evt !== null &&
            "janus" in evt && (evt as Record<string, unknown>).janus === "event" &&
            "plugindata" in evt &&
            typeof (evt as Record<string, unknown>).plugindata === "object" &&
            (evt as Record<string, unknown>).plugindata !== null &&
            "data" in ((evt as Record<string, unknown>).plugindata as Record<string, unknown>) &&
            ((evt as Record<string, unknown>).plugindata as Record<string, unknown>).plugin === "janus.plugin.videoroom"
        );
    }
    
    private isPublisherLeavingOrUnpublishing(evt: VideoPluginEvent): boolean {
        const data = evt.plugindata.data as Record<string, unknown>;
        return (
            typeof data === "object" && data !== null &&
            "room" in data &&
            ("leaving" in data || "unpublished" in data)
        );
    }
}
