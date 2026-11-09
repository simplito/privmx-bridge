/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../types";
import { ThreadApiValidator } from "../../api/main/thread/ThreadApiValidator";
import { ManagementContextApiValidator } from "../../api/plain/context/ManagementContextApiValidator";
import { TypesValidator } from "../../api/TypesValidator";
import { PolicyService } from "../../service/cloud/PolicyService";
import { Utils } from "../../utils/Utils";

/**
 * The request validator rejects any key it does not list, so a policy field that exists in the types but is
 * missing from `TypesValidator` is not merely ignored — every request carrying it is refused. That makes the
 * field unreachable and the omission silent, which is how `cryptoSuite`, container `sendCustomNotification` and
 * the whole `context` sub-policy came to be shipped and dead.
 */

function threadCreate(policy: types.cloud.ContainerPolicy) {
    return Utils.try(() => new ThreadApiValidator(new TypesValidator()).validate("threadCreate", {
        contextId: "MyContextId" as types.context.ContextId,
        users: ["janek"] as types.cloud.UserId[],
        managers: ["janek"] as types.cloud.UserId[],
        data: "someData" as types.thread.ThreadData,
        keyId: "MyKeyId" as types.core.KeyId,
        keys: [],
        policy: policy,
    }));
}

function updateContext(policy: types.context.ContextPolicy) {
    return Utils.try(() => new ManagementContextApiValidator(new TypesValidator()).validate("updateContext", {
        contextId: "MyContextId" as types.context.ContextId,
        policy: policy,
    }));
}

it("ContainerPolicy.cryptoSuite is accepted on a container", () => {
    expect(threadCreate({cryptoSuite: "aes256gcm-sha256" as types.cloud.CryptoSuiteName}).success).toBe(true);
});

it("ContainerPolicy.cryptoSuite is bounded, not parsed", () => {
    // The bridge never interprets the name, so anything that fits is fine; the only job here is to stop an
    // unbounded string being stored in every container policy.
    expect(threadCreate({cryptoSuite: "whatever-clients-agree-on" as types.cloud.CryptoSuiteName}).success).toBe(true);
    expect(threadCreate({cryptoSuite: "x".repeat(65) as types.cloud.CryptoSuiteName}).success).toBe(false);
});

it("ContainerPolicy.sendCustomNotification is configurable", () => {
    expect(threadCreate({sendCustomNotification: "manager"}).success).toBe(true);
});

it("ContextPolicy.context is configurable", () => {
    expect(updateContext({context: {listUsers: "manager", sendCustomNotification: "none"}}).success).toBe(true);
});

it("ContextPolicy rejects a crypto suite, which is a tier that does not exist yet", () => {
    // Accepted by the request validator (it shares the container shape) and refused by PolicyService, so it
    // fails loudly instead of being stored where nothing reads it.
    expect(updateContext({thread: {cryptoSuite: "aes256gcm-sha256" as types.cloud.CryptoSuiteName}}).success).toBe(true);
    expect(Utils.try(() => new PolicyService().validateContextPolicy({
        thread: {cryptoSuite: "aes256gcm-sha256" as types.cloud.CryptoSuiteName},
    })).success).toBe(false);
});

it("a context kvdb policy is validated at all", () => {
    expect(Utils.try(() => new PolicyService().validateContextPolicy({kvdb: {get: "membre" as types.cloud.PolicyEntry}})).success).toBe(false);
    expect(Utils.try(() => new PolicyService().validateContextPolicy({kvdb: {get: "manager"}})).success).toBe(true);
});
