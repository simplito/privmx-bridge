/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as assert from "assert";
import * as types from "../../../types";
import { testData } from "../../datasets/testData";
import { BaseTestSet, Test } from "../BaseTestSet";

const streamsEnabledFake = {
    config: {
        streams: {
            enabled: "true",
            mediaServer: {
                fake: true,
            },
        },
    },
};

export class StreamRenegotiationTest extends BaseTestSet {

    @Test(streamsEnabledFake)
    async streamSetNewOfferReturnsTheAnswerOfTheMediaServer() {
        const streamRoomId = await this.createStreamRoom();
        await this.apis.streamApi.streamRoomJoin({ streamRoomId });
        const published = await this.apis.streamApi.streamPublish({ streamRoomId, offer: { type: "offer", sdp: "x" } });

        // a publisher renegotiates by sending its own offer, so it needs the answer back to complete it
        const res = await this.apis.streamApi.streamSetNewOffer({
            sessionId: published.sessionId,
            offer: { type: "offer", sdp: "renegotiated-offer" },
        });

        assert(res.sessionId === published.sessionId, "the answer must belong to the renegotiated session");
        assert(res.answer !== undefined, "streamSetNewOffer must return the answer, not swallow it");
        assert(res.answer?.type === "answer", `expected an answer, got '${res.answer?.type}'`);
        assert((res.answer?.sdp ?? "").length > 0, "the answer must carry an sdp");

        await this.apis.streamApi.streamRoomLeave({ streamRoomId });
    }

    private async createStreamRoom(): Promise<types.stream.StreamRoomId> {
        const res = await this.apis.streamApi.streamRoomCreate({
            contextId: testData.contextId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA",
            keyId: testData.keyId,
            keys: [{ user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData }],
            managers: [testData.userId],
            users: [testData.userId],
        });
        return res.streamRoomId;
    }
}
