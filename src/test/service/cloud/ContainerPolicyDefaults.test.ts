/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { BasePolicy } from "../../../service/cloud/BasePolicy";
import { PolicyService } from "../../../service/cloud/PolicyService";
import * as db from "../../../db/Model";
import * as types from "../../../types";

/**
 * What a deployment that configures nothing actually gets.
 *
 * Every one of these is a default with a security consequence and no other test that would notice it changing:
 * a `forwardSecrecy` that resolves to "off" makes revocation stop biting, a `rotateKeys` that resolves to "user"
 * lets one member replace the key everybody else reads through, and a `group.listAll` of "all" hands the
 * context's membership graph to every user in it.
 */

type ContainerKind = "thread"|"store"|"inbox"|"stream"|"kvdb"|"group";

class KindPolicy extends BasePolicy<{creator: types.cloud.UserId, users: types.cloud.UserId[], managers: types.cloud.UserId[], policy?: types.cloud.ContainerPolicy}, never> {
    
    constructor(policyService: PolicyService, private kind: ContainerKind) {
        super(policyService);
    }
    
    protected isItemCreator() {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy[this.kind] || {};
    }
}

const alice = "alice" as types.cloud.UserId;
const bob = "bob" as types.cloud.UserId;

/** A context that configures nothing, so every answer comes from `DefaultContextPolicy`. */
const emptyContext = {id: "ctx", policy: {}} as unknown as db.context.Context;

const container = {creator: alice, users: [alice, bob], managers: [alice]};

/** `bob` is a plain user of the container, `alice` its manager and owner. */
function asUser(userId: types.cloud.UserId) {
    return {userId: userId} as db.context.ContextUser;
}

const containerKinds: ContainerKind[] = ["thread", "store", "inbox", "stream", "kvdb"];

for (const kind of containerKinds) {
    it(`${kind}: forward secrecy is enforced without being asked for`, async () => {
        const policy = new KindPolicy(new PolicyService(), kind);
        expect(policy.isForwardSecrecyEnforced(emptyContext, container)).toBe(true);
    });
    
    it(`${kind}: rotating the container key is a manager's call by default`, async () => {
        const policy = new KindPolicy(new PolicyService(), kind);
        expect(policy.canRotateContainerKeys(asUser(alice), emptyContext, container)).toBe(true);
        // A rotation installs the key every later read runs through, and nothing verifies the blobs are honest.
        expect(policy.canRotateContainerKeys(asUser(bob), emptyContext, container)).toBe(false);
    });
    
    it(`${kind}: an explicit "no" still turns forward secrecy off`, async () => {
        // Enforcement costs a re-key on every group rotation; a deployment is allowed to decline it, it just
        // has to say so.
        const policy = new KindPolicy(new PolicyService(), kind);
        expect(policy.isForwardSecrecyEnforced(emptyContext, {...container, policy: {forwardSecrecy: "no"}})).toBe(false);
    });
}

it("group: a roster is not listable context-wide by default", async () => {
    const policy = new KindPolicy(new PolicyService(), "group");
    // `groupList` narrows to the caller's own groups under listMy; listAll is the unnarrowed view, off unless
    // an operator asks for it.
    expect(policy.canListAllContainers(asUser(bob), emptyContext)).toBe(false);
    expect(policy.canListMyContainers(asUser(bob), emptyContext)).toBe(true);
});

it("a context may set a group policy at all", async () => {
    // The field was declared and validated but missing from the request validator, so every attempt to configure
    // it was refused and these defaults could not be overridden.
    new PolicyService().validateContextPolicy({group: {listAll: "all", get: "manager"}});
});
