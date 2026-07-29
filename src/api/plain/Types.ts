/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { InboxEvent } from "./inbox/ManagementInboxApiTypes";
import { StoreNotifyEvent } from "./store/ManagementStoreApiTypes";
import { StreamNotifyEvent } from "./stream/ManagementStreamApiTypes";
import { ThreadNotifyEvent } from "./thread/ManagementThreadApiTypes";
import { KvdbNotifyEvent } from "./kvdb/ManagementKvdbApiTypes";

export type PlainApiEvent = InboxEvent|StreamNotifyEvent|ThreadNotifyEvent|StoreNotifyEvent|KvdbNotifyEvent;
