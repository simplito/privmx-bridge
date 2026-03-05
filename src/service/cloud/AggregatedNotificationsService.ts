/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ContextUsersStatusChange } from "../../api/main/context/ContextApiTypes";
import { KvdbCollectionChangedEvent } from "../../api/main/kvdb/KvdbApiTypes";
import { StoreCollectionChangedEvent } from "../../api/main/store/StoreApiTypes";
import { ThreadCollectionChangedEvent } from "../../api/main/thread/ThreadApiTypes";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import * as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";
import { TargetChannel } from "../ws/WebSocketConnectionManager";

type HostDistinguishedKey = `${types.core.Host}/${string}`;

interface AggregatedEvent {
    containerId: string;
    contextId: types.context.ContextId;
    containerKind: types.core.ContainerWithItems;
    containerType?: string;
    clients: types.core.Client[]|null;
    host: types.core.Host;
    items: Map<string, types.core.CRUDAction>;
}

interface UserIdentityWithContext {
    contextId: types.context.ContextId;
    userId: types.cloud.UserId;
    userPubKey: types.core.EccPubKey
}

export class AggregatedNotificationsService {
    
    private static readonly ChannelPathPart = {
        ContainerType: 0,
        SubPath: 1,
        Action: 2,
    };
    private static EXPECTED_PATH_PARTS = 3;
    private aggregatedCollectionChanges: Map<HostDistinguishedKey, AggregatedEvent> = new Map();
    private lastEventId: number = 0;
    
    constructor(
        private activeUsersMap: ActiveUsersMap,
    ) {}
    
    async aggregateDataForContextUserStatusChangedNotification(model: {userIdentities: UserIdentityWithContext[], host: types.core.Host, action: "login"|"logout"}) {
        const contextGroups = new Map<types.context.ContextId, {userId: types.cloud.UserId, userPubKey: types.core.EccPubKey, action: "login"|"logout"}[]>();
        
        for (const userIdentity of model.userIdentities) {
            let group = contextGroups.get(userIdentity.contextId);
            if (!group) {
                group = [];
                contextGroups.set(userIdentity.contextId, group);
            }
            group.push({
                userId: userIdentity.userId,
                userPubKey: userIdentity.userPubKey,
                action: model.action,
            });
        }
        
        for (const [contextId, identities] of contextGroups) {
            await this.activeUsersMap.registerContextUserStatusChange({
                host: model.host,
                contextId: contextId,
                userIdentities: identities,
            });
        }
    }
    
    async aggregateDataForCollectionChangedNotification(channel: TargetChannel, clients: types.core.Client[]|null, host: types.core.Host) {
        if (!channel.containerId || !channel.itemId) {
            return;
        }
        const entryKey: HostDistinguishedKey = `${host}/${channel.containerId}`;
        const entry = this.aggregatedCollectionChanges.get(entryKey);
        const {action, containerKind} = this.getChannelTypeAndAction(channel.channel);
        if (!action || !containerKind) {
            return;
        }
        if (!entry) {
            const entryValue: AggregatedEvent = {
                containerId: channel.containerId,
                contextId: channel.contextId,
                containerKind: containerKind,
                host: host,
                clients: clients,
                containerType: channel.containerType,
                items: new Map([[channel.itemId, action]]),
            };
            this.aggregatedCollectionChanges.set(entryKey, entryValue);
            return;
        }
        const itemEntry = entry.items.get(channel.itemId);
        if (!itemEntry || itemEntry === "update") {
            entry.items.set(channel.itemId, action);
        }
        else if (itemEntry === "create" && action === "delete") {
            entry.items.delete(channel.itemId);
        }
        entry.clients = clients;
    }
    
    async flush(sink: <T = unknown>(model: {channel: TargetChannel, host: types.core.Host, clients: types.core.Client[]|null, event: T}) => void) {
        const now = DateUtils.now();
        for (const value of this.aggregatedCollectionChanges.values()) {
            const eventData = this.assembleCollectionChangedNotification(value, now);
            if (!eventData) {
                continue;
            }
            sink({
                channel: {
                    channel: `${value.containerKind}/collectionChanged` as types.core.WsChannelName,
                    contextId: value.contextId,
                    containerId: value.containerId,
                    containerType: value.containerType,
                },
                clients: value.clients,
                host: value.host,
                event: eventData,
            });
        }
        this.aggregatedCollectionChanges.clear();
        
        const result = await this.activeUsersMap.fetchContextUserStatusChanges({lastEventId: this.lastEventId});
        this.lastEventId = result.lastEventId;
        
        for (const value of result.events) {
            const event: ContextUsersStatusChange = {
                type: "contextUserStatusChanged",
                channel: "context",
                timestamp: now,
                data: {
                    contextId: value.contextId,
                    users: value.changes.map(x => ({userId: x.userId, pubKey: x.userPubKey, action: x.action})),
                },
            };
            
            sink({
                channel: {
                    channel: "context/userStatus" as types.core.WsChannelName,
                    contextId: value.contextId,
                },
                clients: await this.activeUsersMap.getActiveContextUsers({contextId: value.contextId}),
                host: value.host,
                event: event,
            });
        }
    }
    
    private getChannelTypeAndAction(channelPath: string) {
        const parts = channelPath.split("/");
        if (parts.length !== AggregatedNotificationsService.EXPECTED_PATH_PARTS) {
            return { containerKind: null, action: null };
        }
        const containerKind = parts[AggregatedNotificationsService.ChannelPathPart.ContainerType] as types.core.ContainerWithItems;
        const action = parts[AggregatedNotificationsService.ChannelPathPart.Action] as types.core.CRUDAction;
        return { containerKind, action };
    }
    
    private assembleCollectionChangedNotification(aggregatedEventInfo: AggregatedEvent, now: types.core.Timestamp) {
        switch (aggregatedEventInfo.containerKind) {
            case "kvdb": {
                const items = this.convertItemsMapToArray<types.kvdb.KvdbEntryId>(aggregatedEventInfo.items);
                const event: KvdbCollectionChangedEvent = {
                    type: "kvdbCollectionChanged",
                    channel: "kvdb/collectionChanged",
                    timestamp: now,
                    data: {
                        containerId: aggregatedEventInfo.containerId as types.kvdb.KvdbId,
                        affectedItemsCount: items.length,
                        containerType: aggregatedEventInfo.containerType as types.kvdb.KvdbType,
                        items: items,
                    },
                };
                return event;
            }
            case "thread": {
                const items = this.convertItemsMapToArray<types.thread.ThreadMessageId>(aggregatedEventInfo.items);
                const event: ThreadCollectionChangedEvent = {
                    type: "threadCollectionChanged",
                    channel: "thread/collectionChanged",
                    timestamp: now,
                    data: {
                        containerId: aggregatedEventInfo.containerId as types.thread.ThreadId,
                        affectedItemsCount: items.length,
                        containerType: aggregatedEventInfo.containerType as types.thread.ThreadType,
                        items: items,
                    },
                };
                return event;
            }
            case "store": {
                const items = this.convertItemsMapToArray<types.store.StoreFileId>(aggregatedEventInfo.items);
                const event: StoreCollectionChangedEvent = {
                    type: "storeCollectionChanged",
                    channel: "store/collectionChanged",
                    timestamp: now,
                    data: {
                        containerId: aggregatedEventInfo.containerId as types.store.StoreId,
                        affectedItemsCount: items.length,
                        containerType: aggregatedEventInfo.containerType as types.store.StoreType,
                        items: items,
                    },
                };
                return event;
            }
            default:
                return null;
        }
    }
    
    private convertItemsMapToArray<T>(items: Map<string, types.core.CRUDAction>) {
        return Array.from(items.entries()).map(([itemId, status]) => ({
            itemId: itemId as T,
            action: status,
        }));
    };
}