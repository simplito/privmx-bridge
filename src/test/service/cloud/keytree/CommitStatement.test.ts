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
import * as types from "../../../../types";
import { CommitStatement, ExpectedStatement } from "../../../../service/cloud/keytree/CommitStatement";
import { TreeHash } from "../../../../service/cloud/keytree/TreeHash";
import { ECUtils } from "../../../../utils/crypto/ECUtils";
import { Crypto } from "../../../../utils/crypto/Crypto";
import { buildTree, planCommit, signStatement, statementFor, userKeys } from "../../../testUtils/TreeFixtures";

/**
 * The bridge's check of a commit statement: every field against what the bridge derived, then the signature.
 * Each field is mutated on its own, so a regression names which one stopped being checked.
 */

const NOW = 1_760_000_000_000;
const GROUP_PUB = userKeys("grant-key").pub58 as unknown as types.cloud.GroupPubKey;
const NEXT_GROUP_PUB = userKeys("next-grant-key").pub58 as unknown as types.cloud.GroupPubKey;
const SEATS = Array.from({length: 64}, (_, i) => `u${i}`);
const BASE = buildTree(SEATS, 5);

/** u0 removes u40: the statement an honest u0 signs, and what the bridge expects of it. */
function honest() {
    const plan = planCommit(BASE, 5, {kind: "remove", committer: "u0", removed: ["u40"]});
    const users = SEATS.filter(u => u !== "u40");
    const statement = statementFor(plan, {kind: "remove", committer: "u0", removed: ["u40"]},
        {groupId: "grp", groupPubKey: NEXT_GROUP_PUB, rosterVersion: 8, users, managers: [], date: NOW});
    const expected: ExpectedStatement = {
        seq: 2,
        op: "remove",
        groupId: "grp",
        treeVersion: 2,
        keyVersion: 6,
        groupPubKey: NEXT_GROUP_PUB,
        rosterVersion: 8,
        rosterHash: TreeHash.rosterHash(users, []),
        treeHash: TreeHash.treeHash(TreeHash.of(plan.after)),
        committer: "u0" as types.cloud.UserId,
        committerPubKey: userKeys("u0").pub58,
        committerSeat: 0,
        path: plan.refreshedNodes,
        addedUsers: [],
        addedManagers: [],
        removed: ["u40" as types.cloud.UserId],
    };
    return {statement, expected};
}

function check(statement: types.cloud.GroupTreeCommitStatement, expected: ExpectedStatement, now = NOW) {
    return CommitStatement.validate(statement, expected, now);
}

describe("CommitStatement signature", () => {
    it("round trip: signToCompactSignature over sha256(SB) verifies with verifySignature2", () => {
        // Pins the exact format the endpoint produces with `signToCompactSignatureWithHash(SB)`: 65 bytes,
        // recovery byte first, base64 on the wire.
        const {keyPair, pub58} = userKeys("signer");
        const {statement} = honest();
        const unsigned: Omit<types.cloud.GroupTreeCommitStatement, "signature"> & {signature?: unknown} = {...statement, committerPubKey: pub58};
        delete unsigned.signature;
        const signature = ECUtils.signToCompactSignature(keyPair, Crypto.sha256(CommitStatement.signedBytes(unsigned)));
        assert.strictEqual(signature.length, 65);
        assert.ok([27, 28, 29, 30].includes(signature[0]));
        const signed = {...unsigned, signature: signature.toString("base64") as types.core.EccSignature};
        assert.strictEqual(ECUtils.verifySignature2(pub58 as unknown as types.core.EccPubKey, signed.signature, Crypto.sha256(CommitStatement.signedBytes(signed))), true);
        assert.strictEqual(CommitStatement.verifySignature(signed), true);
    });
    
    it("a signature over any other digest of the bytes does not verify", () => {
        const {keyPair, pub58} = userKeys("signer");
        const statement = {...honest().statement, committerPubKey: pub58};
        const doubleHashed = Crypto.sha256(Crypto.sha256(CommitStatement.signedBytes(statement)));
        const raw = ECUtils.signToCompactSignature(keyPair, doubleHashed).toString("base64") as types.core.EccSignature;
        assert.strictEqual(CommitStatement.verifySignature({...statement, signature: raw}), false);
    });
    
    it("garbage in the signature or the key is a failed verification, not an exception", () => {
        const {statement} = honest();
        assert.strictEqual(CommitStatement.verifySignature({...statement, signature: "AAAA" as types.core.EccSignature}), false);
        assert.strictEqual(CommitStatement.verifySignature({...statement, committerPubKey: "notAKey" as types.cloud.UserPubKey}), false);
    });
});

describe("CommitStatement.validate", () => {
    it("accepts an honest statement", () => {
        const {statement, expected} = honest();
        assert.deepStrictEqual(check(statement, expected), []);
    });
    
    it("SECURITY: refuses a statement signed by anyone but the committer", () => {
        const {statement, expected} = honest();
        // The statement must name the caller's current key, and is verified with that key.
        assert.deepStrictEqual(check(statement, {...expected, committerPubKey: userKeys("u1").pub58}), [{kind: "BAD_COMMIT_STATEMENT", field: "committerPubKey"}]);
        const forged = signStatement({...statement}, "u1");
        assert.deepStrictEqual(check(forged, expected), [{kind: "BAD_COMMIT_SIGNATURE"}]);
    });
    
    it("SECURITY: refuses a statement altered after signing", () => {
        const {statement, expected} = honest();
        // Same fields the bridge expects, but not the ones that were signed.
        const resigned = signStatement({...statement, date: NOW + 1});
        assert.deepStrictEqual(check({...resigned, date: NOW}, expected), [{kind: "BAD_COMMIT_SIGNATURE"}]);
    });
    
    const mutations: [string, (cs: types.cloud.GroupTreeCommitStatement) => types.cloud.GroupTreeCommitStatement][] = [
        ["seq", cs => ({...cs, seq: cs.seq + 1})],
        ["op", cs => ({...cs, op: "selfUpdate"})],
        ["groupId", cs => ({...cs, groupId: "other"})],
        ["treeVersion", cs => ({...cs, treeVersion: 1})],
        ["keyVersion", cs => ({...cs, keyVersion: 5})],
        ["groupPubKey", cs => ({...cs, groupPubKey: GROUP_PUB})],
        ["rosterVersion", cs => ({...cs, rosterVersion: 7})],
        ["rosterHash", cs => ({...cs, rosterHash: TreeHash.rosterHash(SEATS, []).toString("hex")})],
        ["rosterHash", cs => ({...cs, rosterHash: cs.rosterHash.toUpperCase()})],
        ["treeHash", cs => ({...cs, treeHash: TreeHash.treeHash(TreeHash.of(BASE)).toString("hex")})],
        ["committer", cs => ({...cs, committer: "u1" as types.cloud.UserId})],
        ["committerPubKey", cs => ({...cs, committerPubKey: userKeys("u1").pub58})],
        ["committerSeat", cs => ({...cs, committerSeat: 1})],
        ["path", cs => ({...cs, path: cs.path.slice(1)})],
        ["path", cs => ({...cs, path: [...cs.path].reverse()})],
        ["path", cs => ({...cs, path: cs.path.map((e, i) => i === 0 ? {...e, generation: e.generation + 1} : e)})],
        ["path", cs => ({...cs, path: cs.path.map((e, i) => i === 0 ? {...e, publicKey: GROUP_PUB as unknown as types.core.EccPubKey} : e)})],
        ["addedUsers", cs => ({...cs, addedUsers: ["u40" as types.cloud.UserId]})],
        ["addedManagers", cs => ({...cs, addedManagers: ["u40" as types.cloud.UserId]})],
        ["removed", cs => ({...cs, removed: []})],
        ["removed", cs => ({...cs, removed: ["u40", "u40"] as types.cloud.UserId[]})],
        ["date", cs => ({...cs, date: NOW - CommitStatement.DATE_TOLERANCE_MS - 1})],
        ["date", cs => ({...cs, date: NOW + CommitStatement.DATE_TOLERANCE_MS + 1})],
    ];
    each<[string, (cs: types.cloud.GroupTreeCommitStatement) => types.cloud.GroupTreeCommitStatement]>(mutations).it("refuses a wrong %s", ([field, mutate]) => {
        const {statement, expected} = honest();
        // Re-signed after the change, so it is the field check that refuses it, not the signature.
        assert.deepStrictEqual(check(signStatement(mutate(statement), "u0"), expected), [{kind: "BAD_COMMIT_STATEMENT", field}]);
    });
    
    it("a date inside the tolerance is fine either way", () => {
        const {statement, expected} = honest();
        assert.deepStrictEqual(check(statement, expected, NOW + CommitStatement.DATE_TOLERANCE_MS), []);
        assert.deepStrictEqual(check(statement, expected, NOW - CommitStatement.DATE_TOLERANCE_MS), []);
    });
    
    it("roster lists must arrive sorted, as signed", () => {
        const {expected} = honest();
        const plan = planCommit(BASE, 5, {kind: "add", committer: "u0", members: ["zed", "amy"], positions: [64, 65]});
        const statement = statementFor(plan, {kind: "add", committer: "u0", members: ["zed", "amy"], positions: [64, 65]},
            {groupId: "grp", groupPubKey: GROUP_PUB, rosterVersion: 8, users: [...SEATS, "zed", "amy"], managers: [], date: NOW});
        assert.deepStrictEqual(statement.addedUsers, ["amy", "zed"]);
        const unsorted = signStatement({...statement, addedUsers: ["zed", "amy"] as types.cloud.UserId[]});
        const kinds = check(unsorted, {...expected, op: "add", addedUsers: ["zed", "amy"] as types.cloud.UserId[]});
        assert.ok(kinds.some(p => p.kind === "BAD_COMMIT_STATEMENT" && p.field === "addedUsers"));
    });
});

describe("CommitStatement.checkStoredState", () => {
    const roster = {users: SEATS, managers: [] as string[]};
    
    /** u0 creates the group (statement 1), u40 self-updates (statement 2): what storage holds afterwards. */
    function stored() {
        const created = planCommit({numLeaves: 64, leafAssignment: SEATS as types.cloud.UserId[], nodes: [], edges: []}, 0, {kind: "create", committer: "u0"}, 1);
        const create = statementFor(created, {kind: "create", committer: "u0"}, {groupId: "8b3f4c2e-1d5a-4e6b-9c7d-0a1b2c3d4e5f", groupPubKey: GROUP_PUB, rosterVersion: 1, ...roster});
        const update = planCommit(created.after, 1, {kind: "selfUpdate", committer: "u40"}, 2);
        const second = statementFor(update, {kind: "selfUpdate", committer: "u40"}, {groupId: "grp", groupPubKey: GROUP_PUB, rosterVersion: 1, ...roster});
        return {
            group: {treeCommitSeq: 2, keyVersion: 1, groupPubKey: GROUP_PUB, rosterVersion: 1, ...roster},
            tree: update.after,
            statements: new Map([[1, create], [2, second]]),
        };
    }
    
    it("a consistent state has no problems", () => {
        const {group, tree, statements} = stored();
        assert.deepStrictEqual(CommitStatement.checkStoredState(group, tree, statements), []);
    });
    
    it("finds a tree that no longer hashes to the latest statement, and a record nobody vouched for", () => {
        const {group, tree, statements} = stored();
        const tampered = {...tree, nodes: tree.nodes.map(n => n.nodeIndex === 31 ? {...n, publicKey: GROUP_PUB as unknown as types.core.EccPubKey} : n)};
        const problems = CommitStatement.checkStoredState(group, tampered, statements);
        assert.ok(problems.some(p => p.includes("treeHash")));
        assert.ok(problems.some(p => p.includes("node 31")));
    });
    
    it("SECURITY: finds a stored statement not signed by the key it names, without looking up anyone's current key", () => {
        const {group, tree, statements} = stored();
        statements.set(1, signStatement({...statements.get(1)!}, "u1"));
        assert.deepStrictEqual(CommitStatement.checkStoredState(group, tree, statements), ["statement 1 is not signed by the key it names"]);
    });
    
    it("finds a missing latest statement, and a roster that moved under it", () => {
        const {group, tree, statements} = stored();
        assert.deepStrictEqual(CommitStatement.checkStoredState({...group, treeCommitSeq: 3}, tree, statements), ["no statement at treeCommitSeq 3"]);
        assert.ok(CommitStatement.checkStoredState({...group, users: [...SEATS, "outsider"]}, tree, statements).some(p => p.includes("rosterHash")));
    });
});
