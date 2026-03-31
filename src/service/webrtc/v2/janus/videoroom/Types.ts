/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as WebRtcTypes from "../../WebRtcTypes";

export interface JanusRequest<T> {
    janus: "message";
    plugin: "janus.plugin.videoroom";
    session_id: WebRtcTypes.SessionId;
    handle_id: WebRtcTypes.VideoRoomPluginHandleId;
    body: T;
}

export interface SyncJanusResponse<T> {
    janus: "success";
    transaction: string;
    session_id: WebRtcTypes.SessionId;
    sender: WebRtcTypes.VideoRoomPluginHandleId;
    plugindata: {
        plugin: "janus.plugin.videoroom";
        data: T;
    }
}

export interface AsyncJanusResponse<T> {
    janus: "event";
    transaction: string;
    session_id: WebRtcTypes.SessionId;
    sender: WebRtcTypes.VideoRoomPluginHandleId;
    plugindata: {
        plugin: "janus.plugin.videoroom";
        data: T;
    }
}

export interface Error {
    videoroom: "event";
    error_code: number;
    error: string;
}

// ===================

export type CreateRequest = JanusRequest<{
    request: "create",
}&CreateRoomOptions>;
export interface CreateRoomOptions {
    room?: string;          // <unique numeric ID, optional, chosen by plugin if missing>,
    permanent?: boolean;    // <true|false, whether the room should be saved in the config file, default=false>,
    description?: string;   // "<pretty name of the room, optional>",
    secret?: string;        // "<password required to edit/destroy the room, optional>",
    pin?: string;           // "<password required to join the room, optional>",
    is_private?: boolean;   // <true|false, whether the room should appear in a list request>,
    allowed?: WebRtcTypes.UserToken[];  // [ array of string tokens users can use to join this room, optional],
    publishers?: number;
    require_e2ee?: boolean;
    rec_dir?: string;
    bitrate?: number;
    bitrate_cap?: boolean;
    // TODO - dodac pozostale opcje
}
export type CreateResponse = SyncJanusResponse<{
    videoroom: "created";
    room: WebRtcTypes.VideoRoomId; // <unique numeric ID>
    permanent: boolean; // <true if saved to config file, false if not>
}>;

export type EditRequest = JanusRequest<{
    request: "edit",
}&WebRtcTypes.EditRoomOptions>;
export type EditResponse = SyncJanusResponse<{
    videoroom: "edited";
    room: WebRtcTypes.VideoRoomId; // <unique numeric ID>
}>;

export type DestroyRequest = JanusRequest<{
    request: "destroy",
}&WebRtcTypes.DestroyRoomOptions>;
export type DestroyResponse = SyncJanusResponse<{
    videoroom: "destroyed";
    room: WebRtcTypes.VideoRoomId; // <unique numeric ID>
}>;

export type ExistsRequest = JanusRequest<{
    request: "exists",
}&WebRtcTypes.RoomExistsOptions>;
export type ExistsResponse = SyncJanusResponse<{
    videoroom: "success";
    room: WebRtcTypes.VideoRoomId; // <unique numeric ID>
    exists: boolean; // <true|false>
}>;

export type AllowedRequest = JanusRequest<{
    request: "allowed";
}&(WebRtcTypes.SetRoomRestrictedAccessOptions|WebRtcTypes.SetRoomAccessAllowedOptions)>;
export type AllowedResponse = SyncJanusResponse<{
    videoroom: "success";
    room: WebRtcTypes.VideoRoomId; // <unique numeric ID>
    allowed: string[]; // Updated, complete, list of allowed tokens (only for enable|add|remove)
}>;

export type KickRequest = JanusRequest<{
    request: "kick";
}&WebRtcTypes.RoomKickOptions>;
export type KickResponse = SyncJanusResponse<{
    videoroom: "success";
}>;

export type ModerateRequest = JanusRequest<{
    request: "moderate";
}&WebRtcTypes.RoomModerateOptions>;
export type ModerateResponse = SyncJanusResponse<{
    videoroom: "success";
}>;

export type ListRequest = JanusRequest<{
    request: "list";
}>;
export type ListResponse = SyncJanusResponse<{
    videoroom: "success";
    list: WebRtcTypes.VideoRoom[];
}>;

export type ListParticipantsRequest = JanusRequest<{
    request: "listparticipants";
}&WebRtcTypes.RoomListParticipantsOptions>;
export type ListParticipantsResponse = SyncJanusResponse<{
    videoroom: "success";
    room: WebRtcTypes.VideoRoomId; // <unique numeric ID>
    participants: WebRtcTypes.VideoRoomParticipant[];
}>;

export type EnableRecordingRequest = JanusRequest<{
    request: "enable_recording";
}&WebRtcTypes.EnableRecordingOptions>;

export type EnableRecordingResponse = SyncJanusResponse<{
    videoroom: "success";
    room: WebRtcTypes.VideoRoomId; // <unique numeric ID>
}>;

export type JoinAsPublisherRequest = JanusRequest<{
    request: "join";
    ptype: "publisher";
    room: number; // <unique ID of the room to join>,
    id?: number; // <unique ID to register for the publisher; optional, will be chosen by the plugin if missing>,
    display?: string; // "<display name for the publisher; optional>",
    token?: string; // "<invitation token, in case the room has an ACL; optional>"
}>;

export type JoinAsPublisherResponse = AsyncJanusResponse<JoinedAsPublisherData>;
export interface JoinedAsPublisherData {
    videoroom: "joined";
    room: WebRtcTypes.VideoRoomId; // <room ID>,
    description: string; // <description of the room, if available>,
    id: number; // <unique ID of the participant>,
    private_id: number; // <a different unique ID associated to the participant; meant to be private>,
    publishers: WebRtcTypes.Publisher[];
    attendees: Ateendee[];
}

export interface PublisherStream {
    type: "audio"|"video"|"data"; // "<type of published stream #1 (audio|video|data)">,
    mindex: number; // "<unique mindex of published stream #1>",
    mid: number; // "<unique mid of of published stream #1>",
    disabled: boolean; // <if true, it means this stream is currently inactive/disabled (and so codec, description, etc. will be missing)>,
    codec: string; // "<codec used for published stream #1>",
    description: string; // "<text description of published stream #1, if any>",
    moderated: boolean; // <true if this stream audio has been moderated for this participant>,
    simulcast: boolean; // "<true if published stream #1 uses simulcast>",
    svc: boolean; // "<true if published stream #1 uses SVC (VP9 and AV1 only)>",
    talking: boolean; // <true|false, whether the publisher stream has audio activity or not (only if audio levels are used)>,
}
export interface Ateendee {
    id: number; // <unique ID of attendee #1>,
    display: string; // "<display name of attendee #1, if any>"
}

export type JoinAsSubscriberRequest = JanusRequest<{
    request: "join";
    ptype: "subscriber";
    room: number; // WebRtcTypes.VideoRoomId; // <unique ID of the room to subscribe in>,
    use_msid?: boolean; // <whether subscriptions should include an msid that references the publisher; false by default>
    autoupdate?: boolean; // <whether a new SDP offer is sent automatically when a subscribed publisher leaves; true by default>
    private_id?: string; // <unique ID of the publisher that originated this request; optional, unless mandated by the room configuration>
    streams: WebRtcTypes.RoomJoinStreamOptions[];
    data: boolean;
}>;
export type JoinAsSubscriberResponse = AsyncJanusResponse<JoinedAsSubscriberData>&{jsep: WebRtcTypes.RTCSessionDescriptionOffer};
export interface JoinedAsSubscriberData {
    videoroom: "attached";
    room: WebRtcTypes.VideoRoomId;
    streams: WebRtcTypes.JanusStreamInfo[];
}

export type SubscribeOnExistingRequest = JanusRequest<{
    request: "subscribe";
    streams: WebRtcTypes.RoomJoinStreamOptions[];
}>;

export type UpdateSubscriptionsRequest = JanusRequest<{
    request: "update";
    subscribe: WebRtcTypes.RoomJoinStreamOptions[];
    unsubscribe: WebRtcTypes.RoomJoinStreamOptions[];
}>;

export type SubscribeOnExistingResponse = AsyncJanusResponse<WebRtcTypes.UpdateSubscriptionsData>&{jsep: WebRtcTypes.RTCSessionDescriptionOffer};
export type UpdateSubscriptionsResponse = AsyncJanusResponse<WebRtcTypes.UpdateSubscriptionsData>&{jsep: WebRtcTypes.RTCSessionDescriptionOffer};

export type UnsubscribeOnExistingRequest = JanusRequest<{
    request: "unsubscribe";
    streams: WebRtcTypes.RoomUnsubscribeOptions[];
}>;

export type UnubscribeOnExistingResponse = AsyncJanusResponse<WebRtcTypes.UpdateSubscriptionsData>&{jsep: WebRtcTypes.RTCSessionDescriptionOffer};

export type LeaveRequest = JanusRequest<{request: "leave";}>;
export type LeaveResponse = AsyncJanusResponse<{
    videoroom: "event";
    room: WebRtcTypes.VideoRoomId;
    leaving: "ok";
}>;

export type PublishRequest = JanusRequest<{
    request: "publish";
    // audiocodec?: string; // "<audio codec to prefer among the negotiated ones; optional>",
    // videocodec?: string; // "<video codec to prefer among the negotiated ones; optional>",
    bitrate?: number; // <bitrate cap to return via REMB; optional, overrides the global room value if present>,
    record?: boolean; // <true|false, whether this publisher should be recorded or not; optional>,
    // filename?: string; // "<if recording, the base path/file to use for the recording files; optional>",
    display?: string; // "<display name to use in the room; optional>",
    // audio_level_average?: number; // "<if provided, overrides the room audio_level_average for this user; optional>",
    // audio_active_packets?: any; // "<if provided, overrides the room audio_active_packets for this user; optional>",
    descriptions?: {
        mid: string; // "<unique mid of a stream being published>",
        description: string; // "<text description of the stream (e.g., My front webcam)>"
    }[];
    e2ee?: boolean; // undocumented
    data: boolean; // undocumented
}&WebRtcTypes.RoomPublishOptions>&{jsep: WebRtcTypes.RTCSessionDescriptionOffer};

export type PublishResponse = AsyncJanusResponse<{
    videoroom: "event";
    configured: "ok";
}>&{jsep: WebRtcTypes.RTCSessionDescriptionAnswer};

export type ConfigureRequest = JanusRequest<{
    request: "configure";
}&WebRtcTypes.RoomConfigureOptions>&{jsep: WebRtcTypes.RTCSessionDescriptionOffer};

export type ConfigureResponse = AsyncJanusResponse<{
    videoroom: "event";
    started: "ok";
}>&{jsep: WebRtcTypes.RTCSessionDescriptionAnswer};

export type UnpublishRequest = JanusRequest<{
    request: "unpublish";
}>;
export type UnpublishResponse = AsyncJanusResponse<{
    videoroom: "event";
    unpublished: "ok";
}>;

export type StartRequest = JanusRequest<{
    request: "start";
}>&{jsep: WebRtcTypes.RTCSessionDescriptionAnswer};

export type StartResponse = AsyncJanusResponse<{
    videoroom: "event";
    started: "ok";
}>;

export type TrickleRequest = {
    janus: "trickle";
    plugin: "janus.plugin.videoroom";
    session_id: WebRtcTypes.SessionId;
    handle_id: WebRtcTypes.VideoRoomPluginHandleId;
    body: {candidate: WebRtcTypes.RTCIceCandidate};
};

