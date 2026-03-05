/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as WebRtcTypes from "../WebRtcTypes";

export interface SyncResponse<T> {
    janus: "success";
    transaction: string;
    session_id: WebRtcTypes.SessionId;
    data: T;
}

export interface AckResponse {
    janus: "ack";
    transaction: string;
    session_id: WebRtcTypes.SessionId;
}

export interface AsyncResponse {
    janus: "event";
    transaction: string;
    session_id: WebRtcTypes.SessionId;
}

// ===================

export interface CreateRequest {
    janus: "create";
}
export type CreateResponse = SyncResponse<{id: WebRtcTypes.SessionId;}>;

export interface DestroyRequest {
    janus: "destroy";
    session_id: WebRtcTypes.SessionId;
}
export type DestroyResponse = SyncResponse<undefined>;

export interface KeepAliveRequest {
    janus: "keepalive";
    session_id: WebRtcTypes.SessionId;
}
export type KeepAliveResponse = AckResponse;

export interface AttachRequest {
    janus: "attach";
    session_id: WebRtcTypes.SessionId;
    plugin: string;
}
export type AttachResponse = SyncResponse<{id: WebRtcTypes.PluginHandleId}>;

export interface DetachRequest {
    janus: "detach";
    session_id: WebRtcTypes.SessionId;
    handle_id: WebRtcTypes.PluginHandleId;
}
export type DetachResponse = SyncResponse<undefined>;