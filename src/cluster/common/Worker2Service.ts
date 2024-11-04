/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { PlainApiEvent } from "../../api/plain/Types";
import * as types from "../../types";

export interface IWorker2Service {
    sendWebsocketNotification<T extends types.core.Event<any, any>>(model: {channel: string, host: types.core.Host, clients: types.core.Client[], event: T}): Promise<void>;
    sendWebsocketNotificationToPlainUsers(model: {solution: types.cloud.SolutionId, event: PlainApiEvent}): Promise<void>;
    hasOpenConnectionWithUsername(model: {host: types.core.Host, username: types.core.Username}): Promise<boolean>;
    disconnectWebSocketsBySession(model: {host: types.core.Host, sessionId: types.core.SessionId}): Promise<void>;
    disconnectWebSocketsByUsername(model: {host: types.core.Host, username: types.core.Username}): Promise<void>;
    disconnectWebSocketsBySubidentity(model: {host: types.core.Host, pub: types.core.EccPubKey}): Promise<void>;
    disconnectWebSocketsByDeviceId(model: {host: types.core.Host, deviceId: types.core.DeviceId}): Promise<void>;
    disconnectWebSocketsBySubidentityGroup(model: {host: types.core.Host, groupId: types.user.UsersGroupId}): Promise<void>;
}
