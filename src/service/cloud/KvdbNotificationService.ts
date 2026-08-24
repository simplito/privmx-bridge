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
import { KvdbConverter } from "../../api/main/kvdb/KvdbConverter";
import * as kvdbApi from "../../api/main/kvdb/KvdbApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import * as managementKvdbApi from "../../api/plain/kvdb/ManagementKvdbApiTypes";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { ManagementKvdbConverter } from "../../api/plain/kvdb/ManagementKvdbConverter";
import { WebSocketPlainSender } from "../ws/WebSocketPlainSender";
import { DateUtils } from "../../utils/DateUtils";
import { TargetChannel } from "../ws/WebSocketConnectionManager";
import { UserIdentityWithStatus } from "../../types/cloud";
import { Utils } from "../../utils/Utils";

/**
 * Every payload here is converted **once per recipient**, so each one carries a `KvdbInfo.groupKeys`
 * narrowed to that recipient's own groups — the same guarantee `kvdbGet` gives.
 *
 * It costs nothing extra. Expanding group grantees into a recipient list already reads the whole group
 * documents, so `getMemberGroupsMap` hands back each recipient's grants out of that one query instead of
 * discarding them. Serving an unnarrowed list here would be the anomaly: a client would have no way to tell a
 * payload it may trust from one it may not.
 */
export class KvdbNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private webSocketPlainSender: WebSocketPlainSender,
        private kvdbConverter: KvdbConverter,
        private repositoryFactory: RepositoryFactory,
        private managementKvdbConverter: ManagementKvdbConverter,
    ) {
    }
    
    private safe(errorEntry: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorEntry);
    }
    
    /**
     * Kvdb users plus the expanded members of any granted groups (Phase 2 grantee notifications), along
     * with each recipient's own grants on this kvdb — both from the single group lookup the expansion
     * already does, so a per-recipient payload can be narrowed for free. Recipients in no granted group
     * map to `[]`.
     */
    private async getKvdbRecipients(kvdb: db.kvdb.Kvdb): Promise<{userIds: types.cloud.UserId[], groupsByUser: Map<types.cloud.UserId, types.group.GroupId[]>}> {
        const groupIds = (kvdb.groups || []).map(g => g.groupId);
        const groupsByUser = await this.repositoryFactory.createGroupRepository().getMemberGroupsMap(groupIds);
        return {
            userIds: Utils.unique([...kvdb.users, ...groupsByUser.keys()]),
            groupsByUser: groupsByUser,
        };
    }
    
    sendKvdbCustomEvent(kvdb: db.kvdb.Kvdb, keyId: types.core.KeyId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users?: types.cloud.UserId[]) {
        this.safe("kvdbCustomEvent", async () => {
            const now = DateUtils.now();
            const contextUsers =  users ? await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, users) : await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, (await this.getKvdbRecipients(kvdb)).userIds);
            this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbCustomEvent>(
                contextUsers.map(u => u.userPubKey),
                {
                    containerId: kvdb.id,
                    contextId: kvdb.contextId,
                    channel: `kvdb/custom/${customChannelName}` as types.core.WsChannelName,
                    containerType: kvdb.type,
                },
                {
                    channel: `kvdb/${kvdb.id}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: kvdb.id,
                        author: author,
                        keyId: keyId,
                        eventData: eventData,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendKvdbCreated(kvdb: db.kvdb.Kvdb, solution: types.cloud.SolutionId) {
        this.safe("kvdbCreated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser} = await this.getKvdbRecipients(kvdb);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, userIds);
            const notification: managementKvdbApi.KvdbCreatedEvent = {
                channel: "kvdb",
                type: "kvdbCreated",
                data: this.managementKvdbConverter.convertKvdb(kvdb),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbCreatedEvent>(
                    [user.userPubKey],
                    {
                        containerId: kvdb.id,
                        contextId: kvdb.contextId,
                        channel: "kvdb/create" as types.core.WsChannelName,
                        containerType: kvdb.type,
                    },
                    {
                        channel: "kvdb",
                        type: "kvdbCreated",
                        data: this.kvdbConverter.convertKvdb(user.userId, kvdb, groupsByUser.get(user.userId) ?? []),
                        timestamp: now,
                    },
                );
            }
        });
    }
    
    sendKvdbUpdated(kvdb: db.kvdb.Kvdb, solution: types.cloud.SolutionId, additionalUsers: UserIdentityWithStatus[]) {
        this.safe("kvdbUpdated", async () => {
            const now = DateUtils.now();
            const {userIds, groupsByUser} = await this.getKvdbRecipients(kvdb);
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, userIds);
            const notification: managementKvdbApi.KvdbUpdatedEvent = {
                channel: "kvdb",
                type: "kvdbUpdated",
                data: this.managementKvdbConverter.convertKvdb(kvdb),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            const targetChannel: TargetChannel = {
                containerId: kvdb.id,
                contextId: kvdb.contextId,
                channel: "kvdb/update" as types.core.WsChannelName,
                containerType: kvdb.type,
            };
            for (const user of contextUsers) {
                this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbUpdatedEvent>(
                    [user.userPubKey],
                    targetChannel,
                    {
                        channel: "kvdb",
                        type: "kvdbUpdated",
                        data: this.kvdbConverter.convertKvdb(user.userId, kvdb, groupsByUser.get(user.userId) ?? []),
                        timestamp: now,
                    },
                );
            }
            for (const user of additionalUsers) {
                const userNotification: kvdbApi.KvdbUpdatedEvent = {
                    channel: "kvdb",
                    type: "kvdbUpdated",
                    // These are the users this update removed, so they hold no grant on the kvdb any
                    // more and `groupsByUser` (built from its current grants) has nothing for them. `[]`
                    // is the answer.
                    data: this.kvdbConverter.convertKvdb(user.id, kvdb, groupsByUser.get(user.id) ?? []),
                    timestamp: now,
                };
                if (user.status === "inactive") {
                    await this.repositoryFactory.createNotificationRepository().insert(user.pub, targetChannel, userNotification);
                }
                else {
                    this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbUpdatedEvent>(
                        [user.pub],
                        targetChannel,
                        userNotification,
                    );
                }
            }
        });
    }
    
    sendKvdbDeleted(kvdb: db.kvdb.Kvdb, solution: types.cloud.SolutionId) {
        this.safe("kvdbDeleted", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, (await this.getKvdbRecipients(kvdb)).userIds);
            const notification: managementKvdbApi.KvdbDeletedEvent = {
                channel: "kvdb",
                type: "kvdbDeleted",
                data: {
                    kvdbId: kvdb.id,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbDeletedEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    containerId: kvdb.id,
                    contextId: kvdb.contextId,
                    channel: "kvdb/delete" as types.core.WsChannelName,
                    containerType: kvdb.type,
                },
                {
                    channel: "kvdb",
                    type: "kvdbDeleted",
                    data: {
                        kvdbId: kvdb.id,
                        type: kvdb.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendKvdbStats(kvdb: db.kvdb.Kvdb, solution: types.cloud.SolutionId) {
        this.safe("kvdbStats", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, (await this.getKvdbRecipients(kvdb)).userIds);
            const notification: managementKvdbApi.KvdbStatsEvent = {
                channel: "kvdb",
                type: "kvdbStats",
                data: {
                    kvdbId: kvdb.id,
                    lastEntryDate: kvdb.lastEntryDate,
                    entries: kvdb.entries,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbStatsEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: kvdb.contextId,
                    containerId: kvdb.id,
                    channel: "kvdb/stats" as types.core.WsChannelName,
                    containerType: kvdb.type,
                },
                {
                    channel: "kvdb",
                    type: "kvdbStats",
                    data: {
                        kvdbId: kvdb.id,
                        contextId: kvdb.contextId,
                        type: kvdb.type,
                        lastEntryDate: kvdb.lastEntryDate,
                        entries: kvdb.entries,
                    },
                    timestamp: now,
                },
            );
        });
    }
    
    sendNewKvdbEntry(kvdb: db.kvdb.Kvdb, entry: db.kvdb.KvdbEntry, solution: types.cloud.SolutionId) {
        this.safe("newKvdbEntry", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, (await this.getKvdbRecipients(kvdb)).userIds);
            const notification: managementKvdbApi.KvdbNewEntryEvent = {
                channel: "kvdb",
                type: "kvdbNewEntry",
                data: this.managementKvdbConverter.convertKvdbEntry(kvdb, entry),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbNewEntryEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: kvdb.contextId,
                    containerId: kvdb.id,
                    itemId: entry.id,
                    channel: "kvdb/entries/create" as types.core.WsChannelName,
                    containerType: kvdb.type,
                },
                {
                    channel: `kvdb/${kvdb.id}/entries`,
                    type: "kvdbNewEntry",
                    data: {...this.kvdbConverter.convertKvdbEntry(kvdb, entry), containerType: kvdb.type},
                    timestamp: now,
                },
            );
        });
    }
    
    sendUpdatedKvdbEntry(kvdb: db.kvdb.Kvdb, entry: db.kvdb.KvdbEntry, solution: types.cloud.SolutionId) {
        this.safe("newKvdbEntry", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, (await this.getKvdbRecipients(kvdb)).userIds);
            const notification: managementKvdbApi.KvdbUpdatedEntryEvent = {
                channel: "kvdb",
                type: "kvdbUpdatedEntry",
                data: this.managementKvdbConverter.convertKvdbEntry(kvdb, entry),
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbUpdatedEntryEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: kvdb.contextId,
                    containerId: kvdb.id,
                    itemId: entry.id,
                    channel: "kvdb/entries/update" as types.core.WsChannelName,
                    containerType: kvdb.type,
                },
                {
                    channel: `kvdb/${kvdb.id}/entries`,
                    type: "kvdbUpdatedEntry",
                    data: {...this.kvdbConverter.convertKvdbEntry(kvdb, entry), containerType: kvdb.type},
                    timestamp: now,
                },
            );
        });
    }
    
    sendDeletedKvdbEntry(kvdb: db.kvdb.Kvdb, entry: db.kvdb.KvdbEntry, solution: types.cloud.SolutionId) {
        this.safe("kvdbDeletedEntry", async () => {
            const now = DateUtils.now();
            const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(kvdb.contextId, (await this.getKvdbRecipients(kvdb)).userIds);
            const notification: managementKvdbApi.KvdbDeletedEntryEvent = {
                channel: "kvdb",
                type: "kvdbDeletedEntry",
                data: {
                    entryKey: entry.entryKey,
                    kvdbId: kvdb.id,
                },
                timestamp: now,
            };
            this.webSocketPlainSender.sendToPlainUsers(solution, notification);
            this.webSocketSender.sendCloudEventAtChannel<kvdbApi.KvdbDeletedEntryEvent>(
                contextUsers.map(x => x.userPubKey),
                {
                    contextId: kvdb.contextId,
                    containerId: kvdb.id,
                    itemId: entry.id,
                    channel: "kvdb/entries/delete" as types.core.WsChannelName,
                    containerType: kvdb.type,
                },
                {
                    channel: `kvdb/${kvdb.id}/entries`,
                    type: "kvdbDeletedEntry",
                    data: {
                        kvdbEntryKey: entry.entryKey,
                        kvdbId: kvdb.id,
                        containerType: kvdb.type,
                    },
                    timestamp: now,
                },
            );
        });
    }
}
