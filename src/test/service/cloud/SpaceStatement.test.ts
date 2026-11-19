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
import { SpaceStatement } from "../../../service/cloud/SpaceStatement";
import { signSpaceStatement, UnsignedSpaceStatement } from "../../testUtils/SpaceFixtures";

// The vector the Endpoint holds too (`proposals/space-log-format.md`): fixed keys, fixed fields, and elliptic's
// deterministic signatures, so every byte below is reproducible.
const key = (hex: string) => new elliptic.ec("secp256k1").keyFromPrivate(hex.repeat(32), "hex");
const alice = key("11");
const group = key("22");

const unsigned: UnsignedSpaceStatement = {
    spaceId: "ab".repeat(32) as types.space.SpaceId,
    contextId: "ctx-1" as types.context.ContextId,
    seq: 2,
    prevDigest: "cd".repeat(32),
    op: "rotate",
    date: 1700000000000,
    keyVersion: 2,
    keyCommit: "ef".repeat(32),
    // Out of order on purpose: the hash sorts.
    groups: [
        {groupId: "sales" as types.group.GroupId, role: "manager", groupKeyVersion: 5, groupPubKey: ECUtils.publicToBase58DER(group) as unknown as types.cloud.GroupPubKey},
        {groupId: "billing" as types.group.GroupId, role: "user", groupKeyVersion: 1, groupPubKey: ECUtils.publicToBase58DER(alice) as unknown as types.cloud.GroupPubKey},
    ],
    users: [
        {userId: "zoe" as types.cloud.UserId, pubKey: ECUtils.publicToBase58DER(group) as types.cloud.UserPubKey, role: "user"},
        {userId: "alice" as types.cloud.UserId, pubKey: ECUtils.publicToBase58DER(alice) as types.cloud.UserPubKey, role: "manager"},
    ],
    signer: "alice" as types.cloud.UserId,
    signerPubKey: ECUtils.publicToBase58DER(alice) as types.cloud.UserPubKey,
    via: "sales" as types.group.GroupId,
};
const statement = signSpaceStatement(unsigned, alice, group);

const EXPECTED = {
    recipientsHash: "4fb2f91ff12ef35fba60b41356dcdad801e2cc0a44c47acf42d066563cce7a7c",
    signedBytes: "706d782d73706163652d73746174656d656e7400010000004061626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162000000056374782d31000000000000000200000020cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd040000018bcfe568000000000000000002efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef4fb2f91ff12ef35fba60b41356dcdad801e2cc0a44c47acf42d066563cce7a7c00000005616c696365000000323753376f59364a726a7a7138747872506d42775568556d4b7a704e36343833354537757261314844444156557671526a4a310000000573616c6573",
    signature: "G6mLHiR0fTTrDsC3Ke/uZ//1RYR40WbTjqQgaMXi5EWl/Kdmn5VvwLxr53bLfOAO3kAl3byD+sGQEfiEXasM4/4=",
    viaSignature: "G1TnXQdLHxn6nFvDK6rWIwDIni+O/xF6Vdw7uvenf/Ucnie6YGSnn65ks/MXkPIoQigIX0kTMIyGbbPtvqN/n80=",
    digest: "81cb2d7e7415da314d438d87d4d2980688f92f7acdeabba2abda5571ad01809b",
};

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

it("hashes the recipients sorted by id, each with its role, key and epoch", () => {
    const [sales, billing] = unsigned.groups;
    const [zoe, al] = unsigned.users;
    // Written out by hand from the format, not through ByteWriter.
    const expected = Crypto.sha256(Buffer.concat([
        tag("pmx-space-recipients"),
        u32(2),
        lp("billing"), lp("user"), u64(1), lp(billing.groupPubKey),
        lp("sales"), lp("manager"), u64(5), lp(sales.groupPubKey),
        u32(2),
        lp("alice"), lp(al.pubKey), lp("manager"),
        lp("zoe"), lp(zoe.pubKey), lp("user"),
    ]));
    assert.strictEqual(SpaceStatement.recipientsHash(unsigned).toString("hex"), expected.toString("hex"));
    assert.strictEqual(expected.toString("hex"), EXPECTED.recipientsHash);
    const reordered = {groups: [...unsigned.groups].reverse(), users: [...unsigned.users].reverse()};
    assert.ok(SpaceStatement.recipientsHash(reordered).equals(expected), "the order on the wire does not matter");
});

it("lays the signed bytes out as the format says", () => {
    const expected = Buffer.concat([
        tag("pmx-space-statement"),
        Buffer.from([1]),
        lp(unsigned.spaceId), lp("ctx-1"),
        u64(2),
        u32(32), Buffer.from("cd".repeat(32), "hex"),
        Buffer.from([4]),
        u64(1700000000000),
        u64(2),
        Buffer.from("ef".repeat(32), "hex"),
        SpaceStatement.recipientsHash(unsigned),
        lp("alice"), lp(unsigned.signerPubKey),
        lp("sales"),
    ]);
    assert.strictEqual(SpaceStatement.signedBytes(unsigned).toString("hex"), expected.toString("hex"));
    assert.strictEqual(expected.toString("hex"), EXPECTED.signedBytes);
    // The first statement has no predecessor: a zero length, and no bytes.
    const first = SpaceStatement.signedBytes({...unsigned, seq: 1, prevDigest: "", op: "create", via: ""});
    const at = tag("pmx-space-statement").length + 1 + lp(unsigned.spaceId).length + lp("ctx-1").length + 8;
    assert.strictEqual(first.subarray(at, at + 5).toString("hex"), "0000000001");
    assert.deepStrictEqual(SpaceStatement.OP_CODES, {create: 1, add: 2, remove: 3, rotate: 4});
});

it("signs as the author and as the group, and names a statement by all of it", () => {
    assert.strictEqual(statement.signature, EXPECTED.signature);
    assert.strictEqual(statement.viaSignature, EXPECTED.viaSignature);
    const viaBytes = Buffer.concat([tag("pmx-space-via"), Crypto.sha256(SpaceStatement.signedBytes(unsigned))]);
    assert.ok(SpaceStatement.viaBytes(unsigned).equals(viaBytes));
    const digest = Crypto.sha256(Buffer.concat([
        SpaceStatement.signedBytes(unsigned), Buffer.from(statement.signature, "base64"), Buffer.from(statement.viaSignature, "base64"),
    ])).toString("hex");
    assert.strictEqual(SpaceStatement.digest(statement), digest);
    assert.strictEqual(digest, EXPECTED.digest);
    // The group's signature is part of the name: swapped for another, the next statement no longer chains.
    assert.notStrictEqual(SpaceStatement.digest({...statement, viaSignature: statement.signature}), digest);
    assert.notStrictEqual(SpaceStatement.digest(signSpaceStatement({...unsigned, via: ""}, alice)), digest);
});

it("verifies each signature against its own key and its own bytes", () => {
    const groupPub = unsigned.groups[0].groupPubKey;
    assert.ok(SpaceStatement.verifySignature(statement));
    assert.ok(SpaceStatement.verifyViaSignature(statement, groupPub));
    // Any field changed, the author's signature no longer covers the statement - and so neither does the group's.
    for (const changed of [{seq: 3}, {keyVersion: 3}, {keyCommit: "00".repeat(32)}, {via: "billing" as types.group.GroupId}, {date: 1}, {op: "remove" as const}, {users: [unsigned.users[0]]}]) {
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

it("tells the same recipients from changed ones, whatever the order", () => {
    const reordered = {groups: [...unsigned.groups].reverse(), users: [...unsigned.users].reverse()};
    assert.ok(SpaceStatement.sameRecipients(unsigned, reordered));
    const [sales, billing] = unsigned.groups;
    for (const groups of [[sales], [{...sales, role: "user" as const}, billing], [{...sales, groupKeyVersion: 6}, billing], [{...sales, groupPubKey: billing.groupPubKey}, billing]]) {
        assert.ok(!SpaceStatement.sameRecipients({...unsigned, groups}, unsigned));
    }
    assert.ok(!SpaceStatement.sameRecipients({...unsigned, users: [unsigned.users[0], {...unsigned.users[1], role: "user"}]}, unsigned));
    // The same recipient twice is no list of recipients, even against itself.
    const twice = {groups: unsigned.groups, users: [...unsigned.users, unsigned.users[0]]};
    assert.ok(!SpaceStatement.sameRecipients(twice, twice));
});

// The same vectors the Endpoint reads (`test/fixtures/keytree/keytree-vectors.json` there, generated by its
// `reference.py`): an implementation of the format that is neither this one nor the Endpoint's.
import * as fs from "fs";
import * as path from "path";

interface SpaceVector {
    statement: UnsignedSpaceStatement;
    recipientsHashHex: string;
    signedBytesHex: string;
    viaBytesHex: string;
}

it("SpaceStatement: the signed bytes are the reference ones", () => {
    const file = path.resolve(__dirname, "../../../..", "src/test/fixtures/keytree-vectors.json");
    const vectors = (JSON.parse(fs.readFileSync(file, "utf8")) as {spaceStatement: SpaceVector[]}).spaceStatement;
    assert.strictEqual(vectors.length, 4);
    for (const vector of vectors) {
        assert.strictEqual(SpaceStatement.recipientsHash(vector.statement).toString("hex"), vector.recipientsHashHex);
        assert.strictEqual(SpaceStatement.signedBytes(vector.statement).toString("hex"), vector.signedBytesHex);
        assert.strictEqual(SpaceStatement.viaBytes(vector.statement).toString("hex"), vector.viaBytesHex);
    }
});
