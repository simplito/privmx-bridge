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
import { WebSocketPlainSender } from "../ws/WebSocketPlainSender";
import type { SpaceNotifyEvent } from "../../api/plain/space/ManagementSpaceApiTypes";
import * as contextApi from "../../api/main/context/ContextApiTypes";
import * as db from "../../db/Model";
import * as types from "../../types";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { DateUtils } from "../../utils/DateUtils";

/** Space events say what changed, never how the space now looks: whoever needs the state calls `spaceGet`. */
export class SpaceNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
        private repositoryFactory: RepositoryFactory,
        private webSocketPlainSender: WebSocketPlainSender,
    ) {
    }
    
    /** The same event for the application's backend, on its `space` channel. Nothing is sent once the context is gone. */
    private async sendToBackend(contextId: types.context.ContextId, event: SpaceNotifyEvent) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (context) {
            this.webSocketPlainSender.sendToPlainUsers(context.solution, event);
        }
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    /** Every recipient: the users the space names and the members of the groups it names. */
    private async recipientKeys(space: db.space.Space, alsoUsers: types.cloud.UserId[] = []) {
        const {groupsByUser} = await this.repositoryFactory.createGroupRepository().getGranteeView(space.groups.map(g => g.groupId));
        const userIds = [...new Set([...space.users.map(u => u.userId), ...groupsByUser.keys(), ...alsoUsers])];
        const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(space.contextId, userIds);
        return contextUsers.map(user => user.userPubKey);
    }
    
    private changedData(space: db.space.Space, changeKind: contextApi.SpaceChangeKind): contextApi.SpaceChangedEventData {
        return {
            spaceId: space.id,
            contextId: space.contextId,
            keyVersion: space.keyVersion,
            publicMetaVersion: space.publicMetaVersion,
            privateMetaVersion: space.privateMetaVersion,
            changeKind: changeKind,
        };
    }
    
    sendCreatedSpace(space: db.space.Space) {
        this.safe("spaceCreated", async () => {
            await this.sendToBackend(space.contextId, {channel: "space", type: "spaceCreated", data: this.changedData(space, "created"), timestamp: DateUtils.now()});
            this.webSocketSender.sendCloudEventAtChannel<contextApi.SpaceCreatedEvent>(
                await this.recipientKeys(space),
                {contextId: space.contextId, containerId: space.id, channel: "context/spaces/create" as types.core.WsChannelName},
                {channel: "context", type: "spaceCreated", data: this.changedData(space, "created"), timestamp: DateUtils.now()},
            );
        });
    }
    
    /** @param alsoUsers users who are no longer recipients and are told once more, so their client can let go. */
    sendUpdatedSpace(space: db.space.Space, changeKind: contextApi.SpaceChangeKind, alsoUsers: types.cloud.UserId[] = []) {
        this.safe("spaceUpdated", async () => {
            await this.sendToBackend(space.contextId, {channel: "space", type: "spaceUpdated", data: this.changedData(space, changeKind), timestamp: DateUtils.now()});
            this.webSocketSender.sendCloudEventAtChannel<contextApi.SpaceUpdatedEvent>(
                await this.recipientKeys(space, alsoUsers),
                {contextId: space.contextId, containerId: space.id, channel: "context/spaces/update" as types.core.WsChannelName},
                {channel: "context", type: "spaceUpdated", data: this.changedData(space, changeKind), timestamp: DateUtils.now()},
            );
        });
    }
    
    /** A recipient group moved to a new epoch: every space that names it now holds a stale key. */
    sendKeyStaleOfGroup(groupId: types.group.GroupId) {
        this.safe("spaceKeyStale", async () => {
            for (const space of await this.repositoryFactory.createSpaceRepository().getByGroup(groupId)) {
                this.sendUpdatedSpace(space, "keyStale");
            }
        });
    }
    
    sendDeletedSpace(space: db.space.Space) {
        this.safe("spaceDeleted", async () => {
            await this.sendToBackend(space.contextId, {channel: "space", type: "spaceDeleted", data: {spaceId: space.id, contextId: space.contextId}, timestamp: DateUtils.now()});
            this.webSocketSender.sendCloudEventAtChannel<contextApi.SpaceDeletedEvent>(
                await this.recipientKeys(space),
                {contextId: space.contextId, containerId: space.id, channel: "context/spaces/delete" as types.core.WsChannelName},
                {channel: "context", type: "spaceDeleted", data: {spaceId: space.id, contextId: space.contextId}, timestamp: DateUtils.now()},
            );
        });
    }
}
