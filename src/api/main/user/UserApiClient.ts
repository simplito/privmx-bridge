/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as userApi from "./UserApiTypes";
import { BaseApiClient } from "../../BaseApiClient";

export class UserApiClient extends BaseApiClient implements userApi.IUserApi {
    
    ping(): Promise<"pong"> {
        return this.request("ping", {});
    }
    
    subscribeToChannels(model: userApi.SubscribeToChannelsModel): Promise<userApi.SubscribeToChannelsResult> {
        return this.request("subscribeToChannels", model);
    }
    
    unsubscribeFromChannels(model: userApi.UnsubscribeFromChannelsModel): Promise<types.core.OK> {
        return this.request("unsubscribeFromChannels", model);
    }
    
    authorizeWebSocket(model: { key: types.core.Base64; addWsChannelId: boolean; }): Promise<{ wsChannelId: types.core.WsChannelId; }> {
        return this.request("authorizeWebSocket", model);
    }
    
    unauthorizeWebSocket(): Promise<types.core.OK> {
        return this.request("unauthorizeWebSocket", {});
    }
    
    subscribeToChannel(model: { channel: string; }): Promise<userApi.SubscribeToChannelResult> {
        return this.request("subscribeToChannel", model);
    }
    
    unsubscribeFromChannel(model: { channel: string; }): Promise<types.core.OK> {
        return this.request("unsubscribeFromChannel", model);
    }
    
    logout(): Promise<types.core.OK> {
        return this.request("logout", {});
    }
}
