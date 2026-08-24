/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { JobService } from "../job/JobService";
import { WebSocketSender } from "../ws/WebSocketSender";
import { StoreConverter } from "../../api/main/store/StoreConverter";
import * as storeApi from "../../api/main/store/StoreApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import * as managementStoreApi from "../../api/plain/store/ManagementStoreApiTypes";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { ManagementStoreConverter } from "../../api/plain/store/ManagementStoreConverter";
import { WebSocketPlainSender } from "../ws/WebSocketPlainSender";
import { DateUtils } from "../../utils/DateUtils";
import { TargetChannel } from "../ws/WebSocketConnectionManager";
import { Utils } from "../../utils/Utils";

/**
 * Every payload here is converted **once per recipient**, so each one carries a `Store.groupKeys`
 * narrowed to that recipient's own groups — the same guarantee `storeGet` gives.
 *
 * It costs nothing extra. Expanding group grantees into a recipient list already reads the whole group
 * documents, so `getMemberGroupsMap` hands back each recipient's grants out of that one query instead of
 * discarding them. Serving an unnarrowed list here would be the anomaly: a client would have no way to tell a
 * payload it may trust from one it may not.
 */
export class StoreNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private webSocketPlainSender: WebSocketPlainSender,
        private storeConverter: StoreConverter,
        private repositoryFactory: RepositoryFactory,
        private managementStoreConverter: ManagementStoreConverter,
    ) {
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    /**
     * Direct members plus the expanded members of any granted groups (Phase 2 grantee notifications), along
     * with each recipient's own grants on this store — both from the single group lookup the expansion
     * already does, so a per-recipient payload can be narrowed for free. Recipients in no granted group
     * map to `[]`.
     */
    private async getStoreRecipients(store: db.store.Store): Promise<{userIds: types.cloud.UserId[], groupsByUser: Map<types.cloud.UserId, types.group.GroupId[]>}> {
        const groupIds = (store.groups || []).map(g => g.groupId);
        const groupsByUser = await this.repositoryFactory.createGroupRepository().getMemberGroupsMap(groupIds);
        return {
            userIds: Utils.unique([...store.users, ...store.managers, ...groupsByUser.keys()]),
            groupsByUser: groupsByUser,
        };
    }
    
    sendStoreCustomEvent(store: db.store.Store, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("storeCustomEvent", async () => {
            const now = DateUtils.now();
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, (await this.getStoreRecipients(store)).userIds);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreCustomEvent>(
                contextUsers.map(u => u.userPubKey),
                {
                    containerId: store.id,
                    contextId: store.contextId,
                    channel: `store/custom/${customChannelName}` as types.core.WsChannelName,
                    containerType: store.type,
                },
                {
                    channel: `store/${store.id}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: store.id,
                        author: author,
                        keyId: keyId,
                        eventData: eventData,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendStoreCreated(store: db.store.Store, solution: types.cloud.SolutionId) {
        this.safe("storeCreated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser} = await this.getStoreRecipients(store);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, userIds);
            const notification: managementStoreApi.StoreCreatedEvent = {
                channel: "store",
                type: "storeCreated",
                data: this.managementStoreConverter.convertStore(store),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreCreatedEvent>(
                    [user.userPubKey],
                    {
                        containerId: store.id,
                        contextId: store.contextId,
                        channel: "store/create" as types.core.WsChannelName,
                        containerType: store.type,
                    },
                    {
                        channel: "store",
                        type: "storeCreated",
                        data: this.storeConverter.convertStore(user.userId, store, groupsByUser.get(user.userId) ?? []),
                        timestamp: now,
                    },
                );
            }
        });
    }
    
    sendStoreUpdated(store: db.store.Store, solution: types.cloud.SolutionId, additionalUsers: types.cloud.UserIdentityWithStatus[]) {
        this.safe("storeUpdated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser} = await this.getStoreRecipients(store);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, userIds);
            const notification: managementStoreApi.StoreUpdatedEvent = {
                channel: "store",
                type: "storeUpdated",
                data: this.managementStoreConverter.convertStore(store),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            const targetChannel: TargetChannel = {
                containerId: store.id,
                contextId: store.contextId,
                channel: "store/update" as types.core.WsChannelName,
                containerType: store.type,
            };
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreUpdatedEvent>(
                    [user.userPubKey],
                    targetChannel,
                    {
                        channel: "store",
                        type: "storeUpdated",
                        data: this.storeConverter.convertStore(user.userId, store, groupsByUser.get(user.userId) ?? []),
                        timestamp: now,
                    },
                );
            }
            for (const user of additionalUsers) {
                const userNotification: storeApi.StoreUpdatedEvent = {
                    channel: "store",
                    type: "storeUpdated",
                    // These are the users this update removed, so they hold no grant on the store any
                    // more and `groupsByUser` (built from its current grants) has nothing for them. `[]`
                    // is the answer.
                    data: this.storeConverter.convertStore(user.id, store, groupsByUser.get(user.id) ?? []),
                    timestamp: now,
                };
                if (user.status === "inactive") {
                    await this.repositoryFactory.createNotificationRepository().insert(user.pub, targetChannel, userNotification);
                }
                else {
                    this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreUpdatedEvent>(
                        [user.pub],
                        targetChannel,
                        userNotification,
                    );
                }
            }
        });
    }
    
    sendStoreDeleted(store: db.store.Store, solution: types.cloud.SolutionId) {
        this.safe("storeDeleted", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, (await this.getStoreRecipients(store)).userIds);
            const notification: managementStoreApi.StoreDeletedEvent = {
                channel: "store",
                type: "storeDeleted",
                data: {
                    storeId: store.id,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreDeletedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: store.id,
                    contextId: store.contextId,
                    channel: "store/delete" as types.core.WsChannelName,
                    containerType: store.type,
                },
                {
                    channel: "store",
                    type: "storeDeleted",
                    data: {
                        storeId: store.id,
                        type: store.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendStoreStatsChanged(store: db.store.Store, solution: types.cloud.SolutionId) {
        this.safe("storeStatsChanged", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, (await this.getStoreRecipients(store)).userIds);
            const notification: managementStoreApi.StoreStatsChangedEvent = {
                channel: "store",
                type: "storeStatsChanged",
                data: {
                    id: store.id,
                    contextId: store.contextId,
                    lastFileDate: store.lastFileDate,
                    files: store.files,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreStatsChangedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: store.id,
                    contextId: store.contextId,
                    channel: "store/stats" as types.core.WsChannelName,
                    containerType: store.type,
                },
                {
                    channel: "store",
                    type: "storeStatsChanged",
                    data: {
                        id: store.id,
                        contextId: store.contextId,
                        type: store.type,
                        lastFileDate: store.lastFileDate,
                        files: store.files,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendStoreFileCreated(store: db.store.Store, file: db.store.StoreFile, solution: types.cloud.SolutionId) {
        this.safe("storeFileCreated", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, (await this.getStoreRecipients(store)).userIds);
            const notification: managementStoreApi.StoreFileCreatedEvent = {
                channel: "store",
                type: "storeFileCreated",
                data: this.managementStoreConverter.convertStoreFile(store, file),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreFileCreatedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: store.id,
                    contextId: store.contextId,
                    itemId: file.id,
                    channel: "store/files/create" as types.core.WsChannelName,
                    containerType: store.type,
                },
                {
                    channel: `store/${store.id}/files`,
                    type: "storeFileCreated",
                    data: {...this.storeConverter.convertFile(store, file), containerType: store.type},
                    timestamp: now,
                },
            );
        });
    }
    
    sendStoreFileUpdated(store: db.store.Store, file: db.store.StoreFile, solution: types.cloud.SolutionId, operations: types.store.StoreFileRandomWriteOperation[]|null) {
        this.safe("storeFileUpdated", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, (await this.getStoreRecipients(store)).userIds);
            const notification: managementStoreApi.StoreFileUpdatedEvent = {
                channel: "store",
                type: "storeFileUpdated",
                data: this.managementStoreConverter.convertStoreFile(store, file),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreFileUpdatedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: store.id,
                    contextId: store.contextId,
                    itemId: file.id,
                    channel: "store/files/update" as types.core.WsChannelName,
                    containerType: store.type,
                },
                {
                    channel: `store/${store.id}/files`,
                    type: "storeFileUpdated",
                    data: {
                        ...this.storeConverter.convertFile(store, file),
                        containerType: store.type,
                        changes: operations ? operations.map(o => {
                            return {
                                type: o.type,
                                pos: o.pos,
                                length: o.data.length,
                                truncate: o.truncate,
                            };
                        }) : undefined,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendStoreFileDeleted(store: db.store.Store, file: db.store.StoreFile, solution: types.cloud.SolutionId) {
        this.safe("storeFileDeleted", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, (await this.getStoreRecipients(store)).userIds);
            const notification: managementStoreApi.StoreFileDeletedEvent = {
                channel: "store",
                type: "storeFileDeleted",
                data: {
                    id: file.id,
                    contextId: store.contextId,
                    storeId: file.storeId,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreFileDeletedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: store.id,
                    contextId: store.contextId,
                    itemId: file.id,
                    channel: "store/files/delete" as types.core.WsChannelName,
                    containerType: store.type,
                },
                {
                    channel: `store/${store.id}/files`,
                    type: "storeFileDeleted",
                    data: {
                        id: file.id,
                        contextId: store.contextId,
                        storeId: file.storeId,
                        containerType: store.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
}
