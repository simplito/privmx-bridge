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

export interface RoomLookup {
    streamRoomId: StreamRoomId;
    host: string;
}

interface RoomState {
    janusRoomId: number;
    publishers: Map<number, JanusRoomWatch>;
}

@IpcService
export class JanusRoomsWatcherCache {
    
    // Map keys are strictly primitive strings to survive IPC serialization
    private hostsMap: Map<string, Map<string, RoomState>> = new Map();
    private janusRoomIdToStreamRoomIdMap: Map<number, RoomLookup> = new Map();
    private pendingEmptyRooms: Map<string, string> = new Map();
    
    constructor(
        private logger: Logger,
    ) {
        this.logger.debug({}, "[CACHE] JanusRoomsWatcherCache initialized.");
    }
    
    @ApiMethod({})
    async extractPendingEmptyRooms(params: { limit: number }): Promise<{ streamRoomId: StreamRoomId, host: string }[]> {
        const limit = params.limit;
        this.logger.debug({ limit, currentPendingSize: this.pendingEmptyRooms.size }, "[CACHE] extractPendingEmptyRooms invoked");
        
        const result: { streamRoomId: StreamRoomId, host: string }[] = [];
        for (const [streamRoomIdStr, hostStr] of this.pendingEmptyRooms.entries()) {
            result.push({ streamRoomId: streamRoomIdStr as StreamRoomId, host: hostStr });
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
    async addPublisher(model: JanusRoomWatch) {
        this.logger.debug({ model }, "[CACHE] addPublisher invoked");
        
        const janusRoomId = Number(model.janusRoomId);
        const publisherId = Number(model.publisherId);
        
        let hostRooms = this.hostsMap.get(model.host);
        if (!hostRooms) {
            this.logger.debug({ host: model.host }, "[CACHE] addPublisher: Host not found, creating new Map for host");
            hostRooms = new Map();
            this.hostsMap.set(model.host, hostRooms);
        }
        
        let roomState = hostRooms.get(model.streamRoomId);
        if (!roomState) {
            this.logger.debug({ streamRoomId: model.streamRoomId }, "[CACHE] addPublisher: streamRoomId not found, creating new RoomState");
            roomState = {
                janusRoomId: janusRoomId,
                publishers: new Map<number, JanusRoomWatch>(),
            };
            hostRooms.set(model.streamRoomId, roomState);
            this.janusRoomIdToStreamRoomIdMap.set(janusRoomId, { host: model.host, streamRoomId: model.streamRoomId });
        }
        
        roomState.publishers.set(publisherId, model);
        const wasRemovedFromPending = this.pendingEmptyRooms.delete(model.streamRoomId);
        
        this.logger.debug({
            streamRoomId: model.streamRoomId,
            publisherIdAdded: publisherId,
            currentPublishersCount: roomState.publishers.size,
            wasRemovedFromPending: wasRemovedFromPending,
        }, "[CACHE] addPublisher completed successfully");
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
            this.logger.debug({
                streamRoomId: model.streamRoomId,
                targetPublisherId: publisherId,
            }, "[CACHE] removePublisher: Attempting to delete publisher from roomState");
            
            const wasDeleted = roomState.publishers.delete(publisherId);
            
            this.logger.debug({
                wasDeleted,
                remainingPublishers: roomState.publishers.size,
            }, "[CACHE] removePublisher: Deletion step completed");
            
            if (roomState.publishers.size === 0) {
                this.logger.debug({ streamRoomId: model.streamRoomId }, "[CACHE] removePublisher: Room is now EMPTY. Adding to pendingEmptyRooms and returning TRUE.");
                this.pendingEmptyRooms.set(model.streamRoomId, model.host);
                return true;
            }
        }
        else {
            this.logger.debug({ streamRoomId: model.streamRoomId }, "[CACHE] removePublisher: streamRoomId not found in hostRooms. Returning FALSE.");
        }
        
        this.logger.debug({}, "[CACHE] removePublisher: Room still has publishers. Returning FALSE.");
        return false;
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