/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as assert from "assert";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { ContextService } from "../../../service/cloud/ContextService";
import { ContextUserRepository } from "../../../service/cloud/ContextUserRepository";
import { ContextRepository } from "../../../service/cloud/ContextRepository";
import { ContextNotificationService } from "../../../service/cloud/ContextNotificationService";
import { ThreadService } from "../../../service/cloud/ThreadService";
import { StoreService } from "../../../service/cloud/StoreService";
import { InboxService } from "../../../service/cloud/InboxService";
import { StreamService } from "../../../service/cloud/StreamService";
import { GroupService } from "../../../service/cloud/GroupService";
import { CloudAclChecker } from "../../../service/cloud/CloudAclChecker";
import { PolicyService } from "../../../service/cloud/PolicyService";
import { ActiveUsersMap } from "../../../cluster/master/ipcServices/ActiveUsers";
import { Callbacks } from "../../../service/event/Callbacks";
import { createMock, mock } from "../../testUtils/TestUtils";
import { userKeys } from "../../testUtils/TreeFixtures";
import { publicVerifyKeyToBase58 } from "../../../utils/crypto/VerifyKey";
import { AppException } from "../../../api/AppException";
import { DateUtils } from "../../../utils/DateUtils";
import * as types from "../../../types";
import * as db from "../../../db/Model";

// Three identities of three algorithms. Only the tag and the raw length matter here — the bridge reads the
// algorithm off the tag and never does anything else with a user's key — so the composed ones are fabricated
// rather than derived, which keeps this test free of any particular key-generation library.
const secpKey = userKeys("janek").pub58 as unknown as types.cloud.UserPubKey;
const edKey = publicVerifyKeyToBase58({
    algorithm: "ed25519x25519",
    raw: Buffer.alloc(64, 1),
}) as unknown as types.cloud.UserPubKey;
const pqKey = publicVerifyKeyToBase58({
    algorithm: "ed25519x25519mlkem768",
    raw: Buffer.alloc(1248, 2),
}) as unknown as types.cloud.UserPubKey;

const contextId = "MyContextId" as types.context.ContextId;
const acl = "ALLOW ALL" as types.cloud.ContextAcl;

function contextWith(policy?: types.context.ContextPolicy): db.context.Context {
    return {
        id: contextId,
        created: DateUtils.now(),
        modified: DateUtils.now(),
        solution: "MySolutionId" as types.cloud.SolutionId,
        shares: [],
        name: "MyContext" as types.context.ContextName,
        description: "" as types.context.ContextDescription,
        scope: "private",
        policy: policy,
    };
}

function userWith(userPubKey: types.cloud.UserPubKey): db.context.ContextUser {
    return {
        id: "MyContextId-seated" as db.context.ContextUserId,
        created: DateUtils.now(),
        contextId: contextId,
        userId: "seated" as types.cloud.UserId,
        userPubKey: userPubKey,
        acl: acl,
    };
}

/** A ContextService over a context holding `seatedUser` (none when null), with `added` recording the inserts. */
function createContextService(context: db.context.Context, seatedUser: db.context.ContextUser|null) {
    const repositoryFactory = createMock<RepositoryFactory>({});
    const contextRepository = createMock<ContextRepository>({});
    const contextUserRepository = createMock<ContextUserRepository>({});
    const contextNotificationService = createMock<ContextNotificationService>({});
    const activeUsersMap = createMock<ActiveUsersMap>({});
    const added: types.cloud.UserPubKey[] = [];
    const updatedPolicies: types.context.ContextPolicy[] = [];
    
    mock(repositoryFactory, "createContextRepository", () => contextRepository);
    mock(repositoryFactory, "createContextUserRepository", () => contextUserRepository);
    mock(contextRepository, "get", async (id: types.context.ContextId) => id === contextId ? context : null);
    mock(contextRepository, "updateContext", (async (_id: types.context.ContextId, rest: {policy?: types.context.ContextPolicy}) => {
        if (rest.policy) {
            updatedPolicies.push(rest.policy);
        }
    }) as never);
    mock(contextUserRepository, "findAnyUser", async () => seatedUser);
    mock(contextUserRepository, "insertOrUpdate", (async (_c: unknown, _u: unknown, userPubKey: types.cloud.UserPubKey) => {
        added.push(userPubKey);
    }) as never);
    mock(contextNotificationService, "sendUserAdded");
    mock(activeUsersMap, "isContextUserActive", async () => false);
    
    const service = new ContextService(
        repositoryFactory,
        new PolicyService(),
        new CloudAclChecker(),
        createMock<ThreadService>({}),
        createMock<StoreService>({}),
        createMock<InboxService>({}),
        createMock<StreamService>({}),
        createMock<GroupService>({}),
        contextNotificationService,
        activeUsersMap,
        "localhost" as types.core.Host,
        createMock<Callbacks>({}),
    );
    return {service, added, updatedPolicies};
}

async function refusal(action: () => Promise<unknown>) {
    try {
        await action();
    }
    catch (e) {
        assert(e instanceof AppException, `expected an AppException, got ${String(e)}`);
        return e.message + " " + String(e.data ?? "");
    }
    return assert.fail("expected a refusal, the call succeeded");
}

it("addUserToContext refuses a key of an algorithm the context is not made of", async () => {
    const {service, added} = createContextService(contextWith(), userWith(pqKey));
    const message = await refusal(() => service.addUserToContext(contextId, "newcomer" as types.cloud.UserId, edKey, acl));
    assert(message.includes("ed25519x25519mlkem768"), `the refusal should name what the context is: ${message}`);
    assert(message.includes("ed25519x25519'"), `the refusal should name what was offered: ${message}`);
    assert.strictEqual(added.length, 0, "nothing should have been written");
});

it("addUserToContext accepts a key of the algorithm the context already holds", async () => {
    const {service, added} = createContextService(contextWith(), userWith(pqKey));
    await service.addUserToContext(contextId, "newcomer" as types.cloud.UserId, pqKey, acl);
    assert.deepStrictEqual(added, [pqKey]);
});

it("the first user of a context settles its algorithm, whatever it is", async () => {
    for (const key of [secpKey, edKey, pqKey]) {
        const {service, added} = createContextService(contextWith(), null);
        await service.addUserToContext(contextId, "first" as types.cloud.UserId, key, acl);
        assert.deepStrictEqual(added, [key], "an empty context should take any algorithm");
    }
});

it("a declared algorithm binds a context that has no users yet", async () => {
    const declared = contextWith({context: {keyAlgorithm: "ed25519x25519mlkem768" as types.cloud.KeyAlgorithmName}});
    const {service, added} = createContextService(declared, null);
    const message = await refusal(() => service.addUserToContext(contextId, "first" as types.cloud.UserId, secpKey, acl));
    assert(message.includes("ed25519x25519mlkem768"), message);
    assert.strictEqual(added.length, 0);
    
    const ok = createContextService(declared, null);
    await ok.service.addUserToContext(contextId, "first" as types.cloud.UserId, pqKey, acl);
    assert.deepStrictEqual(ok.added, [pqKey]);
});

it("SECURITY: a declared algorithm is not overridden by the users already seated", async () => {
    // A context whose policy says one thing and whose rows say another must refuse both of the keys it
    // disagrees about, rather than quietly letting the rows win and admitting what the policy forbids.
    const declared = contextWith({context: {keyAlgorithm: "ed25519x25519" as types.cloud.KeyAlgorithmName}});
    const {service, added} = createContextService(declared, userWith(pqKey));
    const message = await refusal(() => service.addUserToContext(contextId, "newcomer" as types.cloud.UserId, pqKey, acl));
    assert(message.includes("ed25519x25519'"), `the declaration should decide: ${message}`);
    assert.strictEqual(added.length, 0);
});

it("updateContext refuses a policy that changes the key algorithm", async () => {
    const {service, updatedPolicies} = createContextService(
        contextWith({context: {keyAlgorithm: "ed25519x25519" as types.cloud.KeyAlgorithmName}}),
        userWith(edKey),
    );
    const message = await refusal(() => service.updateContext({
        contextId: contextId,
        policy: {context: {keyAlgorithm: "secp256k1" as types.cloud.KeyAlgorithmName}},
    }));
    assert(message.includes("cannot be changed"), message);
    assert.strictEqual(updatedPolicies.length, 0);
});

it("updateContext refuses a policy that drops a key algorithm it had declared", async () => {
    const {service, updatedPolicies} = createContextService(
        contextWith({context: {keyAlgorithm: "ed25519x25519" as types.cloud.KeyAlgorithmName}}),
        userWith(edKey),
    );
    const message = await refusal(() => service.updateContext({contextId: contextId, policy: {context: {listUsers: "all" as types.cloud.PolicyEntry}}}));
    assert(message.includes("cannot be changed"), message);
    assert.strictEqual(updatedPolicies.length, 0);
});

it("updateContext lets a seeded context write down the algorithm it already has", async () => {
    // The one way a context that never declared anything gains an explicit policy: by stating what its
    // users are already made of. It changes nothing, so it is allowed.
    const {service, updatedPolicies} = createContextService(contextWith(), userWith(edKey));
    await service.updateContext({
        contextId: contextId,
        policy: {context: {keyAlgorithm: "ed25519x25519" as types.cloud.KeyAlgorithmName}},
    });
    assert.strictEqual(updatedPolicies.length, 1);
});

it("updateContext leaves an undeclared context alone when the update says nothing about algorithms", async () => {
    const {service, updatedPolicies} = createContextService(contextWith(), userWith(edKey));
    await service.updateContext({contextId: contextId, policy: {context: {listUsers: "all" as types.cloud.PolicyEntry}}});
    assert.strictEqual(updatedPolicies.length, 1);
});

it("a context policy naming an algorithm the bridge cannot read is refused", async () => {
    const policyService = new PolicyService();
    assert.throws(
        () => policyService.validateContextPolicy({context: {keyAlgorithm: "rot13" as types.cloud.KeyAlgorithmName}}),
        (e: unknown) => e instanceof AppException && String(e.data ?? "").includes("keyAlgorithm"),
    );
    // Every algorithm the bridge knows is configurable, so the two tables cannot drift apart.
    for (const name of ["secp256k1", "ed25519", "ed25519x25519", "ed25519x25519mlkem768"]) {
        policyService.validateContextPolicy({context: {keyAlgorithm: name as types.cloud.KeyAlgorithmName}});
    }
});
