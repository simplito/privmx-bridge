/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
export type SessionId = number & {_sessionId: never};
export type VideoRoomParticipantId = number & {_videoRoomParticipantId: never};
export type PluginHandleId = number & {_pluginHandleId: never};
export type VideoRoomPluginHandleId = PluginHandleId & {_videoPluginHandleId: never};
export type PluginId = string & {_pluginId: never};
export type SignalingSenderEventType = "subscriberAttached" | "streamConfigured";
export type VideoRoomId = number & {_videoRoomId: never};
// export type StreamRoomId = VideoRoomId;
export type UserToken = string & {_userToken: never};
export type TransactionId = string & {_transactionId: never};
export type VideoRoomPublisherId = number & {_videoRoomPublisherId: never};
export type StreamTrackId = string & {__streamTrackId: never};
export type StreamId = types.stream.StreamId;
export type StreamRoomId = types.stream.StreamRoomId;
export type JanusRoomStreamsUpdatedData = UpdateSubscriptionsData&{jsep?: RTCSessionDescriptionOffer};

export interface JanusVideoRoomCurrentPublishersRaw {
    room: VideoRoomId;
    publishers: Publisher[];
}

export interface JanusVideoRoomUserLeftEventRaw {
        videoroom: "event";
        room: VideoRoomId;
        leaving: number;
        display?: string;
}
export interface JanusVideoRoomCurrentPublishers {
    room: VideoRoomId;
    publishers: PublisherAsStream[];
}
export interface StreamCreateMeta {
    mid?: string; // "<unique mid of a stream being published>"
    description?: string; // "<text description of the stream (e.g., My front webcam)>"
    p2p?: boolean; // reserved for future use
}

export interface DataChannelMeta {
    name: string;
}

export interface StreamTrackMeta {
    // Track
    track?: any; // from browser types MediaStreamTrack;
    
    // DataChannel
    dataChannel?: DataChannelMeta;
}

export interface StreamAndTracksSelector {
    streamRoomId: StreamRoomId;
    streamId: StreamId;
    streamIds: StreamId[];
    tracks?: StreamTrackId[];
}

export interface ListQuery {
    skip?: number;
    limit?: number;
    order?: string;
}

export interface BaseEvent {
    kind: "media-event" | "event";
    type: SignalingSenderEventType;
}

export interface MediaEvent extends BaseEvent {
    sub?: string|null;
    data?: any;
}

export interface JanusStreamInfo {
    type: "audio" | "video" | "data";
    active: boolean;
    mid: string;
    mindex: number;
    ready: boolean;
    send: boolean;
    source_ids: VideoRoomParticipantId[];
    feed_id: number;
    sources: number;
}

export interface JanusStreamInfoOnUpdate {
    type: "audio" | "video" | "data";
    feed_id: number;
    feed_mid: number;
    feed_display: string;
    mindex: number;
    mid: string;
    send: boolean;
    ready: boolean;
}

export interface JanusStreamConfigureOptions {
    mid: string;
    keyframe?: boolean;
    send?: boolean;
    min_delay?: number;
    max_delay?: number;
}

export interface UpdateSubscriptionsData {
    videoroom : "updated";
    sessionId: SessionId;
    room : VideoRoomId;
    streams: JanusStreamInfoOnUpdate[];
}

export interface JanusVideoRoomSession {
    id: SessionId;
    handle: VideoRoomPluginHandleId;
}

export interface SubscriberAttached {
    session_id: SessionId;
    handle: {id?: PluginHandleId, pluginId?: PluginId};
    room: any;
    streams: JanusStreamInfo[];
    offer: any;
}

export interface StreamConfigured {
    answer: any;
}

export interface AppRequest {
    kind: string;
    clientId?: string;
    data?: any;
}

export interface UserWithPubKey {
    userId: string;
    key: string;
}

export interface MiscGetTurnCredentialsRequest {
    clientId: string;
}

export interface StreamRoomCreateRequest {
    contextId: string;
    users: UserWithPubKey[];
    managers: UserWithPubKey[];
    privateMeta: string;
    publicMeta: string;
}

export interface CreateRoomResult {
    videoroom: "created";
    room: VideoRoomId;
    permanent: boolean;
}

export interface CreateRoomOptions {
    room?: string;          // <unique numeric ID, optional, chosen by plugin if missing>,
    permanent?: boolean;    // <true|false, whether the room should be saved in the config file, default=false>,
    description?: string;   // "<pretty name of the room, optional>",
    secret?: string;        // "<password required to edit/destroy the room, optional>",
    pin?: string;           // "<password required to join the room, optional>",
    is_private?: boolean;   // <true|false, whether the room should appear in a list request>,
    allowed?: UserToken[];  // [ array of string tokens users can use to join this room, optional],
    publishers?: number;
    // TODO - dodac pozostale opcje
}

export type SubscriberEventFunc = (event: any) => void;

export interface Subscriber {
    fn: SubscriberEventFunc;
}

export interface AcceptOfferRequest {
    session_id: SessionId;
    handle: {handle_id: VideoRoomPluginHandleId};
    answer: any;
}

export type MediaServerEvent = JanusResponseEvent | JanusErrorEvent | JanusAckEvent | JanusDetachedEvent | JanusTimeoutEvent | JanusEvent | JanusAsyncResponsee | WebRTCMediaEvent | WebRTCSHangupEvent | WebRTCSlowLinkEvent | WebRTCUpEvent;

export interface JanusResponseEvent {
    janus: "success";
    session_id: SessionId;
    transaction: string;
}

export interface JanusErrorEvent {
    janus: "error";
    session_id: SessionId;
    transaction: string;
    error: {code: number; reason: string;};
}

export interface JanusAckEvent {
    janus: "ack";
    session_id: SessionId;
    transaction: string;
}

export interface JanusDetachedEvent {
    janus: "detached";
    session_id: SessionId;
}

export interface JanusTimeoutEvent {
    janus: "timeout";
    session_id: SessionId;
}

export interface JanusEvent {
    janus: "event";
    session_id: SessionId;
    sender: number;
    plugindata?: JanusVideoRoomPluginData;
    plugin: string;
    jsep?: RTCSessionDescriptionInit;
}
export interface JanusAsyncResponsee extends JanusEvent {
    transaction: string;
}

export interface JanusVideoRoomPluginData {
    plugin: "janus.plugin.videoroom";
    data: JanusVideoRoomPluginInnerData;
}

export type JanusVideoRoomPluginInnerData = JanusVideoRoomPluginJoinedData|JanusVideoRoomPluginAttachedData|JanusVideoRoomPluginEventData;

export interface JanusVideoRoomPluginJoinedData {
    videoroom: "joined";
    room: VideoRoomId;
    description: string;
    id: number;
    private_id: number;
    publishers: NewPublisherEventRaw[];
}

export interface JanusVideoRoomPluginAttachedData {
    videoroom: "attached";
    room: VideoRoomId;
    streams: JanusStreamInfo[];
}

export type JanusVideoRoomPluginEventData = {
    videoroom: "event";
    room: VideoRoomId;
    configured: "ok";
    video_codec: string;
    streams: JanusStreamInfo[];
} | {
    videoroom: "event";
    room: VideoRoomId;
    started: "ok";
} | {
    videoroom: "event";
    room: VideoRoomId;
    leaving: number|"ok";
    display?: string;
} | {
    videoroom: "event";
    error_code: number;
    error: string;
};

export interface WebRTCUpEvent {
    janus: "webrtcup";
    session_id: SessionId;
    sender: string;
}

export interface WebRTCMediaEvent {
    janus: "media";
    session_id: SessionId;
    sender: string;
    type: "audio"|"video";
    receiving: boolean;
}

export interface WebRTCSlowLinkEvent {
    janus: "slowlink";
    session_id: SessionId;
    sender: string;
    uplink: boolean;
    nacks: number;
}

export interface WebRTCSHangupEvent {
    janus: "hangup";
    session_id: SessionId;
    sender: string;
    reason: string;
}

export type RTCSessionDescriptionInit = RTCSessionDescriptionAnswer|RTCSessionDescriptionOffer;

export interface RTCSessionDescriptionAnswer {
    type: "answer";
    sdp: string;
}

export interface RTCSessionDescriptionOffer {
    type: "offer";
    sdp: string;
}

// export interface VideoRoomStreamTrack {
//     type: string;
//     codec: string;
//     mid: string;
//     mindex: number;
// }
// export interface NewPublisherEventRaw {
//     id: VideoRoomPublisherId;
//     video_codec: string;
//     display: string;
//     streams: VideoRoomStreamTrack[];
// }

export interface Publisher {
    /** unique ID of active publisher */
    id: number;
    /** display name of active publisher, if any */
    display?: string;
    /** valid JSON object of metadata, if any */
    metadata?: Record<string, any>;
    /** true if this participant is a dummy publisher */
    dummy?: boolean;
    /** list of published streams */
    streams: Stream[];
    /** whether the publisher is talking or not (deprecated field) */
    talking?: boolean;
}

export interface Stream {
    type: "audio" | "video" | "data";
    /** unique mindex of published stream */
    mindex: number;
    /** unique mid of published stream */
    mid: string;
    /** true if stream is currently inactive/disabled */
    disabled?: boolean;
    /** codec used for this stream */
    codec?: string;
    /** optional description of this stream */
    description?: string;
    /** true if stream has been moderated for this participant */
    moderated?: boolean;
    /** true if this stream uses simulcast */
    simulcast?: boolean;
    /** true if this stream uses SVC (VP9 and AV1 only) */
    svc?: boolean;
    /** whether the publisher stream has audio activity or not */
    talking?: boolean;
}

export type PublisherAsStream = Omit<Publisher, "display" | "streams"> & {userId: string, tracks: Stream[]};

export type StreamTrackModification = { streamId: number, tracks: { before?: Stream, after?: Stream }[] };

// export interface JoinedEvent {
//     room: VideoRoomId;
//     description: string;
//     id: number;
//     private_id: number;
//     publishers: Publisher[];
// }

export interface StreamRoomUpdateRequest {
    streamRoomId: StreamRoomId;
    users: UserWithPubKey[];
    managers: UserWithPubKey[];
    privateMeta: string;
    publicMeta: string;
}

export interface StreamRoomGetRequest {
    streamRoomId: StreamRoomId;
}

export interface StreamRoomListRequest {
    contextId: string;
    query: ListQuery;
}

export interface StreamRoomDeleteRequest {
    streamRoomId: StreamRoomId;
}

export interface StreamCreateRequest {
    streamRoomId: StreamRoomId;
    meta?: StreamCreateMeta;
}

export interface StreamUpdateRequest {
    streamId: StreamId;
    meta: StreamCreateMeta;
}

export interface StreamListRequest {
    streamRoomId: StreamRoomId;
    query: ListQuery;
}

export interface StreamGetRequest {
    streamRoomId: StreamRoomId;
    streamId: StreamId;
}

export interface StreamTrackListRequest {
    streamId: StreamId;
}

export interface StreamTrackSendDataRequest {
    streamTrackId: StreamTrackId;
    data: Buffer;
}

export interface StreamPublishRequest {
    streamRoomId: StreamRoomId;
    streamId: StreamId;
    streamMeta?: StreamCreateMeta;
    peerConnectionOffer: any;
}

export interface StreamUnpublishRequest {
    streamRoomId: StreamRoomId;
    streamId: StreamId;
}

export interface StreamJoinRequest {
    streamRoomId: StreamRoomId;
    streamToJoin: StreamAndTracksSelector;
}

export interface StreamLeaveRequest {
    streamToLeave: StreamAndTracksSelector;
}

export interface VideoRoom {
    room: VideoRoomId;          // <unique numeric ID, optional, chosen by plugin if missing>,  // <true|false, whether the room should be saved in the config file, default=false>,
    description: string;   // "<pretty name of the room, optional>",
    pin_required: boolean; // <true|false, whether a PIN is required to join this room>,
    is_private: boolean; // <true|false, whether this room is 'private' (as in hidden) or not>,
    max_publishers: number; // <how many publishers can actually publish via WebRTC at the same time>,
    bitrate: number; // <bitrate cap that should be forced (via REMB) on all publishers by default>,
    bitrate_cap: number; // <true|false, whether the above cap should act as a limit to dynamic bitrate changes by publishers (optional)>,
    fir_freq: number; // <how often a keyframe request is sent via PLI/FIR to active publishers>,
    require_pvtid: boolean; // <true|false, whether subscriptions in this room require a private_id>,
    require_e2ee: boolean; // <true|false, whether end-to-end encrypted publishers are required>,
    dummy_publisher: boolean; // <true|false, whether a dummy publisher exists for placeholder subscriptions>,
    notify_joining: boolean; // <true|false, whether an event is sent to notify all participants if a new participant joins the room>,
    audiocodec: string; // "<comma separated list of allowed audio codecs>",
    videocodec: string; // "<comma separated list of allowed video codecs>",
    opus_fec: boolean; // <true|false, whether inband FEC must be negotiated (note: only available for Opus) (optional)>,
    opus_dtx: boolean; // <true|false, whether DTX must be negotiated (note: only available for Opus) (optional)>,
    record: boolean; // <true|false, whether the room is being recorded>,
    rec_dir: string; // "<if recording, the path where the .mjr files are being saved>",
    lock_record: boolean; // <true|false, whether the room recording state can only be changed providing the secret>,
    num_participants: number; // <count of the participants (publishers, active or not; not subscribers)>
    audiolevel_ext: boolean; // <true|false, whether the ssrc-audio-level extension must be negotiated or not for new publishers>,
    audiolevel_event: boolean; // <true|false, whether to emit event to other users about audiolevel>,
    audio_active_packets: number; // <amount of packets with audio level for checkup (optional, only if audiolevel_event is true)>,
    audio_level_average: number; // <average audio level (optional, only if audiolevel_event is true)>,
    videoorient_ext: boolean; // <true|false, whether the video-orientation extension must be negotiated or not for new publishers>,
    playoutdelay_ext: boolean; // <true|false, whether the playout-delay extension must be negotiated or not for new publishers>,
    transport_wide_cc_ext: boolean; // <true|false, whether the transport wide cc extension must be negotiated or not for new publishers>
}

export interface RoomListResult {
    list: VideoRoom[];
}

export interface DestroyRoomOptions {
    room: VideoRoomId;
    secret?: string;
    permanent?: boolean; // <true|false, whether the room should be also removed from the config file, default=false>
}

export interface VideoRoomStreamTrack {
    type: string;
    codec: string;
    mid: string;
    mindex: number;
}

export type StreamRoomInfo = VideoRoom;
export type StreamRoomList = RoomListResult;
export type TrackInfo = VideoRoomStreamTrack;

export interface StreamRemoteInfo {
    id: StreamId;
    tracks?: any; // TrackInfo[];
}

// export interface Stream {
//     streamId: StreamId;
//     streamRoomId: StreamRoomId;
// }

export interface StreamTrackList {
    list: TrackInfo[];
}

export interface RoomJoinAsPublisherOptions {
    room: VideoRoomId; // <unique ID of the room to join>,
    id?: VideoRoomParticipantId; // <unique ID to register for the publisher; optional, will be chosen by the plugin if missing>,
    display?: string; // "<display name for the publisher; optional>",
    token?: string; // "<invitation token, in case the room has an ACL; optional>"
}

export interface VideoRoomDescription {
    mid: string; // "<unique mid of a stream being published>"
    description?: string; // "<text description of the stream (e.g., My front webcam)>"
}

export interface RoomPublishOptions {
    videocodec?: string; // "<video codec to prefer among the negotiated ones; optional>",
    bitrate?: number; // <bitrate cap to return via REMB; optional, overrides the global room value if present>,
    record?: boolean; // <true|false, whether this publisher should be recorded or not; optional>,
    filename?: string; // "<if recording, the base path/file to use for the recording files; optional>",
    display?: string; // "<display name to use in the room; optional>",
    audio_level_average?: number; // "<if provided, overrided the room audio_level_average for this user; optional>",
    audio_active_packets?: any; // "<if provided, overrided the room audio_active_packets for this user; optional>",
    descriptions?: VideoRoomDescription[];
    e2ee?: boolean;
    data: boolean;
}

export interface RoomConfigureOptions {
    keyframe?: boolean;
    bitrate?: number; // <bitrate cap to return via REMB; optional, overrides the global room value if present>,
    record?: boolean; // <true|false, whether this publisher should be recorded or not; optional>,
    filename?: string; // "<if recording, the base path/file to use for the recording files; optional>",
    display?: string; // "<display name to use in the room; optional>",
    audio_level_average?: number; // "<if provided, overrided the room audio_level_average for this user; optional>",
    audio_active_packets?: any; // "<if provided, overrided the room audio_active_packets for this user; optional>",
    descriptions?: VideoRoomDescription[];
    streams?: JanusStreamConfigureOptions[];
}

export interface RoomJoinAsSubscriberOptions {
    room: VideoRoomId;
    use_msid?: boolean; // <whether subscriptions should include an msid that references the publisher; false by default>
    autoupdate?: boolean; // <whether a new SDP offer is sent automatically when a subscribed publisher leaves; true by default>
    private_id?: string; // <unique ID of the publisher that originated this request; optional, unless mandated by the room configuration>
    streams: RoomJoinStreamOptions[];
    data: boolean;
}

export interface RoomJoinStreamOptions {
    feed: number; // : <unique ID of publisher owning the stream to subscribe to>,
    mid?: string; // "<unique mid of the publisher stream to subscribe to; optional>"
    crossrefid?: string; // : "<id to map this subscription with entries in streams list; optional>"
}
export interface RoomUnsubscribeOptions {
    feed?: number; // : <unique ID of publisher owning the new stream to unsubscribe from; optional>,
    mid?: string; // "<unique mid of the publisher stream to unsubscribe from; optional>"
    sub_mid?: string; // : "<unique mid of the subscriber stream to unsubscribe; optional>"
}
export interface EditRoomOptions {
    room: VideoRoomId;          // <unique numeric ID, optional, chosen by plugin if missing>,
    new_description?: string;   // "<pretty name of the room, optional>",
    new_rec_dir?: string;
}

export interface EditRoomResult {
    videoroom: "edited";
    room: VideoRoomId;
    permanent: boolean;
}

export interface DestroyRoomResult {
    videoroom: "destroyed";
    room: VideoRoomId;
    permanent: boolean;
}

export interface RoomExistsOptions {
    room: VideoRoomId;
}

export interface RoomExistsResult {
    room: VideoRoomId;
    exists: boolean;
}

export interface SetRoomRestrictedAccessOptions {
    secret?: string;
    action: "enable" | "disable";
    room: VideoRoomId;
}

export interface SetRoomAccessAllowedOptions {
    secret?: string;
    action: "add" | "remove";
    room: VideoRoomId;
    allowed: string[];
}

export interface RoomAccessResult {
    room: VideoRoomId;
    allowed?: string[];
}

export interface RoomKickOptions {
    secret?: string;
    room: VideoRoomId;
    id: VideoRoomParticipantId;
}

export interface RoomModerateOptions {
    secret?: string;
    room: VideoRoomId;
    id: VideoRoomParticipantId;
    mid: string;    // <mid of the m-line to refer to for this moderate request>,
    mute: boolean;  // <true|false, depending on whether the media addressed by the above mid should be muted by the moderator>
}

export interface RoomListParticipantsOptions {
    room: VideoRoomId;
}

export interface EnableRecordingOptions {
    room: VideoRoomId;
    secret?: string;
    record: boolean;
}

export interface RoomListParticipantsResult {
    room: VideoRoomId;
    participants: VideoRoomParticipant[];
}

export interface VideoRoomParticipant {
    id: VideoRoomParticipantId; // <unique numeric ID of the participant>,
    display: string; // "<display name of the participant, if any; optional>",
    publisher: boolean; // "<true|false, whether user is an active publisher in the room>",
    talking: boolean; // <true|false, whether user is talking or not (only if audio levels are used)>
}

export interface NewPublisherEventRaw {
    id: VideoRoomPublisherId;
    streams: Publisher[];
}

export interface NewStreamsEventData {
    room: VideoRoomId;
    streams: PublisherAsStream[];
}

export interface Credentials {
    url: string;
    username: string;
    password: string;
    expirationTime: number;
}

export interface StreamPublishResult {
    answer: RTCSessionDescriptionAnswer;
}

export interface StreamJoinResult {
    session_id: SessionId;
    sender: number;
    offer: RTCSessionDescriptionOffer;
}

type RTCIceCandidateType = "host" | "prflx" | "relay" | "srflx";
type RTCIceComponent = "rtcp" | "rtp";
type RTCIceProtocol = "tcp" | "udp";
type RTCIceTcpCandidateType = "active" | "passive" | "so";

export interface RTCIceCandidate {
    address: string | null;
    candidate: string;
    component: RTCIceComponent | null;
    foundation: string | null;
    port: number | null;
    priority: number | null;
    protocol: RTCIceProtocol | null;
    relatedAddress: string | null;
    relatedPort: number | null;
    sdpMLineIndex: number | null;
    sdpMid: string | null;
    tcpType: RTCIceTcpCandidateType | null;
    type: RTCIceCandidateType | null;
    usernameFragment: string | null;
}

export interface StreamsDiff {
    added: Stream[];
    removed: Stream[];
    changed: { before: Stream; after: Stream }[];
};