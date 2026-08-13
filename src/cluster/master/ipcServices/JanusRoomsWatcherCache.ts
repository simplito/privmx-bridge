/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService } from "../Decorators";
import { ApiMethod } from "../../../api/Decorators";
import { Logger } from "../../../service/log/Logger";
import { StreamRoomId } from "../../../types/stream";
import { JanusRoomWatch } from "../../../service/cloud/JanusRoomsWatcher";
import { StreamSubscription } from "../../../api/main/stream/StreamApiTypes";
import { UserId } from "../../../types/cloud";
import { Timespan, Timestamp } from "../../../types/core";
import { DateUtils } from "../../../utils/DateUtils";

export interface RoomLookup {
    streamRoomId: StreamRoomId;
    host: string;
}

export interface RoomSubscriber {
    userId: UserId;
    subscriptions: StreamSubscription[];
}

interface RoomState {
    janusRoomId: number;
    publishers: Map<number, JanusRoomWatch>;
    subscribers: Map<UserId, StreamSubscription[]>;
    ttl: Timespan;
}

interface PendingEmptyRoom {
    host: string;
   closeAt: Timestamp;
}

@IpcService
export class JanusRoomsWatcherCache {
    
    // Map keys are strictly primitive strings to survive IPC serialization
    private hostsMap: Map<string, Map<string, RoomState>> = new Map();
    private janusRoomIdToStreamRoomIdMap: Map<number, RoomLookup> = new Map();
    private pendingEmptyRooms: Map<string, PendingEmptyRoom> = new Map();
    
    constructor(
        private logger: Logger,
    ) {
        this.logger.debug({}, "[CACHE] JanusRoomsWatcherCache initialized.");
    }
    
    @ApiMethod({})
    async extractPendingEmptyRooms(params: { limit: number }): Promise<{ streamRoomId: StreamRoomId, host: string }[]> {
        const limit = params.limit;
        const now = DateUtils.now();
        this.logger.debug({ limit, currentPendingSize: this.pendingEmptyRooms.size }, "[CACHE] extractPendingEmptyRooms invoked");
        
        const result: { streamRoomId: StreamRoomId, host: string }[] = [];
        for (const [streamRoomIdStr, pending] of this.pendingEmptyRooms.entries()) {
            if (pending.closeAt > now) {
                continue;
            }
            result.push({ streamRoomId: streamRoomIdStr as StreamRoomId, host: pending.host });
            this.pendingEmptyRooms.delete(streamRoomIdStr);
            this.logger.debug({ streamRoomIdStr }, "[CACHE] extractPendingEmptyRooms: Popped from queue");
            
            if (result.length >= limit) {
                break;
            }
        }
        
        this.logger.debug({ extractedCount: result.length, newPendingSize: this.pendingEmptyRooms.size }, "[CACHE] extractPendingEmptyRooms returning");
        return result;
    }
    
    @ApiMethod({})
    async getRoomPublishers(params: { host: string, streamRoomId: StreamRoomId }) {
        this.logger.debug({ host: params.host, streamRoomId: params.streamRoomId }, "[CACHE] getRoomPublishers invoked");
        
        const hostRooms = this.hostsMap.get(params.host);
        if (!hostRooms) {
            this.logger.debug({ host: params.host }, "[CACHE] getRoomPublishers: hostRooms is undefined (Host not found in map)");
            return null;
        }
        
        const roomState = hostRooms.get(params.streamRoomId);
        if (!roomState) {
            this.logger.debug({ streamRoomId: params.streamRoomId }, "[CACHE] getRoomPublishers: roomState is undefined (StreamRoomId not found in host)");
            return null;
        }
        
        if (roomState.publishers.size === 0) {
            this.logger.debug({ streamRoomId: params.streamRoomId }, "[CACHE] getRoomPublishers: roomState found, but publishers map is EMPTY");
            return null;
        }
        
        this.logger.debug({
            streamRoomId: params.streamRoomId,
            publishersSize: roomState.publishers.size,
        }, "[CACHE] getRoomPublishers: Translating Map to Object");
        
        const customMap: {[id: number]: JanusRoomWatch} = {};
        for (const [key, entry] of roomState.publishers.entries()) {
            customMap[key] = entry;
        }
        
        this.logger.debug({ mappedKeys: Object.keys(customMap) }, "[CACHE] getRoomPublishers returning customMap");
        return customMap;
    }
    
    @ApiMethod({})
    async addPublisher(model: JanusRoomWatch): Promise<boolean> {
        this.logger.debug({ model }, "[CACHE] addPublisher invoked");
        
        const janusRoomId = Number(model.janusRoomId);
        const publisherId = Number(model.publisherId);
        
        const roomState = this.ensureRoomState(model.host, model.streamRoomId, janusRoomId);
        roomState.ttl = model.ttl ?? DateUtils.ZERO_TIME;
        
        const wasEmpty = roomState.publishers.size === 0;
        roomState.publishers.set(publisherId, model);
        const wasRemovedFromPending = this.pendingEmptyRooms.delete(model.streamRoomId);
        
        this.logger.debug({
            streamRoomId: model.streamRoomId,
            publisherIdAdded: publisherId,
            currentPublishersCount: roomState.publishers.size,
            wasRemovedFromPending: wasRemovedFromPending,
            wasEmpty: wasEmpty,
        }, "[CACHE] addPublisher completed successfully");
        
        return wasEmpty;
    }
    
    @ApiMethod({})
    async removePublisher(model: JanusRoomWatch): Promise<boolean> {
        this.logger.debug({ model }, "[CACHE] removePublisher invoked");
        
        const publisherId = Number(model.publisherId);
        
        const hostRooms = this.hostsMap.get(model.host);
        if (!hostRooms) {
            this.logger.debug({ host: model.host }, "[CACHE] removePublisher: Host not found in hostsMap. Returning FALSE.");
            return false;
        }
        
        const roomState = hostRooms.get(model.streamRoomId);
        if (roomState) {
            const wasDeleted = roomState.publishers.delete(publisherId);
            
            this.logger.debug({
                wasDeleted,
                remainingPublishers: roomState.publishers.size,
                remainingSubscribers: roomState.subscribers.size,
            }, "[CACHE] removePublisher: Deletion step completed");
            
            if (this.isRoomEmpty(roomState)) {
                this.logger.debug({ streamRoomId: model.streamRoomId, ttl: roomState.ttl }, "[CACHE] removePublisher: Room is now EMPTY (no publishers, no members). Queuing for close.");
                return this.queueEmptyRoom(model.host, model.streamRoomId, roomState.ttl);
            }
        }
        else {
            this.logger.debug({ streamRoomId: model.streamRoomId }, "[CACHE] removePublisher: streamRoomId not found in hostRooms. Returning FALSE.");
        }
        
        this.logger.debug({}, "[CACHE] removePublisher: Room still has publishers or members. Returning FALSE.");
        return false;
    }
    
    @ApiMethod({})
    async addSubscriptions(model: { host: string, streamRoomId: StreamRoomId, userId: UserId, subscriptions: StreamSubscription[] }) {
        const roomState = this.ensureRoomState(model.host, model.streamRoomId);
        const current = roomState.subscribers.get(model.userId) ?? [];
        for (const sub of model.subscriptions) {
            if (!current.some(s => this.subscriptionsEqual(s, sub))) {
                current.push(sub);
            }
        }
        roomState.subscribers.set(model.userId, current);
        this.logger.debug({ streamRoomId: model.streamRoomId, userId: model.userId, count: current.length }, "[CACHE] addSubscriptions completed");
    }
    
    @ApiMethod({})
    async removeSubscriptions(model: { host: string, streamRoomId: StreamRoomId, userId: UserId, subscriptions: StreamSubscription[] }) {
        const roomState = this.getRoomState(model.host, model.streamRoomId);
        if (!roomState) {
            return;
        }
        const current = roomState.subscribers.get(model.userId);
        if (!current) {
            return;
        }
        const remaining = current.filter(s => !model.subscriptions.some(toRemove => this.subscriptionsEqual(s, toRemove)));
        // Keep the (possibly empty) membership entry — the viewer is still in the room, just not
        // watching any stream. It is removed only on leave/disconnect (removeSubscriber).
        roomState.subscribers.set(model.userId, remaining);
        this.logger.debug({ streamRoomId: model.streamRoomId, userId: model.userId, remaining: remaining.length }, "[CACHE] removeSubscriptions completed");
    }
    
    @ApiMethod({})
    async addSubscriber(model: { host: string, streamRoomId: StreamRoomId, userId: UserId, ttl?: Timespan }) {
        const roomState = this.ensureRoomState(model.host, model.streamRoomId);
        roomState.ttl = model.ttl ?? DateUtils.ZERO_TIME;
        if (!roomState.subscribers.has(model.userId)) {
            roomState.subscribers.set(model.userId, []);
        }
        // Joining cancels any pending close so a rejoin within the grace period keeps the room alive.
        this.pendingEmptyRooms.delete(model.streamRoomId);
        this.logger.debug({ streamRoomId: model.streamRoomId, userId: model.userId }, "[CACHE] addSubscriber completed");
    }
    
    @ApiMethod({})
    async removeSubscriber(model: { host: string, streamRoomId: StreamRoomId, userId: UserId }): Promise<boolean> {
        const roomState = this.getRoomState(model.host, model.streamRoomId);
        if (!roomState) {
            return false;
        }
        const wasDeleted = roomState.subscribers.delete(model.userId);
        this.logger.debug({ streamRoomId: model.streamRoomId, userId: model.userId, wasDeleted }, "[CACHE] removeSubscriber completed");
        
        // A leaving member can be the transition that empties the room (no publishers, no members).
        if (this.isRoomEmpty(roomState)) {
            this.logger.debug({ streamRoomId: model.streamRoomId, ttl: roomState.ttl }, "[CACHE] removeSubscriber: Room is now EMPTY. Queuing for close.");
            return this.queueEmptyRoom(model.host, model.streamRoomId, roomState.ttl);
        }
        return false;
    }
    
    @ApiMethod({})
    async getRoomSubscribers(model: { host: string, streamRoomId: StreamRoomId }): Promise<RoomSubscriber[]> {
        const roomState = this.getRoomState(model.host, model.streamRoomId);
        if (!roomState) {
            return [];
        }
        const result: RoomSubscriber[] = [];
        for (const [userId, subscriptions] of roomState.subscribers.entries()) {
            result.push({ userId, subscriptions });
        }
        this.logger.debug({ streamRoomId: model.streamRoomId, count: result.length }, "[CACHE] getRoomSubscribers returning");
        return result;
    }
    
    private getRoomState(host: string, streamRoomId: StreamRoomId): RoomState | undefined {
        return this.hostsMap.get(host)?.get(streamRoomId);
    }
    
    private ensureRoomState(host: string, streamRoomId: StreamRoomId, janusRoomId?: number): RoomState {
        let hostRooms = this.hostsMap.get(host);
        if (!hostRooms) {
            hostRooms = new Map();
            this.hostsMap.set(host, hostRooms);
        }
        let roomState = hostRooms.get(streamRoomId);
        if (!roomState) {
            roomState = {
                janusRoomId: janusRoomId ?? 0,
                publishers: new Map<number, JanusRoomWatch>(),
                subscribers: new Map<UserId, StreamSubscription[]>(),
                ttl: DateUtils.ZERO_TIME,
            };
            hostRooms.set(streamRoomId, roomState);
        }
        if (janusRoomId !== undefined) {
            roomState.janusRoomId = janusRoomId;
            this.janusRoomIdToStreamRoomIdMap.set(janusRoomId, { host, streamRoomId });
        }
        return roomState;
    }
    
    private isRoomEmpty(roomState: RoomState): boolean {
        return roomState.publishers.size === 0 && roomState.subscribers.size === 0;
    }
    
    private queueEmptyRoom(host: string, streamRoomId: StreamRoomId, ttl: Timespan): boolean {
        const grace = ttl > 0 ? ttl : DateUtils.ZERO_TIME;
        this.pendingEmptyRooms.set(streamRoomId, { host, closeAt: DateUtils.nowAdd(grace) });
        return grace === 0;
    }
    
    private subscriptionsEqual(a: StreamSubscription, b: StreamSubscription): boolean {
        return a.streamId === b.streamId && a.streamTrackId === b.streamTrackId;
    }
    
    @ApiMethod({})
    async removeRoomWatcher(model: { host: string, streamRoomId: StreamRoomId }) {
        this.logger.debug({ host: model.host, streamRoomId: model.streamRoomId }, "[CACHE] removeRoomWatcher invoked");
        
        const hostRooms = this.hostsMap.get(model.host);
        if (!hostRooms) {
            this.logger.debug({ host: model.host }, "[CACHE] removeRoomWatcher: Host not found. Aborting.");
            return;
        }
        
        const roomState = hostRooms.get(model.streamRoomId);
        if (roomState) {
            const deletedJanusId = this.janusRoomIdToStreamRoomIdMap.delete(roomState.janusRoomId);
            const deletedHostRoom = hostRooms.delete(model.streamRoomId);
            this.logger.debug({ deletedJanusId, deletedHostRoom, janusRoomId: roomState.janusRoomId }, "[CACHE] removeRoomWatcher: Cleared from internal maps");
        }
        else {
            this.logger.debug({ streamRoomId: model.streamRoomId }, "[CACHE] removeRoomWatcher: roomState not found. Nothing to delete from maps.");
        }
        
        const deletedPending = this.pendingEmptyRooms.delete(model.streamRoomId);
        this.logger.debug({ deletedPending }, "[CACHE] removeRoomWatcher: Cleared from pendingEmptyRooms");
    }
    
    @ApiMethod({})
    async janusRoomIdToStreamRoomId(params: { janusRoomId: number }): Promise<RoomLookup | undefined> {
        this.logger.debug({ janusRoomId: params.janusRoomId }, "[CACHE] janusRoomIdToStreamRoomId invoked");
        
        const coercedId = Number(params.janusRoomId);
        const result = this.janusRoomIdToStreamRoomIdMap.get(coercedId);
        
        if (!result) {
            this.logger.debug({
                coercedId,
            }, "[CACHE] janusRoomIdToStreamRoomId: Lookup failed. Mapping not found.");
        }
        else {
            this.logger.debug({ result }, "[CACHE] janusRoomIdToStreamRoomId: Lookup successful.");
        }
        
        return result;
    }
}