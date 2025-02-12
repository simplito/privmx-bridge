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
import * as contextApi from "../../api/main/context/ContextApiTypes";
import * as types from "../../types";
export class ContextNotificationService {
    
    constructor(
        private jobService: JobService,
        private webSocketSender: WebSocketSender,
    ) {
    }
    
    private safe(errorMessage: string, func: () => Promise<void>) {
        this.jobService.addJob(func, "Error " + errorMessage);
    }
    
    sendContextCustomEvent(contextId: types.context.ContextId, eventData: unknown, author: types.cloud.UserIdentity, customChannelName: types.core.WsChannelName, users: {id: types.cloud.UserId, key: types.core.UserKeyData, pubKey: types.core.EccPubKey}[]) {
        this.safe("contextCustomEvent", async () => {
            for (const user of users) {
                this.webSocketSender.sendCloudEventAtChannel<contextApi.ContextCustomEvent>([user.pubKey], {
                    channel: `context/${contextId}/${customChannelName}`,
                    type: "custom",
                    data: {
                        id: contextId,
                        author: author,
                        key: user.key,
                        eventData: eventData,
                    },
                });
            }
        });
    }
}
