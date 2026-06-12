/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import "q2-test";
import { WebSocketInnerManager } from "../../../service/ws/WebSocketInnerManager";
import { TargetChannel } from "../../../service/ws/WebSocketConnectionManager";
import * as types from "../../../types";
import { createMock } from "../../testUtils/TestUtils";

function manager(): WebSocketInnerManager {
    return new WebSocketInnerManager(createMock({}) as any, createMock({}) as any, createMock({}) as any);
}

function channel(path: string): types.cloud.ChannelScheme {
    return { subscriptionId: path as any, orgChannel: path, path, limitedBy: "none", objectId: "<none>", version: 2 } as any;
}

function target(path: string): TargetChannel {
    return { contextId: "ctx" as any, channel: path as any };
}

function matches(subscriptionPath: string, eventPath: string): boolean {
    const { matchingSubscriptions } = manager().getMatchingsubscriptionsAndOptions(target(eventPath), [channel(subscriptionPath)]);
    return matchingSubscriptions.length === 1;
}

describe("WebSocketInnerManager path matching (segment-aware)", () => {
    it("matches an exact path", () => {
        expect(matches("streamroom/streams/publish", "streamroom/streams/publish")).toBe(true);
    });
    
    it("matches a parent path on a `/` boundary", () => {
        expect(matches("streamroom", "streamroom/join")).toBe(true);
        expect(matches("streamroom/streams", "streamroom/streams/publish")).toBe(true);
    });
    
    it("does NOT match a mid-segment textual prefix", () => {
        expect(matches("streamroom/stream", "streamroom/streams/publish")).toBe(false);
        expect(matches("streamroo", "streamroom/join")).toBe(false);
    });
    
    it("does NOT match a sibling leaf", () => {
        expect(matches("streamroom/streams/publish", "streamroom/streams/unpublish")).toBe(false);
        expect(matches("streamroom/join", "streamroom/leave")).toBe(false);
    });
});
