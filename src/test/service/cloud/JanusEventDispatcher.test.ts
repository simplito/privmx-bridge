/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/unbound-method */
import "q2-test";
import { JanusEventDispatcher } from "../../../service/cloud/JanusEventDispatcher";
import { JanusNotificationParser } from "../../../service/cloud/JanusNotificationParser";
import { isPublishingSession } from "../../../service/cloud/JanusContext";
import { JanusSession } from "../../../CommonTypes";
import { Logger } from "../../../service/log/Logger";
import { LoggerFactory } from "../../../service/log/LoggerFactory";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { StreamNotificationService } from "../../../service/cloud/StreamNotificationService";
import { createMock, empty, hasNoCalls, hasOneCall } from "../../testUtils/TestUtils";
import { PromiseUtils } from "../../../utils/PromiseUtils";

function noopLogger(): Logger {
    return createMock<Logger>({ debug: mockFn(empty), warning: mockFn(empty), error: mockFn(empty), out: mockFn(empty) });
}

function build() {
    const logger = noopLogger();
    const loggerFactory = createMock<LoggerFactory>({ createLogger: mockFn(() => logger) as any });
    const streamRoomRepo = { get: mockFn(async () => ({ id: "R", users: ["U"], managers: [] })) };
    const repositoryFactory = createMock<RepositoryFactory>({ createStreamRoomRepository: mockFn(() => streamRoomRepo) as any });
    const notifications = createMock<StreamNotificationService>({
        sendStreamRoomReofferSingleEvent: mockFn(empty),
        sendStreamUnpublishedEvent: mockFn(empty),
        sendStreamRoomLeftEvent: mockFn(empty),
    });
    const parser = new JanusNotificationParser(loggerFactory);
    const dispatcher = new JanusEventDispatcher(loggerFactory, repositoryFactory, notifications, parser);
    return { dispatcher, notifications };
}

function session(type: "main" | "subscriber", overrides: Partial<JanusSession> = {}): JanusSession {
    return {
        source: `${type}/1`,
        type,
        streamRoomId: "R" as any,
        userId: "U" as any,
        session: { id: 5 as any, handle: 1 as any },
        keepAlivePinger: null as any,
        streamsToAccept: [],
        publishedStreams: [],
        janusPublisherId: undefined,
        addStreamsOffer: empty as any,
        acceptStreamsOffer: empty as any,
        keepPublishedStream: empty as any,
        removePublishedStream: empty as any,
        ...overrides,
    };
}

function websocketWith(sess: JanusSession | undefined) {
    const ctx = { findJanusSessionByIdOrReturnNull: () => sess };
    return {
        ex: {
            janus: { ws1: { janusContextPromise: Promise.resolve(ctx) } },
            sessions: [{ wsId: "ws1" }],
        },
    } as any;
}

function notification(videoroom: string, extra: Record<string, unknown> = {}) {
    return { janus: "event", session_id: 5, plugindata: { data: { videoroom, ...extra } }, jsep: { type: "offer", sdp: "x" } };
}

describe("isPublishingSession", () => {
    it("is true only for a main session with a publisher id and live streams", () => {
        expect(isPublishingSession(session("main", { janusPublisherId: 1 as any, publishedStreams: [{ id: 1 } as any] }))).toBe(true);
        expect(isPublishingSession(session("main", { janusPublisherId: 1 as any, publishedStreams: [] }))).toBe(false);
        expect(isPublishingSession(session("main", { janusPublisherId: undefined, publishedStreams: [{ id: 1 } as any] }))).toBe(false);
        expect(isPublishingSession(session("subscriber", { janusPublisherId: 1 as any, publishedStreams: [{ id: 1 } as any] }))).toBe(false);
    });
});

describe("JanusEventDispatcher.handleJanusNotification", () => {
    it("translates a subscriber `updated` into a single re-offer event", async () => {
        const { dispatcher, notifications } = build();
        await dispatcher.handleJanusNotification(notification("updated"), websocketWith(session("subscriber")), "ws1" as any);
        hasOneCall(notifications.sendStreamRoomReofferSingleEvent as any);
    });
    
    it("ignores publishers/unpublished/leaving (covered by broadcast events)", async () => {
        for (const data of [notification("event", { publishers: [] }), notification("event", { unpublished: 1 }), notification("event", { leaving: 1 })]) {
            const { dispatcher, notifications } = build();
            await dispatcher.handleJanusNotification(data, websocketWith(session("main")), "ws1" as any);
            hasNoCalls(notifications.sendStreamRoomReofferSingleEvent as any);
        }
    });
    
    it("does not translate `updated` for a main (publisher) session", async () => {
        const { dispatcher, notifications } = build();
        await dispatcher.handleJanusNotification(notification("updated"), websocketWith(session("main")), "ws1" as any);
        hasNoCalls(notifications.sendStreamRoomReofferSingleEvent as any);
    });
});

describe("JanusEventDispatcher.emitDisconnectEventsForSessions", () => {
    it("emits streamUnpublished for publishing sessions and one streamRoomLeft per room+user", async () => {
        const { dispatcher, notifications } = build();
        dispatcher.emitDisconnectEventsForSessions([
            session("main", { janusPublisherId: 9 as any, publishedStreams: [{ id: 9 } as any] }),
            session("subscriber"),
        ]);
        await PromiseUtils.wait(50);
        hasOneCall(notifications.sendStreamUnpublishedEvent as any);
        hasOneCall(notifications.sendStreamRoomLeftEvent as any);
    });
    
    it("emits only streamRoomLeft when nothing was publishing", async () => {
        const { dispatcher, notifications } = build();
        dispatcher.emitDisconnectEventsForSessions([session("main")]);
        await PromiseUtils.wait(50);
        hasNoCalls(notifications.sendStreamUnpublishedEvent as any);
        hasOneCall(notifications.sendStreamRoomLeftEvent as any);
    });
});
