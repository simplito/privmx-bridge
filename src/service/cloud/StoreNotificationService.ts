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
    
    sendStoreCreated(store: db.store.Store, solution: types.cloud.SolutionId) {
        this.safe("storeCreated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, store.users);
            const notification: managementStoreApi.StoreCreatedEvent = {
                channel: "store",
                type: "storeCreated",
                data: this.managementStoreConverter.convertStore(store)
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreCreatedEvent>([user.userPubKey], {
                    channel: "store",
                    type: "storeCreated",
                    data: this.storeConverter.convertStore(user.userId, store)
                });
            }
        });
    }
    
    sendStoreUpdated(store: db.store.Store, solution: types.cloud.SolutionId) {
        this.safe("storeUpdated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, store.users);
            const notification: managementStoreApi.StoreUpdatedEvent = {
                channel: "store",
                type: "storeUpdated",
                data: this.managementStoreConverter.convertStore(store),
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreUpdatedEvent>([user.userPubKey], {
                    channel: "store",
                    type: "storeUpdated",
                    data: this.storeConverter.convertStore(user.userId, store)
                });
            }
        });
    }
    
    sendStoreDeleted(store: db.store.Store, solution: types.cloud.SolutionId) {
        this.safe("storeDeleted", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, store.users);
            const notification: managementStoreApi.StoreDeletedEvent = {
                channel: "store",
                type: "storeDeleted",
                data: {
                    storeId: store.id,
                },
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreDeletedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: "store",
                type: "storeDeleted",
                data: {
                    storeId: store.id,
                    type: store.type,
                }
            });
        });
    }
    
    sendStoreStatsChanged(store: db.store.Store, solution: types.cloud.SolutionId) {
        this.safe("storeStatsChanged", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, store.users);
            const notification: managementStoreApi.StoreStatsChangedEvent = {
                channel: "store",
                type: "storeStatsChanged",
                data: {
                    id: store.id,
                    contextId: store.contextId,
                    lastFileDate: store.lastFileDate,
                    files: store.files,
                },
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreStatsChangedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: "store",
                type: "storeStatsChanged",
                data: {
                    id: store.id,
                    contextId: store.contextId,
                    type: store.type,
                    lastFileDate: store.lastFileDate,
                    files: store.files,
                }
            });
        });
    }
    
    sendStoreFileCreated(store: db.store.Store, file: db.store.StoreFile, solution: types.cloud.SolutionId) {
        this.safe("storeFileCreated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, store.users);
            const notification: managementStoreApi.StoreFileCreatedEvent = {
                channel: "store",
                type: "storeFileCreated",
                data: this.storeConverter.convertFile(store, file)
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreFileCreatedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `store/${store.id}/files`,
                type: "storeFileCreated",
                data: this.storeConverter.convertFile(store, file)
            });
        });
    }
    
    sendStoreFileUpdated(store: db.store.Store, file: db.store.StoreFile, solution: types.cloud.SolutionId) {
        this.safe("storeFileUpdated", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, store.users);
            const notification: managementStoreApi.StoreFileUpdatedEvent = {
                channel: "store",
                type: "storeFileUpdated",
                data: this.storeConverter.convertFile(store, file)
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreFileUpdatedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `store/${store.id}/files`,
                type: "storeFileUpdated",
                data: this.storeConverter.convertFile(store, file)
            });
        });
    }
    
    sendStoreFileDeleted(store: db.store.Store, file: db.store.StoreFile, solution: types.cloud.SolutionId) {
        this.safe("storeFileDeleted", async () => {
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(store.contextId, store.users);
            const notification: managementStoreApi.StoreFileDeletedEvent = {
                channel: "store",
                type: "storeFileDeleted",
                data: {
                    id: file.id,
                    contextId: store.contextId,
                    storeId: file.storeId,
                },
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<storeApi.StoreFileDeletedEvent>(contextUsers.map(x => x.userPubKey), {
                channel: `store/${store.id}/files`,
                type: "storeFileDeleted",
                data: {
                    id: file.id,
                    contextId: store.contextId,
                    storeId: file.storeId,
                }
            });
        });
    }
}
