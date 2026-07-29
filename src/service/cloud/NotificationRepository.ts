/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as types from "../../types";
import * as db from "../../db/Model";
import { TargetChannel } from "../ws/WebSocketConnectionManager";

export class NotificationRepository {
    
    static readonly COLLECTION_NAME = "notification";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<db.notification.NotificationId, db.notification.Notification>,
    ) {
    }
    
    async insert(userPubKey: types.cloud.UserPubKey, channel: TargetChannel, notification: types.cloud.Event<string, string, unknown>) {
        const dbNotification: db.notification.Notification = {
            id: this.repository.generateId(),
            channel: channel,
            userPubKey: userPubKey,
            event: notification,
        };
        await this.repository.insert(dbNotification);
    }
    
    async getAwaitingUserNotifications(channelScheme: types.cloud.ChannelScheme, userPubKey: types.cloud.UserPubKey) {
        const filter: {
            userPubKey: types.cloud.UserPubKey;
            "channel.channel": {
                $gte: string;
                $lt: string;
            };
            "channel.containerId"?: string;
            "channel.contextId"?: types.context.ContextId;
        } = {
            userPubKey: userPubKey,
            "channel.channel": {
                $gte: channelScheme.path,
                $lt: channelScheme.path + "\uffff",
            },
        };
        
        if (channelScheme.limitedBy === "containerId") {
            filter["channel.containerId"] = channelScheme.objectId;
        }
        else if (channelScheme.limitedBy === "contextId") {
            filter["channel.contextId"] = channelScheme.objectId as types.context.ContextId;
        }
        
        return await this.repository.col<db.notification.Notification>().find(filter).toArray();
    }
    
    async deleteMany(ids: db.notification.NotificationId[]) {
        await this.repository.deleteMany(q => q.in("id", ids));
    }
}
