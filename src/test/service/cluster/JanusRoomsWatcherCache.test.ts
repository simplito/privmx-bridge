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
    // A subscriber always has a publisher/main session in the room first, which creates the RoomState.
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
    
    it("removes individual subscriptions and drops the user when empty", async () => {
        const cache = build();
        await withRoom(cache);
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1), sub(2, "t1")] });
        await cache.removeSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1)] });
        
        let subscribers = await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM });
        expect(subscribers[0]?.subscriptions.length).toBe(1);
        expect(subscribers[0]?.subscriptions[0]?.streamId as number).toBe(2);
        
        await cache.removeSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(2, "t1")] });
        subscribers = await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM });
        expect(subscribers.length).toBe(0);
    });
    
    it("removeSubscriber drops all of a user's subscriptions", async () => {
        const cache = build();
        await withRoom(cache);
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1), sub(2)] });
        await cache.removeSubscriber({ host: HOST, streamRoomId: ROOM, userId: USER_A });
        expect((await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM })).length).toBe(0);
    });
    
    it("addSubscriptions is a no-op when the room state is missing", async () => {
        const cache = build();
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1)] });
        expect((await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM })).length).toBe(0);
    });
    
    it("removeRoomWatcher clears subscribers along with the room state", async () => {
        const cache = build();
        await withRoom(cache);
        await cache.addSubscriptions({ host: HOST, streamRoomId: ROOM, userId: USER_A, subscriptions: [sub(1)] });
        await cache.removeRoomWatcher({ host: HOST, streamRoomId: ROOM });
        expect((await cache.getRoomSubscribers({ host: HOST, streamRoomId: ROOM })).length).toBe(0);
    });
});
