/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { JanusRoomsWatcherCache } from "../../../cluster/master/ipcServices/JanusRoomsWatcherCache";
import { StreamRoomId } from "../../../types/stream";
import { UserId } from "../../../types/cloud";
import { Timespan } from "../../../types/core";
import { StreamSubscription } from "../../../api/main/stream/StreamApiTypes";
import { Logger } from "../../../service/log/Logger";
import { createMock, empty } from "../../testUtils/TestUtils";

const HOST = "localhost";
const ROOM = "R" as StreamRoomId;
const USER_A = "userA" as UserId;
const USER_B = "userB" as UserId;

function sub(streamId: number, streamTrackId?: string): StreamSubscription {
    return { streamId: streamId as any, streamTrackId: streamTrackId as any };
}

function build() {
    const logger = createMock<Logger>({ debug: mockFn(empty), warning: mockFn(empty), error: mockFn(empty), out: mockFn(empty) });
    const cache = new JanusRoomsWatcherCache(logger);
    return cache;
}

async function withRoom(cache: JanusRoomsWatcherCache) {
    // Seed a publisher so the room exists; membership can also create it on its own (tested below).
    await cache.addPublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 });
}

describe("JanusRoomsWatcherCache subscribers", () => {
    it("adds, dedups and lists subscriptions per user", async () => {
        const cache = build();
        await withRoom(cache);
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1), sub(2, "t1")] });
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1), sub(3)] }); // sub(1) is a duplicate
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_B, subscriptions: [sub(9)] });
        
        const subscribers = await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM });
        expect(subscribers.length).toBe(2);
        const a = subscribers.find(s => s.userId === USER_A);
        expect(a?.subscriptions.length).toBe(3); // 1, 2/t1, 3 — duplicate 1 not added twice
    });
    
    it("removes individual subscriptions but keeps the member after unsubscribing from everything", async () => {
        const cache = build();
        await withRoom(cache);
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1), sub(2, "t1")] });
        await cache.removeSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1)] });
        
        let subscribers = await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM });
        expect(subscribers[0]?.subscriptions.length).toBe(1);
        expect(subscribers[0]?.subscriptions[0]?.streamId as number).toBe(2);
        
        await cache.removeSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(2, "t1")] });
        subscribers = await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM });
        // The viewer is still a room member, just no longer watching any stream.
        expect(subscribers.length).toBe(1);
        expect(subscribers[0]?.subscriptions.length).toBe(0);
    });
    
    it("removeSubscriber drops all of a user's subscriptions", async () => {
        const cache = build();
        await withRoom(cache);
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1), sub(2)] });
        await cache.removeSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A });
        expect((await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM })).length).toBe(0);
    });
    
    it("creates room membership when a viewer subscribes before any publisher", async () => {
        const cache = build();
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1)] });
        const subscribers = await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM });
        expect(subscribers.length).toBe(1);
        expect(subscribers[0]?.subscriptions.length).toBe(1);
    });
    
    it("removeRoomWatcher clears subscribers along with the room state", async () => {
        const cache = build();
        await withRoom(cache);
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1)] });
        await cache.removeRoomWatcher({ host: HOST, streamRoomId: ROOM });
        expect((await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM })).length).toBe(0);
    });
});

describe("JanusRoomsWatcherCache room emptiness", () => {
    it("addSubscriber creates membership without any publisher", async () => {
        const cache = build();
        await cache.addSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A });
        expect((await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM })).length).toBe(1);
    });
    
    it("removePublisher does not empty the room while a member remains", async () => {
        const cache = build();
        await cache.addPublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 });
        await cache.addSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A });
        
        // Last publisher leaves, but a viewer is still in the room.
        expect(await cache.removePublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 })).toBe(false);
        expect((await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM })).length).toBe(1);
        
        // The viewer leaving is the transition that finally empties the room.
        expect(await cache.removeSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A })).toBe(true);
    });
    
    it("removePublisher empties a publisher-only room (no members)", async () => {
        const cache = build();
        await cache.addPublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 });
        expect(await cache.removePublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 })).toBe(true);
    });
    
    it("removeSubscriber reports empty when the last member leaves a publisher-less room", async () => {
        const cache = build();
        await cache.addSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A });
        expect(await cache.removeSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A })).toBe(true);
    });
});

describe("JanusRoomsWatcherCache stream room ttl (grace period)", () => {
    const ONE_HOUR = (60 * 60 * 1000) as Timespan;
    const NO_TTL = 0 as Timespan;
    
    it("closes immediately (ttl = 0): the emptied room is due right away", async () => {
        const cache = build();
        await cache.addPublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100, ttl: NO_TTL });
        // ttl 0 => removePublisher signals "close now".
        expect(await cache.removePublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 })).toBe(true);
        const due = await cache.extractPendingEmptyRooms({ limit: 10 });
        expect(due.length).toBe(1);
        expect(due[0]?.streamRoomId as string).toBe(ROOM);
    });
    
    it("defers closing (ttl > 0): the emptied room is not yet due and is not closed immediately", async () => {
        const cache = build();
        await cache.addPublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100, ttl: ONE_HOUR });
        // ttl > 0 => removePublisher does NOT signal an immediate close; the room is queued for later.
        expect(await cache.removePublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 })).toBe(false);
        // The deadline is an hour out, so nothing is due yet.
        expect((await cache.extractPendingEmptyRooms({ limit: 10 })).length).toBe(0);
    });
    
    it("defers closing for member-emptied rooms too (ttl > 0)", async () => {
        const cache = build();
        await cache.addSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A, ttl: ONE_HOUR });
        expect(await cache.removeSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A })).toBe(false);
        expect((await cache.extractPendingEmptyRooms({ limit: 10 })).length).toBe(0);
    });
    
    it("rejoining within the grace period cancels the pending close (publisher)", async () => {
        const cache = build();
        await cache.addPublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100, ttl: ONE_HOUR });
        await cache.removePublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 100 });
        // Someone rejoins before the deadline.
        await cache.addPublisher({ host: HOST, streamRoomId: ROOM, janusRoomId: 1, publisherId: 101, ttl: ONE_HOUR });
        expect((await cache.extractPendingEmptyRooms({ limit: 10 })).length).toBe(0);
    });
    
    it("rejoining within the grace period cancels the pending close (subscriber)", async () => {
        const cache = build();
        await cache.addSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A, ttl: ONE_HOUR });
        await cache.removeSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A });
        // A viewer rejoins before the deadline.
        await cache.addSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_B, ttl: ONE_HOUR });
        expect((await cache.extractPendingEmptyRooms({ limit: 10 })).length).toBe(0);
    });
});
