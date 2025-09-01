import { DateUtils } from "../../../utils/DateUtils";
import * as types from "../../../types";
import { TargetChannel } from "../../../service/ws/WebSocketConnectionManager";
import { KvdbCollectionChangedEvent } from "../../../api/main/kvdb/KvdbApiTypes";
import { ThreadCollectionChangedEvent } from "../../../api/main/thread/ThreadApiTypes";
import { StoreCollectionChangedEvent } from "../../../api/main/store/StoreApiTypes";
import { IpcService } from "../Decorators";
import { ApiMethod } from "../../../api/Decorators";
import { ContextUsersStatusChange } from "../../../api/main/context/ContextApiTypes";
import { ActiveUsersMap } from "./ActiveUsers";

type HostDistinguishedKey = `${types.core.Host}/${string}`;

interface UserStatus {
    userPubKey: types.cloud.UserPubKey;
    action: "login"|"logout"
}

interface AggregatedEvent {
    containerId: string;
    contextId: types.context.ContextId;
    containerKind: types.core.ContainerWithItems;
    containerType?: string;
    clients: types.core.Client[]|null;
    host: types.core.Host;
    items: Map<string, types.core.CRUDAction>;
}

interface AggregatedContextUserStatus {
    contextId: types.context.ContextId;
    host: types.core.Host;
    userStatusChanges: Map<types.cloud.UserId, UserStatus>;
}

interface UserIdentityWithContext {
    contextId: types.context.ContextId;
    userId: types.cloud.UserId;
    userPubKey: types.core.EccPubKey
}

@IpcService
export class AggregatedNotificationsService {
    
    private static readonly ChannelPathPart = {
        ContainerType: 0,
        SubPath: 1,
        Action: 2,
    };
    private static EXPECTED_PATH_PARTS = 3;
    private aggregatedCollectionChangeds: Map<HostDistinguishedKey, AggregatedEvent> = new Map();
    private aggregatedcontextUserStatusChangeds: Map<HostDistinguishedKey, AggregatedContextUserStatus> = new Map();
    
    constructor(
        private activeUsersMap: ActiveUsersMap,
    ) {}
    
    @ApiMethod({})
    async aggregateDataForcontextUserStatusChangedNotification(model: {userIdentities: UserIdentityWithContext[], host: types.core.Host, action: "login"|"logout"}) {
        for (const userIdentity of model.userIdentities) {
            const entryKey: HostDistinguishedKey = `${model.host}/${userIdentity.contextId}`;
            const entry = this.aggregatedcontextUserStatusChangeds.get(entryKey);
            if (!entry) {
                this.aggregatedcontextUserStatusChangeds.set(entryKey, {
                    contextId: userIdentity.contextId,
                    host: model.host,
                    userStatusChanges: new Map([[userIdentity.userId, {userPubKey: userIdentity.userPubKey, action: model.action}]]),
                });
            }
            else {
                entry.userStatusChanges.set(userIdentity.userId, {userPubKey: userIdentity.userPubKey, action: model.action});
            }
        }
    }
    
    aggregateDataForCollectionChangedNotification(channel: TargetChannel, clients: types.core.Client[]|null, host: types.core.Host) {
        if (!channel.containerId || !channel.itemId) {
            return;
        }
        const entryKey: HostDistinguishedKey = `${host}/${channel.containerId}`;
        const entry = this.aggregatedCollectionChangeds.get(entryKey);
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
            this.aggregatedCollectionChangeds.set(entryKey, entryValue);
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
    
    async flush(sink: <T = unknown>(model: {channel: TargetChannel, host: types.core.Host, clients: types.core.Client[]|null, event: T}) => Promise<void>) {
        const now = DateUtils.now();
        for (const value of this.aggregatedCollectionChangeds.values()) {
            const eventData = this.assembleCollectionChangedNotification(value, now);
            if (!eventData) {
                continue;
            }
            void sink({
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
        this.aggregatedCollectionChangeds.clear();
        for (const value of this.aggregatedcontextUserStatusChangeds.values()) {
            void sink({
                channel: {
                    channel: "context/userStatus" as types.core.WsChannelName,
                    contextId: value.contextId,
                },
                clients: await this.activeUsersMap.getActiveContextUsers({contextId: value.contextId}),
                host: value.host,
                event: this.assembleUserStatusChangeNotification(value, now),
            });
        }
        this.aggregatedcontextUserStatusChangeds.clear();
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
    
    private assembleUserStatusChangeNotification(aggregatedContextUsersStatus: AggregatedContextUserStatus, now: types.core.Timestamp) {
        const event: ContextUsersStatusChange = {
            type: "contextUserStatusChanged",
            channel: "context",
            timestamp: now,
            data: {
                contextId: aggregatedContextUsersStatus.contextId,
                users: this.convertUsersMapToArray(aggregatedContextUsersStatus.userStatusChanges),
            },
        };
        return event;
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
    
    private convertUsersMapToArray(users: Map<types.cloud.UserId, UserStatus>) {
        return Array.from(users.entries()).map(([userId, {userPubKey, action}]) => ({
            userId,
            pubKey: userPubKey,
            action,
        }));
    }
    
    private convertItemsMapToArray<T>(items: Map<string, types.core.CRUDAction>) {
        return Array.from(items.entries()).map(([itemId, status]) => ({
            itemId: itemId as T,
            action: status,
        }));
    };
}