/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, Test } from "../BaseTestSet";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import { buildTree } from "../../testUtils/TreeFixtures";
import * as types from "../../../types";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { PromiseUtils } from "../../../utils/PromiseUtils";

/**
 * Group events, from subscribing to receiving.
 *
 * Nothing covered this path before, on either side, which is how the bridge came to publish on
 * `context/groups/update` while the endpoint subscribed to `context/update` — two halves that each looked right
 * and never met. The tests here go all the way through: subscribe, change the group, read what arrived.
 */

const groupIdentity = ECUtils.generateKeyPair();
const groupPubKey = groupIdentity.pub58 as unknown as types.cloud.GroupPubKey;
const secondGroupIdentity = ECUtils.generateKeyPair();
const secondGroupPubKey = secondGroupIdentity.pub58 as unknown as types.cloud.GroupPubKey;

interface ReceivedEvent {
    type: string;
    data: Record<string, unknown>;
}

export class GroupEventsTest extends BaseTestSet {
    
    private received: ReceivedEvent[] = [];
    private groupId?: types.group.GroupId;
    private otherGroupId?: types.group.GroupId;
    
    @Test()
    async shouldDeliverGroupUpdatedEventWithoutGroupState() {
        await this.createGroup();
        await this.listenOn(`context/groups/update|contextId=${testData.contextId}`);
        await this.updateGroup();
        await this.verifyEventArrivedCarryingOnlyWhatChanged();
        await this.verifyTheOtherTwoKindsArriveOnTheSameChannel();
    }
    
    @Test()
    async shouldDeliverGroupCreatedEvent() {
        await this.listenOn(`context/groups/create|contextId=${testData.contextId}`);
        await this.createGroup();
        await this.settle();
        const events = this.received.filter(e => e.type === "groupCreated");
        assert(events.length === 1, `expected one groupCreated, got ${events.length}`);
        assert(events[0].data.changeKind === "created", `changeKind mismatch: ${JSON.stringify(events[0].data)}`);
    }
    
    @Test()
    async shouldScopeASubscriptionToOneGroup() {
        // A subscription narrowed to one group must not receive another group's events. The bridge used to omit
        // containerId from the group channel, and the matcher skips the selector check when the target has none —
        // so this passed for the wrong reason: nothing matched at all.
        await this.createGroup();
        await this.createSecondGroup();
        await this.listenOn(`context/groups/update|containerId=${this.requireGroupId()}`);
        await this.updateOtherGroup();
        await this.settle();
        assert(this.received.length === 0, `a subscription for one group received another group's events: ${JSON.stringify(this.received)}`);
        await this.updateGroup();
        await this.settle();
        const own = this.received;
        assert(own.length === 1, `expected the subscribed group's own event, got ${own.length}`);
        assert(own[0].data.groupId === this.requireGroupId(), "wrong groupId in the event");
    }
    
    private async listenOn(channel: string) {
        this.helpers.addEventListenerForNotification(evt => {
            // The frame is {type: "notification", notificationType, data}; the payload is `data` itself.
            this.received.push({
                type: (evt as unknown as {notificationType: string}).notificationType,
                data: evt.data as Record<string, unknown>,
            });
        });
        await this.helpers.subscribeToChannels([channel]);
    }
    
    /** Delivery is asynchronous; the job that sends it runs after the request returns. */
    private async settle() {
        await PromiseUtils.wait(1000);
    }
    
    private async verifyEventArrivedCarryingOnlyWhatChanged() {
        await this.settle();
        const events = this.received.filter(e => e.type === "groupUpdated");
        assert(events.length === 1, `expected one groupUpdated, got ${events.length}`);
        const data = events[0].data;
        assert.deepStrictEqual(Object.keys(data).sort(), ["changeKind", "contextId", "groupId", "keyVersion", "privateMetaVersion", "publicMetaVersion", "rosterVersion"]);
        assert(data.groupId === this.requireGroupId(), "groupId mismatch");
        // Every plane has its own counter, and a public-metadata write moves exactly one of the three.
        assert(data.publicMetaVersion === 2, `publicMetaVersion should be 2 after one write, got ${JSON.stringify(data.publicMetaVersion)}`);
        assert(data.privateMetaVersion === 1, `privateMetaVersion should be untouched, got ${JSON.stringify(data.privateMetaVersion)}`);
        assert(data.rosterVersion === 1, `rosterVersion should be untouched by an update, got ${JSON.stringify(data.rosterVersion)}`);
        assert(data.changeKind === "publicMetaUpdated", `changeKind mismatch: ${JSON.stringify(data.changeKind)}`);
    }
    
    /**
     * The private plane and the policy announce themselves on the same channel and under the same event type.
     *
     * A client subscribed before the split keeps receiving everything; only `changeKind` and the counters say
     * which plane moved. A `policyUpdated` moves no counter at all, which is how a client knows there is no
     * envelope to re-verify.
     */
    private async verifyTheOtherTwoKindsArriveOnTheSameChannel() {
        const groupId = this.requireGroupId();
        await this.apis.contextApi.groupUpdatePrivateMeta({
            id: groupId, data: "PRIV2" as types.group.GroupData,
            keyId: testData.keyId, version: 1 as types.group.GroupVersion,
        });
        await this.settle();
        const afterPrivate = this.received.filter(e => e.type === "groupUpdated");
        const privateEvent = afterPrivate[afterPrivate.length - 1].data;
        assert(privateEvent.changeKind === "privateMetaUpdated", `changeKind mismatch: ${JSON.stringify(privateEvent.changeKind)}`);
        assert(privateEvent.privateMetaVersion === 2, "the private counter must have advanced");
        
        await this.apis.contextApi.groupUpdatePolicy({id: groupId, policy: {get: "all" as types.cloud.PolicyEntry}});
        await this.settle();
        const afterPolicy = this.received.filter(e => e.type === "groupUpdated");
        const policyEvent = afterPolicy[afterPolicy.length - 1].data;
        assert(policyEvent.changeKind === "policyUpdated", `changeKind mismatch: ${JSON.stringify(policyEvent.changeKind)}`);
        assert(policyEvent.publicMetaVersion === privateEvent.publicMetaVersion, "a policy write moved the public counter");
        assert(policyEvent.privateMetaVersion === privateEvent.privateMetaVersion, "a policy write moved the private counter");
    }
    
    private async createGroup() {
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            groupPubKey: groupPubKey,
            users: [testData.userId],
            managers: [testData.userId],
            data: "AAAA" as types.group.GroupData,
            publicMeta: "META" as types.group.GroupData,
            privateMeta: "META_PRIV" as types.group.GroupData,
            keyId: testData.keyId,
            tree: buildTree([testData.userId], 1),
        });
        this.groupId = res.groupId;
    }
    
    private async createSecondGroup() {
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            groupPubKey: secondGroupPubKey,
            users: [testData.userId],
            managers: [testData.userId],
            data: "BBBB" as types.group.GroupData,
            publicMeta: "META2" as types.group.GroupData,
            privateMeta: "META2_PRIV" as types.group.GroupData,
            keyId: testData.keyId,
            tree: buildTree([testData.userId], 1),
        });
        this.otherGroupId = res.groupId;
    }
    
    private async updateGroup() {
        await this.update(this.requireGroupId(), "AAAAB" as types.group.GroupData);
    }
    
    private async updateOtherGroup() {
        if (!this.otherGroupId) {
            throw new Error("second group not created yet");
        }
        await this.update(this.otherGroupId, "BBBBC" as types.group.GroupData);
    }
    
    private async update(id: types.group.GroupId, data: types.group.GroupData) {
        const res = await this.apis.contextApi.groupUpdatePublicMeta({
            id: id,
            data: data,
            keyId: testData.keyId,
            version: 1 as types.group.GroupVersion,
        });
        assert(res === "OK", "groupUpdatePublicMeta did not return OK");
    }
    
    private requireGroupId(): types.group.GroupId {
        if (!this.groupId) {
            throw new Error("groupId not initialized yet");
        }
        return this.groupId;
    }
}
