/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../../types";
import { GroupMembershipSignature, GroupSignaturePayload } from "../../../service/cloud/GroupMembershipSignature";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { Base64 } from "../../../utils/Base64";

const author = "janek" as types.cloud.UserId;
const contextId = "ctx-1" as types.context.ContextId;
const keyId = "key-1" as types.core.KeyId;

function newSigner() {
    const {keyPair, pub58} = ECUtils.generateKeyPair();
    const sign = (payload: GroupSignaturePayload) =>
        Base64.from(ECUtils.signToCompactSignature(keyPair, GroupMembershipSignature.digest(payload))) as types.core.EccSignature;
    return {pub58, sign};
}

function createPayload(pub58: types.core.EccPubKey, overrides: Partial<GroupSignaturePayload> = {}): GroupSignaturePayload {
    return {
        op: "create",
        contextId: contextId,
        author: author,
        authorPubKey: pub58 as types.cloud.UserPubKey,
        groupPubKey: pub58 as types.cloud.GroupPubKey,
        keyId: keyId,
        prevSignature: null,
        resultUsers: ["a", "b"] as types.cloud.UserId[],
        resultManagers: ["a"] as types.cloud.UserId[],
        ...overrides,
    };
}

it("verifies a valid create signature", () => {
    const {pub58, sign} = newSigner();
    const payload = createPayload(pub58);
    const signature = sign(payload);
    expect(GroupMembershipSignature.verify(signature, payload)).toBe(true);
});

it("verifies valid update and modifyMembers signatures", () => {
    const {pub58, sign} = newSigner();
    const prev = "AAAA" as types.core.EccSignature;
    const update = createPayload(pub58, {op: "update", prevSignature: prev});
    expect(GroupMembershipSignature.verify(sign(update), update)).toBe(true);
    
    const modify = createPayload(pub58, {
        op: "modifyMembers",
        prevSignature: prev,
        resultUsers: ["a", "b", "c"] as types.cloud.UserId[],
        delta: {
            usersAdded: ["c"] as types.cloud.UserId[],
            usersRemoved: [] as types.cloud.UserId[],
            managersAdded: [] as types.cloud.UserId[],
            managersRemoved: [] as types.cloud.UserId[],
        },
    });
    expect(GroupMembershipSignature.verify(sign(modify), modify)).toBe(true);
});

it("rejects a signature from a different key", () => {
    const a = newSigner();
    const b = newSigner();
    const payload = createPayload(a.pub58);
    // signed by b but payload claims a as author key
    expect(GroupMembershipSignature.verify(b.sign(payload), payload)).toBe(false);
});

it("rejects when the member set is tampered after signing", () => {
    const {pub58, sign} = newSigner();
    const payload = createPayload(pub58);
    const signature = sign(payload);
    const tampered = {...payload, resultUsers: ["a", "b", "evil"] as types.cloud.UserId[]};
    expect(GroupMembershipSignature.verify(signature, tampered)).toBe(false);
});

it("rejects when prevSignature is tampered (chain binding)", () => {
    const {pub58, sign} = newSigner();
    const payload = createPayload(pub58, {op: "update", prevSignature: "GOOD" as types.core.EccSignature});
    const signature = sign(payload);
    const tampered = {...payload, prevSignature: "OTHER" as types.core.EccSignature};
    expect(GroupMembershipSignature.verify(signature, tampered)).toBe(false);
});

it("is independent of member list ordering (canonical sorting)", () => {
    const {pub58} = newSigner();
    const p1 = createPayload(pub58, {resultUsers: ["a", "b", "c"] as types.cloud.UserId[]});
    const p2 = createPayload(pub58, {resultUsers: ["c", "a", "b"] as types.cloud.UserId[]});
    expect(GroupMembershipSignature.digest(p1).toString("hex")).toBe(GroupMembershipSignature.digest(p2).toString("hex"));
});

it("binds the delta for modifyMembers (different delta -> different digest)", () => {
    const {pub58} = newSigner();
    const base = createPayload(pub58, {op: "modifyMembers", prevSignature: "P" as types.core.EccSignature});
    const d1 = {...base, delta: {usersAdded: ["c"] as types.cloud.UserId[], usersRemoved: [] as types.cloud.UserId[], managersAdded: [] as types.cloud.UserId[], managersRemoved: [] as types.cloud.UserId[]}};
    const d2 = {...base, delta: {usersAdded: [] as types.cloud.UserId[], usersRemoved: ["c"] as types.cloud.UserId[], managersAdded: [] as types.cloud.UserId[], managersRemoved: [] as types.cloud.UserId[]}};
    expect(GroupMembershipSignature.digest(d1).toString("hex")).not.toBe(GroupMembershipSignature.digest(d2).toString("hex"));
});

it("binds the op (create vs update -> different digest)", () => {
    const {pub58} = newSigner();
    const create = createPayload(pub58, {op: "create"});
    const update = createPayload(pub58, {op: "update"});
    expect(GroupMembershipSignature.digest(create).toString("hex")).not.toBe(GroupMembershipSignature.digest(update).toString("hex"));
});

it("binds contextId, groupPubKey and keyId", () => {
    const {pub58} = newSigner();
    const base = createPayload(pub58);
    const otherCtx = {...base, contextId: "ctx-2" as types.context.ContextId};
    const otherKey = {...base, keyId: "key-2" as types.core.KeyId};
    const baseDigest = GroupMembershipSignature.digest(base).toString("hex");
    expect(GroupMembershipSignature.digest(otherCtx).toString("hex")).not.toBe(baseDigest);
    expect(GroupMembershipSignature.digest(otherKey).toString("hex")).not.toBe(baseDigest);
});
