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
import * as elliptic from "elliptic";
import * as types from "../../../types";
import { Crypto } from "../../../utils/crypto/Crypto";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { Roster, SpaceStatement } from "../../../service/cloud/SpaceStatement";
import { signSpaceStatement, UnsignedSpaceStatement } from "../../testUtils/SpaceFixtures";

const key = (hex: string) => new elliptic.ec("secp256k1").keyFromPrivate(hex.repeat(32), "hex");
const alice = key("11");
const group = key("22");
const pub = (k: elliptic.ec.KeyPair) => ECUtils.publicToBase58DER(k);

// The roster before the statement below. Out of order on purpose: the hash sorts.
const sales = {groupId: "sales" as types.group.GroupId, role: "manager" as const, groupKeyVersion: 5, groupPubKey: pub(group) as unknown as types.cloud.GroupPubKey};
const billing = {groupId: "billing" as types.group.GroupId, role: "user" as const, groupKeyVersion: 1, groupPubKey: pub(alice) as unknown as types.cloud.GroupPubKey};
const zoe = {userId: "zoe" as types.cloud.UserId, pubKey: pub(group) as types.cloud.UserPubKey, role: "user" as const};
const al = {userId: "alice" as types.cloud.UserId, pubKey: pub(alice) as types.cloud.UserPubKey, role: "manager" as const};
const prior: Roster = {groups: [sales, billing], users: [zoe, al]};
const refreshed = {groupId: billing.groupId, groupKeyVersion: 2, groupPubKey: pub(key("33")) as unknown as types.cloud.GroupPubKey};
const after: Roster = {groups: [sales, {...billing, groupKeyVersion: 2, groupPubKey: refreshed.groupPubKey}], users: [zoe, al]};

type Deltas = Pick<UnsignedSpaceStatement, "addedGroups"|"addedUsers"|"removedGroups"|"removedUsers"|"refreshedGroups">;
const none: Deltas = {addedGroups: [], addedUsers: [], removedGroups: [], removedUsers: [], refreshedGroups: []};
const unsigned: UnsignedSpaceStatement = {
    spaceId: "ab".repeat(32) as types.space.SpaceId,
    contextId: "ctx-1" as types.context.ContextId,
    seq: 2,
    prevDigest: "cd".repeat(32),
    op: "rotate",
    date: 1700000000000,
    keyVersion: 2,
    keyCommit: "ef".repeat(32),
    ...none,
    refreshedGroups: [refreshed],
    rosterHash: SpaceStatement.rosterHash(after).toString("hex"),
    signer: "alice" as types.cloud.UserId,
    signerPubKey: pub(alice) as types.cloud.UserPubKey,
    via: "sales" as types.group.GroupId,
};
const statement = signSpaceStatement(unsigned, alice, group);

const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
};
const u64 = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(n));
    return b;
};
const lp = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
const tag = (s: string) => Buffer.from(s + "\0");

it("hashes the whole roster sorted by id, with the counts, each recipient with its role, key and epoch", () => {
    // Written out by hand from the format, not through ByteWriter.
    const expected = Crypto.sha256(Buffer.concat([
        tag("pmx-space-roster-v1"),
        u32(2),
        lp("billing"), lp("user"), u64(1), lp(billing.groupPubKey),
        lp("sales"), lp("manager"), u64(5), lp(sales.groupPubKey),
        u32(2),
        lp("alice"), lp(al.pubKey), lp("manager"),
        lp("zoe"), lp(zoe.pubKey), lp("user"),
    ]));
    assert.strictEqual(SpaceStatement.rosterHash(prior).toString("hex"), expected.toString("hex"));
    const reordered = {groups: [...prior.groups].reverse(), users: [...prior.users].reverse()};
    assert.ok(SpaceStatement.rosterHash(reordered).equals(expected), "the order on the wire does not matter");
});

it("lays the signed bytes out as the format says, every delta list sorted", () => {
    const st: UnsignedSpaceStatement = {
        ...unsigned, op: "remove", keyVersion: 3,
        removedGroups: ["zz" as types.group.GroupId, "Aa" as types.group.GroupId], removedUsers: ["bob" as types.cloud.UserId],
        addedGroups: [sales, billing], addedUsers: [zoe, al],
    };
    const expected = Buffer.concat([
        tag("pmx-space-statement"),
        Buffer.from([2]),
        lp(unsigned.spaceId), lp("ctx-1"),
        u64(2),
        u32(32), Buffer.from("cd".repeat(32), "hex"),
        Buffer.from([3]),
        u64(1700000000000),
        u64(3),
        Buffer.from("ef".repeat(32), "hex"),
        Buffer.from(unsigned.rosterHash, "hex"),
        u32(2), lp("billing"), lp("user"), u64(1), lp(billing.groupPubKey), lp("sales"), lp("manager"), u64(5), lp(sales.groupPubKey),
        u32(2), lp("alice"), lp(al.pubKey), lp("manager"), lp("zoe"), lp(zoe.pubKey), lp("user"),
        u32(2), lp("Aa"), lp("zz"),
        u32(1), lp("bob"),
        u32(1), lp("billing"), u64(2), lp(refreshed.groupPubKey),
        lp("alice"), lp(unsigned.signerPubKey),
        lp("sales"),
    ]);
    assert.strictEqual(SpaceStatement.signedBytes(st).toString("hex"), expected.toString("hex"));
    // The first statement has no predecessor: a zero length, and no bytes.
    const first = SpaceStatement.signedBytes({...unsigned, seq: 1, prevDigest: "", op: "create", via: ""});
    const at = tag("pmx-space-statement").length + 1 + lp(unsigned.spaceId).length + lp("ctx-1").length + 8;
    assert.strictEqual(first.subarray(at, at + 5).toString("hex"), "0000000001");
    assert.deepStrictEqual(SpaceStatement.OP_CODES, {create: 1, add: 2, remove: 3, rotate: 4});
});

it("signs as the author and as the group, and names a statement by all of it", () => {
    const viaBytes = Buffer.concat([tag("pmx-space-via"), Crypto.sha256(SpaceStatement.signedBytes(unsigned))]);
    assert.ok(SpaceStatement.viaBytes(unsigned).equals(viaBytes));
    const digest = Crypto.sha256(Buffer.concat([
        SpaceStatement.signedBytes(unsigned), Buffer.from(statement.signature, "base64"), Buffer.from(statement.viaSignature, "base64"),
    ])).toString("hex");
    assert.strictEqual(SpaceStatement.digest(statement), digest);
    // The group's signature is part of the name: swapped for another, the next statement no longer chains.
    assert.notStrictEqual(SpaceStatement.digest({...statement, viaSignature: statement.signature}), digest);
    assert.notStrictEqual(SpaceStatement.digest(signSpaceStatement({...unsigned, via: ""}, alice)), digest);
});

it("verifies each signature against its own key and its own bytes", () => {
    const groupPub = sales.groupPubKey;
    assert.ok(SpaceStatement.verifySignature(statement));
    assert.ok(SpaceStatement.verifyViaSignature(statement, groupPub));
    // Any field changed, the author's signature no longer covers the statement - and so neither does the group's.
    for (const changed of [
        {seq: 3}, {keyVersion: 3}, {keyCommit: "00".repeat(32)}, {via: "billing" as types.group.GroupId}, {date: 1}, {op: "remove" as const},
        {rosterHash: "00".repeat(32)}, {refreshedGroups: []}, {removedUsers: [zoe.userId]}, {addedUsers: [zoe]}, {removedGroups: [sales.groupId]}, {addedGroups: [sales]},
    ]) {
        assert.ok(!SpaceStatement.verifySignature({...statement, ...changed}), JSON.stringify(changed));
        assert.ok(!SpaceStatement.verifyViaSignature({...statement, ...changed}, groupPub), JSON.stringify(changed));
    }
    // The author's signature is not the group's, nor the other way round; nor does another key's count.
    assert.ok(!SpaceStatement.verifyViaSignature({...statement, viaSignature: statement.signature}, groupPub));
    assert.ok(!SpaceStatement.verifySignature({...statement, signature: statement.viaSignature as types.core.Base64}));
    assert.ok(!SpaceStatement.verifyViaSignature(statement, unsigned.signerPubKey as unknown as types.cloud.GroupPubKey));
    assert.ok(!SpaceStatement.verifySignature(signSpaceStatement(unsigned, group, group)));
    // A header byte the native Endpoint does not verify is refused here too; so is no signature at all.
    const header = Buffer.from(statement.signature, "base64");
    header[0] = 43;
    assert.ok(!SpaceStatement.verifySignature({...statement, signature: header.toString("base64") as types.core.Base64}));
    assert.ok(!SpaceStatement.verifyViaSignature({...statement, viaSignature: ""}, groupPub));
});

it("hashes a changed roster differently", () => {
    const hash = (r: Roster) => SpaceStatement.rosterHash(r).toString("hex");
    for (const groups of [[sales], [{...sales, role: "user" as const}, billing], [{...sales, groupKeyVersion: 6}, billing], [{...sales, groupPubKey: billing.groupPubKey}, billing]]) {
        assert.notStrictEqual(hash({...prior, groups}), hash(prior));
    }
    assert.notStrictEqual(hash({...prior, users: [zoe, {...al, role: "user"}]}), hash(prior));
});

it("applies deltas: removes, refreshes in place, appends the added", () => {
    const applied = SpaceStatement.applyDeltas(prior, unsigned);
    assert.ok(typeof(applied) !== "string" && SpaceStatement.rosterHash(applied).equals(SpaceStatement.rosterHash(after)));
    const dave = {userId: "dave" as types.cloud.UserId, pubKey: zoe.pubKey, role: "user" as const};
    const changed = SpaceStatement.applyDeltas(prior, {...none, removedGroups: [sales.groupId], removedUsers: [zoe.userId], addedUsers: [dave]});
    assert.deepStrictEqual(changed, {groups: [billing], users: [al, dave]});
});

it("refuses deltas that do not apply cleanly", () => {
    const other = {...billing, groupId: "other" as types.group.GroupId};
    const cases: [string, Partial<Deltas>][] = [
        ["adds a present group", {addedGroups: [billing]}],
        ["adds a present user", {addedUsers: [zoe]}],
        ["removes an absent group", {removedGroups: [other.groupId]}],
        ["removes an absent user", {removedUsers: ["dave" as types.cloud.UserId]}],
        ["refreshes a non-recipient", {refreshedGroups: [{...refreshed, groupId: other.groupId}]}],
        ["refreshes to the same epoch", {refreshedGroups: [{...refreshed, groupKeyVersion: 1}]}],
        ["refreshes to an older epoch", {refreshedGroups: [{...refreshed, groupId: sales.groupId, groupKeyVersion: 4}]}],
        ["refreshes to the key held", {refreshedGroups: [{...refreshed, groupPubKey: billing.groupPubKey}]}],
        ["adds a group twice", {addedGroups: [other, other]}],
        ["removes a user twice", {removedUsers: [zoe.userId, zoe.userId]}],
        ["refreshes a group twice", {refreshedGroups: [refreshed, refreshed]}],
        ["removes and refreshes one group", {removedGroups: [billing.groupId], refreshedGroups: [refreshed]}],
        ["removes and re-adds one user", {removedUsers: [zoe.userId], addedUsers: [zoe]}],
        ["leaves no manager", {removedGroups: [sales.groupId], removedUsers: [al.userId]}],
    ];
    for (const [what, deltas] of cases) {
        assert.strictEqual(typeof(SpaceStatement.applyDeltas(prior, {...none, ...deltas})), "string", what);
    }
});

it("holds each op to the deltas it may carry", () => {
    const add = {addedUsers: [zoe]};
    const remove = {removedUsers: [zoe.userId]};
    const refresh = {refreshedGroups: [refreshed]};
    const ok: [types.cloud.SpaceStatementOp, Partial<Deltas>][] = [
        ["create", add], ["add", add], ["remove", remove], ["remove", {...remove, ...refresh}], ["rotate", refresh], ["rotate", {}],
    ];
    const bad: [types.cloud.SpaceStatementOp, Partial<Deltas>][] = [
        ["create", {}], ["create", {...add, ...refresh}], ["create", {...add, ...remove}],
        ["add", {}], ["add", {...add, ...refresh}], ["add", {...add, ...remove}],
        ["remove", {}], ["remove", {...remove, ...add}], ["remove", refresh],
        ["rotate", add], ["rotate", remove],
    ];
    for (const [op, deltas] of ok) {
        assert.strictEqual(SpaceStatement.opProblem({...none, ...deltas, op}), undefined, op + JSON.stringify(deltas));
    }
    for (const [op, deltas] of bad) {
        assert.notStrictEqual(SpaceStatement.opProblem({...none, ...deltas, op}), undefined, op + JSON.stringify(deltas));
    }
});

// The same vectors the Endpoint reads (`test/fixtures/keytree/keytree-vectors.json` there, generated by its
// `reference.py`): an implementation of the format that is neither this one nor the Endpoint's. They are a chain:
// each statement's deltas apply to the roster the ones before it left.
import * as fs from "fs";
import * as path from "path";

interface SpaceVector {
    statement: UnsignedSpaceStatement;
    rosterHashHex: string;
    signedBytesHex: string;
    signedBytesSha256Hex: string;
    viaBytesHex: string;
}

it("SpaceStatement: the roster hashes and signed bytes are the reference ones", () => {
    const file = path.resolve(__dirname, "../../../..", "src/test/fixtures/keytree-vectors.json");
    const vectors = (JSON.parse(fs.readFileSync(file, "utf8")) as {spaceStatement: SpaceVector[]}).spaceStatement;
    assert.deepStrictEqual(vectors.map(v => v.statement.op), ["create", "rotate", "remove", "add"]);
    let roster: Roster = {groups: [], users: []};
    for (const vector of vectors) {
        assert.strictEqual(SpaceStatement.opProblem(vector.statement), undefined);
        const applied = SpaceStatement.applyDeltas(roster, vector.statement);
        if (typeof(applied) === "string") {
            assert.fail(applied);
        }
        roster = applied;
        assert.strictEqual(SpaceStatement.rosterHash(roster).toString("hex"), vector.rosterHashHex);
        assert.strictEqual(vector.statement.rosterHash, vector.rosterHashHex);
        const signed = SpaceStatement.signedBytes(vector.statement);
        assert.strictEqual(signed.toString("hex"), vector.signedBytesHex);
        assert.strictEqual(Crypto.sha256(signed).toString("hex"), vector.signedBytesSha256Hex);
        assert.strictEqual(SpaceStatement.viaBytes(vector.statement).toString("hex"), vector.viaBytesHex);
    }
});
