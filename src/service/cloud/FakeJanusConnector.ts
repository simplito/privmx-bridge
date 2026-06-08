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

/**
 * Minimal in-memory stand-in for the media-server WebSocket: enough surface for the requester
 * (`on`) and the per-ws cleanup path (`addEventListener`/`readyState`/`close`). Nothing is sent.
 */
class FakeMediaWs {
    readyState: number = WebSocket.OPEN;
    private listeners = new Map<string, ((...args: any[]) => void)[]>();
    
    on(event: string, cb: (...args: any[]) => void) {
        this.add(event, cb);
    }
    addEventListener(event: string, cb: (...args: any[]) => void) {
        this.add(event, cb);
    }
    removeEventListener(event: string, cb: (...args: any[]) => void) {
        this.listeners.set(event, (this.listeners.get(event) || []).filter(x => x !== cb));
    }
    close() {
        this.readyState = WebSocket.CLOSED;
        for (const cb of this.listeners.get("close") || []) {
            cb();
        }
    }
    private add(event: string, cb: (...args: any[]) => void) {
        const list = this.listeners.get(event) || [];
        list.push(cb);
        this.listeners.set(event, list);
    }
}

/**
 * Requester that answers every Janus call with a canned success instead of hitting a socket.
 * Branches on the request so higher layers parse plausible session ids, publisher ids and jsep.
 */
class FakeJanusRequester extends JanusRequester {
    private idSeq = 1000;
    
    constructor(logger: Logger, ws: WebSocket, config: Config) {
        super(logger, ws, config, () => undefined, () => undefined);
    }
    
    public requestSync<T>(payload: object): Promise<T> {
        return Promise.resolve(this.buildResponse(payload) as unknown as T);
    }
    public requestAsync<T>(payload: object): Promise<T> {
        return Promise.resolve(this.buildResponse(payload) as unknown as T);
    }
    public createJanusCall<T>(method: string, body: unknown, _sessionId: any, _handleId: any): Promise<T> {
        return Promise.resolve(this.buildResponse({ janus: method, body }) as unknown as T);
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
                return { janus: "event", plugindata: { data: { videoroom: "joined", room: body.room, id: this.nextId(), publishers: [] } } };
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
    
    private feedStreams(body: any): { feed_id: unknown; mid: unknown }[] {
        const streams = Array.isArray(body?.streams) ? body.streams : [];
        return streams.map((s: any) => ({ feed_id: s.feed, mid: s.mid }));
    }
}

/**
 * Drop-in {@link JanusConnector} for tests / `streams.mediaServer.fake`: hands out connections
 * backed by {@link FakeJanusRequester}, so the whole stream pipeline (services, events, channels)
 * runs for real without a media server. Inbound Janus pushes are not simulated.
 */
export class FakeJanusConnector extends JanusConnector {
    
    constructor(
        private fakeLoggerFactory: LoggerFactory,
        private fakeConfig: Config,
    ) {
        super(fakeLoggerFactory, fakeConfig);
    }
    
    async openWs(): Promise<JanusConnection> {
        const ws = new FakeMediaWs() as unknown as WebSocket;
        const requester = new FakeJanusRequester(this.fakeLoggerFactory.createLogger(JanusRequester), ws, this.fakeConfig);
        return {
            janusRequester: requester,
            janusApi: new JanusApi(requester, this.fakeLoggerFactory.createLogger(JanusApi)),
            janusVideoRoomPluginApi: new JanusVideoRoomPluginApi(requester, this.fakeLoggerFactory.createLogger(JanusVideoRoomPluginApi)),
            janusWs: ws,
        };
    }
}
