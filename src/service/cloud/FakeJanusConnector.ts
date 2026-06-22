/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import * as WebSocket from "ws";
import { EventEmitter } from "events";
import { JanusConnection } from "../../CommonTypes";
import { Config } from "../../cluster/common/ConfigUtils";
import { LoggerFactory } from "../log/LoggerFactory";
import { Logger } from "../log/Logger";
import { JanusApi } from "../webrtc/v2/janus/JanusApi";
import { JanusRequester } from "../webrtc/v2/janus/JanusRequester";
import { JanusVideoRoomPluginApi } from "../webrtc/v2/janus/videoroom/JanusVideoRoomPluginApi";
import { JanusConnector } from "./JanusConnector";

const FAKE_OFFER = { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=fake\r\n" };
const FAKE_ANSWER = { type: "answer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=fake\r\n" };
const FAKE_TRACKS = [
    { type: "audio", mid: "0", mindex: 0, codec: "opus" },
    { type: "video", mid: "1", mindex: 1, codec: "vp8" },
];
const VIDEOROOM_PLUGIN = "janus.plugin.videoroom";

type FakeNotification = (notification: unknown) => unknown;

interface FakeRoomPublisher {
    room: number;
    sessionId: number;
    handleId: number;
    publisherId: number;
}

/**
 * Minimal in-memory stand-in for the media-server WebSocket. Extends {@link EventEmitter} so it
 * supports both the node `ws` `on(...)` surface used by the requester and the DOM-style
 * `addEventListener`/`removeEventListener` used by the cleanup paths. Nothing is sent over it.
 */
class FakeMediaWs extends EventEmitter {
    readyState: number = WebSocket.OPEN;
    readonly OPEN = WebSocket.OPEN;
    readonly CLOSED = WebSocket.CLOSED;
    
    addEventListener(event: string, cb: (...args: any[]) => void) {
        this.on(event, cb);
    }
    removeEventListener(event: string, cb: (...args: any[]) => void) {
        this.off(event, cb);
    }
    close() {
        if (this.readyState === WebSocket.CLOSED) {
            return;
        }
        this.readyState = WebSocket.CLOSED;
        this.emit("close");
    }
}

class FakeJanusHub {
    private participantsByRoom: Map<number, Set<FakeJanusRequester>> = new Map();
    
    join(room: number, requester: FakeJanusRequester) {
        let set = this.participantsByRoom.get(room);
        if (!set) {
            set = new Set();
            this.participantsByRoom.set(room, set);
        }
        set.add(requester);
    }
    
    leaveRoom(room: number, requester: FakeJanusRequester) {
        this.participantsByRoom.get(room)?.delete(requester);
    }
    
    leaveAllRooms(requester: FakeJanusRequester) {
        for (const set of this.participantsByRoom.values()) {
            set.delete(requester);
        }
    }
    
    broadcastRoomEvent(room: number, origin: FakeJanusRequester, key: "leaving" | "unpublished", publisherId: number) {
        const set = this.participantsByRoom.get(room);
        if (!set) {
            return;
        }
        const data: Record<string, unknown> = { videoroom: "event", room };
        data[key] = publisherId;
        const event = { janus: "event", session_id: 0, sender: publisherId, plugindata: { plugin: VIDEOROOM_PLUGIN, data } };
        for (const requester of set) {
            if (requester !== origin) {
                requester.deliver(event);
            }
        }
    }
}

/**
 * Requester that answers every Janus call with a canned success instead of hitting a socket, and
 * drives the {@link FakeJanusHub} so inbound pushes (`webrtcup`, `unpublished`, `leaving`) are
 * simulated faithfully. Branches on the request so higher layers parse plausible session ids,
 * publisher ids and jsep.
 */
class FakeJanusRequester extends JanusRequester {
    private idSeq = 1000;
    private myPublishers: Map<number, FakeRoomPublisher> = new Map();
    private webrtcupEmitted: Set<number> = new Set();
    private pendingTimers: Set<NodeJS.Timeout> = new Set();
    
    constructor(
        logger: Logger,
        ws: WebSocket,
        config: Config,
        private hub: FakeJanusHub,
        private onUnhandled?: FakeNotification,
        private onEvery?: FakeNotification,
    ) {
        super(logger, ws, config, () => undefined, () => undefined);
        ws.on("close", () => this.handleClose());
    }
    
    public requestSync<T>(payload: object): Promise<T> {
        this.handleOutgoing(payload);
        return Promise.resolve(this.buildResponse(payload) as unknown as T);
    }
    public requestAsync<T>(payload: object): Promise<T> {
        this.handleOutgoing(payload);
        return Promise.resolve(this.buildResponse(payload) as unknown as T);
    }
    public createJanusCall<T>(method: string, body: unknown, _sessionId: any, _handleId: any): Promise<T> {
        return Promise.resolve(this.buildResponse({ janus: method, body }) as unknown as T);
    }
    
    public deliver(notification: unknown) {
        try {
            this.onEvery?.(notification);
        }
        catch { /* test fake: swallow handler errors */ }
        try {
            this.onUnhandled?.(notification);
        }
        catch { /* test fake: swallow handler errors */ }
    }
    
    private handleOutgoing(payload: any) {
        const request = payload?.body?.request;
        if (request === "publish") {
            this.scheduleWebrtcUp(payload);
        }
        else if (request === "unpublish") {
            this.broadcastForHandle(Number(payload?.handle_id), "unpublished", false);
        }
        else if (request === "leave") {
            this.broadcastForHandle(Number(payload?.handle_id), "leaving", true);
        }
        else if (payload?.janus === "detach") {
            this.broadcastForHandle(Number(payload?.handle_id), "leaving", true);
        }
        else if (payload?.janus === "destroy") {
            this.broadcastForSession(Number(payload?.session_id), "leaving");
        }
    }
    
    private scheduleWebrtcUp(payload: any) {
        if (!this.onUnhandled) {
            return;
        }
        const handleId = Number(payload?.handle_id);
        if (this.webrtcupEmitted.has(handleId)) {
            return;
        }
        this.webrtcupEmitted.add(handleId);
        const notification = { janus: "webrtcup", session_id: payload?.session_id, sender: payload?.handle_id };
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            this.onUnhandled?.(notification);
        }, 5);
        this.pendingTimers.add(timer);
    }
    
    private broadcastForHandle(handleId: number, key: "leaving" | "unpublished", removeAfter: boolean) {
        const pub = this.myPublishers.get(handleId);
        if (!pub) {
            return;
        }
        this.hub.broadcastRoomEvent(pub.room, this, key, pub.publisherId);
        if (removeAfter) {
            this.forgetHandle(handleId, pub.room);
        }
    }
    
    private broadcastForSession(sessionId: number, key: "leaving" | "unpublished") {
        for (const [handleId, pub] of [...this.myPublishers]) {
            if (pub.sessionId === sessionId) {
                this.hub.broadcastRoomEvent(pub.room, this, key, pub.publisherId);
                this.forgetHandle(handleId, pub.room);
            }
        }
    }
    
    private forgetHandle(handleId: number, room: number) {
        this.myPublishers.delete(handleId);
        this.webrtcupEmitted.delete(handleId);
        if (![...this.myPublishers.values()].some(p => p.room === room)) {
            this.hub.leaveRoom(room, this);
        }
    }
    
    private handleClose() {
        for (const timer of this.pendingTimers) {
            clearTimeout(timer);
        }
        this.pendingTimers.clear();
        // A dropped connection makes its publishers leave every room they were in.
        for (const [handleId, pub] of [...this.myPublishers]) {
            this.hub.broadcastRoomEvent(pub.room, this, "leaving", pub.publisherId);
            this.myPublishers.delete(handleId);
        }
        this.hub.leaveAllRooms(this);
    }
    
    private nextId(): number {
        return this.idSeq++;
    }
    
    private buildResponse(payload: any): any {
        const body = payload?.body;
        // Janus core calls have no plugin `body`.
        if (!body) {
            if (payload?.janus === "create" || payload?.janus === "attach") {
                return { janus: "success", data: { id: this.nextId() } };
            }
            return { janus: "ack" };
        }
        // VideoRoom plugin calls, keyed by the request verb.
        switch (body.request) {
            case "join":
                if (body.ptype === "subscriber") {
                    return { janus: "event", plugindata: { data: { videoroom: "attached", room: body.room, streams: this.feedStreams(body) } }, jsep: FAKE_OFFER };
                }
                return { janus: "event", plugindata: { data: { videoroom: "joined", room: body.room, id: this.registerPublisher(payload), publishers: [] } } };
            case "publish":
            case "configure":
                return { janus: "event", plugindata: { data: { videoroom: "event", room: body.room, streams: FAKE_TRACKS } }, jsep: FAKE_ANSWER };
            case "subscribe":
            case "update":
                return { janus: "event", plugindata: { data: { videoroom: "updated", streams: this.feedStreams(body) } }, jsep: FAKE_OFFER };
            case "unsubscribe":
                return { janus: "event", plugindata: { data: { videoroom: "updated", streams: [] } } };
            default:
                return { janus: "event", plugindata: { data: { videoroom: "event", room: body.room } } };
        }
    }
    
    private registerPublisher(payload: any): number {
        const publisherId = this.nextId();
        const room = Number(payload?.body?.room);
        this.myPublishers.set(Number(payload?.handle_id), {
            room,
            sessionId: Number(payload?.session_id),
            handleId: Number(payload?.handle_id),
            publisherId,
        });
        this.hub.join(room, this);
        return publisherId;
    }
    
    private feedStreams(body: any): { feed_id: unknown; mid: unknown }[] {
        const streams = Array.isArray(body?.streams) ? body.streams : [];
        return streams.map((s: any) => ({ feed_id: s.feed, mid: s.mid }));
    }
}

/**
 * Drop-in {@link JanusConnector} for tests / `streams.mediaServer.fake`: hands out connections
 * backed by {@link FakeJanusRequester}, so the whole stream pipeline (services, events, channels)
 * runs for real without a media server. A shared {@link FakeJanusHub} simulates the inbound Janus
 * pushes that cross connection boundaries (publisher unpublished/leaving → watcher).
 */
export class FakeJanusConnector extends JanusConnector {
    
    private hub = new FakeJanusHub();
    
    constructor(
        private fakeLoggerFactory: LoggerFactory,
        private fakeConfig: Config,
    ) {
        super(fakeLoggerFactory, fakeConfig);
    }
    
    async openWs(onUnhandledMessage?: FakeNotification, onEveryMessage?: FakeNotification): Promise<JanusConnection> {
        const ws = new FakeMediaWs() as unknown as WebSocket;
        const requester = new FakeJanusRequester(
            this.fakeLoggerFactory.createLogger(JanusRequester),
            ws,
            this.fakeConfig,
            this.hub,
            onUnhandledMessage,
            onEveryMessage,
        );
        return {
            janusRequester: requester,
            janusApi: new JanusApi(requester, this.fakeLoggerFactory.createLogger(JanusApi)),
            janusVideoRoomPluginApi: new JanusVideoRoomPluginApi(requester, this.fakeLoggerFactory.createLogger(JanusVideoRoomPluginApi)),
            janusWs: ws,
        };
    }
}
