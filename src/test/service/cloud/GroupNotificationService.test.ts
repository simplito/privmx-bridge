/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/unbound-method */

import "q2-test";
import * as assert from "assert";
import { GroupNotificationService } from "../../../service/cloud/GroupNotificationService";
import { JobService } from "../../../service/job/JobService";
import { WebSocketSender } from "../../../service/ws/WebSocketSender";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { ContextUserRepository } from "../../../service/cloud/ContextUserRepository";
import { NotificationRepository } from "../../../service/cloud/NotificationRepository";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { createMock, hasNoCalls, mock } from "../../testUtils/TestUtils";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { buildTree } from "../../testUtils/TreeFixtures";

/**
 * A group event says what changed, not what the group now looks like.
 *
 * The state used to be converted once per recipient, so a group of a thousand sent a thousand copies of its tree
 * and history for one membership change. These tests pin the two properties that stop that from coming back: the
 * payload carries nothing that grows with the group, and it is built and sent once for everybody.
 */

const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const janek = "janek" as types.cloud.UserId;
const alice = "alice" as types.cloud.UserId;
const removed = "removed" as types.cloud.UserId;

interface SentEvent {
    clients: types.core.Client[];
    event: {type: string, data: Record<string, unknown>};
}

function group(memberCount = 3): db.group.Group {
    const users = Array.from({length: memberCount}, (_, i) => `member_${i}` as types.cloud.UserId);
    return {
        id: groupId,
        contextId: contextId,
        groupPubKey: "GroupPubKey" as unknown as types.cloud.GroupPubKey,
        createDate: 0 as types.core.Timestamp,
        creator: janek,
        lastModificationDate: 0 as types.core.Timestamp,
        lastModifier: janek,
        keyId: "SomeKeyId" as types.core.KeyId,
        data: "SomeGroupData" as types.group.GroupData,
        users: users,
        managers: [janek],
        version: 7 as types.group.GroupVersion,
        keyVersion: 4,
        numLeaves: 4,
        leafAssignment: [janek, alice],
        eraFloor: 1,
    };
}

function createService() {
    const sent: SentEvent[] = [];
    const stored: {pub: types.cloud.UserPubKey, event: unknown}[] = [];
    const jobs: Promise<unknown>[] = [];
    
    const jobService = createMock<JobService>({});
    mock(jobService, "addJob", (job => {
        jobs.push(typeof job === "function" ? Promise.resolve(job()) : job);
    }) as JobService["addJob"]);
    
    const webSocketSender = createMock<WebSocketSender>({});
    mock(webSocketSender, "sendCloudEventAtChannel", ((clients: types.core.Client[], _channel: unknown, event: unknown) => {
        sent.push({clients, event: event as SentEvent["event"]});
    }) as never);
    
    const contextUserRepository = createMock<ContextUserRepository>({});
    mock(contextUserRepository, "getUsers", (async (_ctx: types.context.ContextId, users: types.cloud.UserId[]) =>
        users.map(userId => ({userId, userPubKey: `pub-${userId}` as types.cloud.UserPubKey}))) as never);
    
    const notificationRepository = createMock<NotificationRepository>({});
    mock(notificationRepository, "insert", (async (pub: types.cloud.UserPubKey, _channel: unknown, event: unknown) => {
        stored.push({pub, event});
    }) as never);
    
    // The notification path must not read group state any more; a call here is the regression.
    const groupRepository = createMock<GroupRepository>({});
    mock(groupRepository, "getFullState", async () => ({tree: buildTree(["janek"], 1), history: []}));
    
    const repositoryFactory = createMock<RepositoryFactory>({});
    mock(repositoryFactory, "createContextUserRepository", () => contextUserRepository);
    mock(repositoryFactory, "createNotificationRepository", () => notificationRepository);
    mock(repositoryFactory, "createGroupRepository", () => groupRepository);
    
    const service = new GroupNotificationService(jobService, webSocketSender, repositoryFactory);
    return {service, sent, stored, groupRepository, settle: async () => {
        await Promise.all(jobs);
    }};
}

it("a group event carries what changed and nothing that grows with the group", async () => {
    const {service, sent, settle} = createService();
    service.sendUpdatedGroup(group(), "solution" as types.cloud.SolutionId, [], "memberRemoved");
    await settle();
    
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(Object.keys(sent[0].event.data).sort(), ["changeKind", "contextId", "groupId", "keyVersion", "version"]);
    assert.strictEqual(sent[0].event.data.groupId, groupId);
    assert.strictEqual(sent[0].event.data.version, 7);
    assert.strictEqual(sent[0].event.data.keyVersion, 4);
    assert.strictEqual(sent[0].event.data.changeKind, "memberRemoved");
});

it("the payload is sent once for every recipient, not built per recipient", async () => {
    // One send for a group of three and one for a group of three hundred: the cost of an event must not follow
    // the size of the group.
    const {service, sent, settle} = createService();
    service.sendUpdatedGroup(group(300), "solution" as types.cloud.SolutionId, [], "updated");
    await settle();
    
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].clients.length, 301, "everybody gets it — managers included");
});

it("the notification path reads no group state", async () => {
    // Serving the tree and the history here is what BR-03 removed; fetching them to serve is the same cost.
    const {service, groupRepository, settle} = createService();
    service.sendCreatedGroup(group(), "solution" as types.cloud.SolutionId);
    service.sendUpdatedGroup(group(), "solution" as types.cloud.SolutionId, [], "keyRotated");
    await settle();
    hasNoCalls(groupRepository.getFullState);
});

it("a created group announces itself the same way", async () => {
    const {service, sent, settle} = createService();
    service.sendCreatedGroup(group(), "solution" as types.cloud.SolutionId);
    await settle();
    assert.strictEqual(sent[0].event.type, "groupCreated");
    assert.strictEqual(sent[0].event.data.changeKind, "created");
});

it("a member who was just removed is told, and an inactive one has it stored", async () => {
    // The removed member's client needs to learn it can stop trying to climb; it is no longer in the roster, so
    // it is not in the recipient list the roster produced.
    const {service, sent, stored, settle} = createService();
    service.sendUpdatedGroup(group(), "solution" as types.cloud.SolutionId, [
        {id: removed, pub: "pub-removed" as types.cloud.UserPubKey, status: "active"},
        {id: "gone" as types.cloud.UserId, pub: "pub-gone" as types.cloud.UserPubKey, status: "inactive"},
    ], "memberRemoved");
    await settle();
    
    assert.strictEqual(sent.length, 2, "one send for the roster, one for the active leavers");
    assert.deepStrictEqual(sent[1].clients, ["pub-removed"]);
    assert.strictEqual(sent[1].event.data.changeKind, "memberRemoved");
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].pub, "pub-gone");
});
