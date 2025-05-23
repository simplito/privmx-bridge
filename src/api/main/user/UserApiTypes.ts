/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface SubscribeToChannelsModel {
    channels: types.core.WsChannelName[];
}

export interface SubscribeToChannelsResult {
    subscriptions: types.core.Subscription[];
}

export interface SubscribeToChannelResult {
    subscriptionId: types.core.SubscriptionId;
}

export interface UnsubscribeFromChannelsModel {
    subscriptionsIds: types.core.SubscriptionId[];
}

export interface IUserApi {
    /** Public available ping */
    ping(): Promise<"pong">;
    /** Bind current web socket with current session */
    authorizeWebSocket(model: {key: types.core.Base64, addWsChannelId: boolean}): Promise<{wsChannelId: types.core.WsChannelId}>;
    /** Unbind current web socket from current session */
    unauthorizeWebSocket(): Promise<types.core.OK>;
    /** Subscribe to given channel */
    subscribeToChannel(model: {channel: string}): Promise<SubscribeToChannelResult>;
    /** Unsubscribe from given channel */
    unsubscribeFromChannel(model: {channel: string}): Promise<types.core.OK>;
    /** Subscribe to given channels */
    subscribeToChannels(model: SubscribeToChannelsModel): Promise<SubscribeToChannelsResult>;
    /** Unsubscribe from given channels */
    unsubscribeFromChannels(model: UnsubscribeFromChannelsModel): Promise<types.core.OK>;
    /** Destroy current session */
    logout(): Promise<types.core.OK>;
}
