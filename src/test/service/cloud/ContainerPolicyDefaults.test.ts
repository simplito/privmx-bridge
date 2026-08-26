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
import { AppException } from "../../../api/AppException";

/**
 * What a deployment that configures nothing actually gets.
 *
 * Each of these defaults has a security consequence and no other test that would notice it changing. Two of them
 * are deliberate trade-offs rather than the safe choice, and are pinned here so they stay deliberate:
 * `forwardSecrecy` is off, so removal from a grantee group does not by itself stop the departed member reading
 * new writes; `rotateKeys` is wider than `update`, so any member can replace the container key.
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
    it(`${kind}: forward secrecy stays off until a deployment asks for it`, async () => {
        // Backwards compatibility: turning this on refuses writes to containers whose grantee group has rotated,
        // and an existing deployment's clients do not re-key on `staleGroups` yet. So a removal revokes the
        // group and not the containers granted to it — the departed member reads on until somebody rotates.
        const policy = new KindPolicy(new PolicyService(), kind);
        expect(policy.isForwardSecrecyEnforced(emptyContext, container)).toBe(false);
    });
    
    it(`${kind}: a context or container can turn forward secrecy on`, async () => {
        const policy = new KindPolicy(new PolicyService(), kind);
        expect(policy.isForwardSecrecyEnforced(emptyContext, {...container, policy: {forwardSecrecy: "yes"}})).toBe(true);
        const enforcingContext = {id: "ctx", policy: {[kind]: {forwardSecrecy: "yes"}}} as unknown as db.context.Context;
        expect(policy.isForwardSecrecyEnforced(enforcingContext, container)).toBe(true);
    });
    
    it(`${kind}: any member can re-key, which is what clears a stale grant`, async () => {
        // Deliberately wider than `update`. Where forward secrecy *is* enabled, a grantee group that rotates
        // makes every write fail until the container is re-keyed — so if this were manager-only, a plain member
        // hitting CONTAINER_GROUP_EPOCH_OUTDATED could do nothing but wait for a manager. What it trades away
        // is that one member can install a key the others cannot open; that is visible immediately and any
        // manager can rotate past it, where the deadlock would be routine.
        const policy = new KindPolicy(new PolicyService(), kind);
        expect(policy.canRotateContainerKeys(asUser(alice), emptyContext, container)).toBe(true);
        expect(policy.canRotateContainerKeys(asUser(bob), emptyContext, container)).toBe(true);
        // Still not an outsider's call.
        expect(policy.canRotateContainerKeys(asUser("carol" as types.cloud.UserId), emptyContext, container)).toBe(false);
    });
    
    it(`${kind}: an unrecognised rotateKeys value is refused instead of resolving to nobody`, async () => {
        // The entry the escape hatch runs through, so a typo in it must not silently wedge the container.
        try {
            new PolicyService().validateContainerPolicyForContainer(`policy.${kind}`, {rotateKeys: "membre" as types.cloud.PolicyEntry});
        }
        catch (e) {
            expect(AppException.is(e, "INVALID_PARAMS")).toBe(true);
            return;
        }
        expect(true).toBeFalsy();
    });
    
    it(`${kind}: one container can decline what its context enforces`, async () => {
        const policy = new KindPolicy(new PolicyService(), kind);
        const enforcingContext = {id: "ctx", policy: {[kind]: {forwardSecrecy: "yes"}}} as unknown as db.context.Context;
        expect(policy.isForwardSecrecyEnforced(enforcingContext, {...container, policy: {forwardSecrecy: "no"}})).toBe(false);
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
