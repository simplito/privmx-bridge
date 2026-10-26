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
import * as fs from "fs";
import * as path from "path";
import * as types from "../../../../types";
import { CommitStatement, ExpectedStatement } from "../../../../service/cloud/keytree/CommitStatement";
import { TreeHash } from "../../../../service/cloud/keytree/TreeHash";
import { TreeMath } from "../../../../service/cloud/keytree/TreeMath";
import { ECUtils } from "../../../../utils/crypto/ECUtils";
import { Crypto } from "../../../../utils/crypto/Crypto";
import { buildTree, creationStatement, planCommit, policyStatement, signStatement, statementFor, userKeys } from "../../../testUtils/TreeFixtures";

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
    const previous = creationStatement(BASE, "u0", {groupId: "res", groupPubKey: GROUP_PUB, users: SEATS, managers: [], date: NOW - 1});
    const statement = statementFor(plan, {kind: "remove", committer: "u0", removed: ["u40"]},
        {groupId: "grp", groupPubKey: NEXT_GROUP_PUB, rosterVersion: 8, users, managers: [], date: NOW, previous});
    const expected: ExpectedStatement = {
        seq: 2,
        prevDigest: CommitStatement.digest(previous),
        notBefore: previous.date,
        op: "remove",
        groupId: "grp",
        treeVersion: TreeMath.TREE_VERSION,
        keyVersion: 6,
        groupPubKey: NEXT_GROUP_PUB,
        rosterVersion: 8,
        rosterHash: TreeHash.rosterHash(users, []),
        policyHash: CommitStatement.policyHash({}, "u0" as types.cloud.UserId),
        tree: TreeHash.of(plan.after),
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
    
    // H1: the native Endpoint throws on a header outside 27..42, so storing one would freeze the group for it.
    each<[number, boolean]>([[0, false], [26, false], [27, true], [30, true], [31, true], [42, true], [43, false], [255, false]])
        .it("SECURITY: a valid r||s under header %s verifies: %s", ([header, ok]) => {
            const {statement} = honest();
            assert.strictEqual(CommitStatement.verifySignature(statement), true);
            const sig = Buffer.from(statement.signature, "base64");
            sig[0] = header;
            const relabelled = {...statement, signature: sig.toString("base64") as types.core.EccSignature};
            assert.strictEqual(CommitStatement.verifySignature(relabelled), ok);
            // The header check itself, whatever verifies r||s underneath: the native verifier (which another test file
            // installs into ECUtils for the whole run) refuses a bad header on its own, the JS one does not.
            const original = ECUtils.verifySignature2;
            ECUtils.verifySignature2 = () => true;
            try {
                assert.strictEqual(CommitStatement.verifySignature(relabelled), ok);
            }
            finally {
                ECUtils.verifySignature2 = original;
            }
        });
});

/** The vectors `test/fixtures/keytree/reference.py` in the endpoint writes from the spec; this is a byte-identical copy. */
interface Vectors {
    signedBytes: {statement: Omit<types.cloud.GroupTreeCommitStatement, "signature">, expectedHex: string}[];
    policyHash: {policy: types.cloud.ContainerPolicy, creator: types.cloud.UserId, expectedHex: string}[];
}

function vectors(): Vectors {
    // Read from `src`, like keytree-states.json: the build copies TypeScript only.
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../..", "src/test/fixtures/keytree-vectors.json"), "utf8")) as Vectors;
}

describe("CommitStatement shared vectors", () => {
    it("signed bytes match the shared vectors", () => {
        const all = vectors().signedBytes;
        assert.ok(all.some(v => v.statement.op === "policy"), "a policy op among them");
        for (const vector of all) {
            assert.strictEqual(CommitStatement.signedBytes(vector.statement).toString("hex"), vector.expectedHex, vector.statement.op);
        }
    });
    
    it("SECURITY: policy hash matches the shared vectors", () => {
        const all = vectors().policyHash;
        assert.strictEqual(all.length, 6);
        for (const vector of all) {
            assert.strictEqual(CommitStatement.policyHash(vector.policy, vector.creator).toString("hex"), vector.expectedHex, JSON.stringify(vector));
        }
    });
    
    it("inherit, default and absent resolve to the frozen v3 rules, never the context's", () => {
        for (const value of [undefined, "inherit", "default"] as const) {
            assert.strictEqual(CommitStatement.resolve({update: value}, "update"), "manager");
            assert.strictEqual(CommitStatement.resolve({ownerCanBeRemovedFromManagers: value}, "ownerCanBeRemovedFromManagers"), "yes");
        }
        assert.strictEqual(CommitStatement.resolve({rotateKeys: "manager,owner"}, "rotateKeys"), "manager,owner", "verbatim");
    });
});

describe("CommitStatement.groupId", () => {
    it("SECURITY: a group's id follows from its context and the resourceId its creator signs, byte for byte as the endpoint computes it", () => {
        // The same vector is in the endpoint's TreeCommitsTest: a client accepts a genesis statement only for this id.
        assert.strictEqual(
            CommitStatement.groupId("ctx" as types.context.ContextId, "res" as types.core.ClientResourceId),
            "c05bb98afb4dd712d19bfc4c42f84cf213274a8345b6c2d55d3cf941c2fea17f",
        );
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
    
    it("never hashes the tree for a statement its committer did not sign", () => {
        // Hashing the tree is the expensive part; a tree that cannot be hashed shows it was never reached.
        const {statement, expected} = honest();
        const unhashable = {...expected, tree: undefined as unknown as ExpectedStatement["tree"]};
        assert.deepStrictEqual(check(signStatement({...statement}, "u1"), unhashable), [{kind: "BAD_COMMIT_SIGNATURE"}]);
    });
    
    it("SECURITY: refuses a statement altered after signing", () => {
        const {statement, expected} = honest();
        // Same fields the bridge expects, but not the ones that were signed.
        const resigned = signStatement({...statement, date: NOW + 1});
        assert.deepStrictEqual(check({...resigned, date: NOW}, expected), [{kind: "BAD_COMMIT_SIGNATURE"}]);
    });
    
    const mutations: [string, (cs: types.cloud.GroupTreeCommitStatement) => types.cloud.GroupTreeCommitStatement][] = [
        ["seq", cs => ({...cs, seq: cs.seq + 1})],
        ["prevDigest", cs => ({...cs, prevDigest: "00".repeat(32)})],
        ["prevDigest", cs => ({...cs, prevDigest: ""})],
        ["op", cs => ({...cs, op: "selfUpdate"})],
        ["groupId", cs => ({...cs, groupId: "other"})],
        ["treeVersion", cs => ({...cs, treeVersion: 1})],
        ["keyVersion", cs => ({...cs, keyVersion: 5})],
        ["groupPubKey", cs => ({...cs, groupPubKey: GROUP_PUB})],
        ["rosterVersion", cs => ({...cs, rosterVersion: 7})],
        ["rosterHash", cs => ({...cs, rosterHash: TreeHash.rosterHash(SEATS, []).toString("hex")})],
        ["rosterHash", cs => ({...cs, rosterHash: cs.rosterHash.toUpperCase()})],
        ["policyHash", cs => ({...cs, policyHash: CommitStatement.policyHash({update: "user"}, "u0" as types.cloud.UserId).toString("hex")})],
        ["policyHash", cs => ({...cs, policyHash: CommitStatement.policyHash({}, "u1" as types.cloud.UserId).toString("hex")})],
        ["policy", cs => ({...cs, policy: {}})],
        ["treeHash", cs => ({...cs, treeHash: TreeHash.treeHash(TreeHash.of(BASE)).toString("hex")})],
        ["committer", cs => ({...cs, committer: "u1" as types.cloud.UserId})],
        ["committerPubKey", cs => ({...cs, committerPubKey: userKeys("u1").pub58})],
        ["committerSeat", cs => ({...cs, committerSeat: 1})],
        ["path", cs => ({...cs, path: cs.path.slice(1)})],
        ["path", cs => ({...cs, path: [...cs.path].reverse()})],
        ["path", cs => ({...cs, path: cs.path.map((e, i) => i === 0 ? {...e, generation: e.generation + 1} : e)})],
        ["path", cs => ({...cs, path: cs.path.map((e, i) => i === 0 ? {...e, publicKey: GROUP_PUB as unknown as types.core.EccPubKey} : e)})],
        ["path", cs => ({...cs, path: cs.path.map((e, i) => i === 0 ? {...e, subtreeHash: cs.path[1].subtreeHash} : e)})],
        ["addedUsers", cs => ({...cs, addedUsers: ["u40" as types.cloud.UserId]})],
        ["addedManagers", cs => ({...cs, addedManagers: ["u40" as types.cloud.UserId]})],
        ["removed", cs => ({...cs, removed: []})],
        ["removed", cs => ({...cs, removed: ["u40", "u40"] as types.cloud.UserId[]})],
        ["date", cs => ({...cs, date: NOW - CommitStatement.DATE_TOLERANCE_MS - 1})],
        ["date", cs => ({...cs, date: NOW + CommitStatement.DATE_TOLERANCE_MS + 1})],
        ["date", cs => ({...cs, date: NOW - 2})], // inside the tolerance, but before the statement it extends
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
    
    it("SECURITY: a statement dated as the one it extends is accepted however far ahead of the clock that one is", () => {
        // A forward-dated statement already stored (collusion, or a bridge clock stepped back) must not freeze every
        // honest commit after it: the honest client signs max(its clock, previous.date), i.e. exactly that date.
        const {statement, expected} = honest();
        const ahead = NOW + CommitStatement.DATE_TOLERANCE_MS + 5 * 60_000;
        assert.deepStrictEqual(check(signStatement({...statement, date: ahead}, "u0"), {...expected, notBefore: ahead}), []);
    });
    
    it("SECURITY: past the tolerance a date may match the one it extends but not move beyond it", () => {
        const {statement, expected} = honest();
        const ahead = NOW + CommitStatement.DATE_TOLERANCE_MS + 5 * 60_000;
        assert.deepStrictEqual(check(signStatement({...statement, date: ahead + 1}, "u0"), {...expected, notBefore: ahead}),
            [{kind: "BAD_COMMIT_STATEMENT", field: "date"}]);
    });
    
    it("an exact resend is refused once the bridge's clock is past its date plus the tolerance", () => {
        // The endpoint resends an unresolved statement byte for byte for 2 x DATE_TOLERANCE_MS of its date, and only
        // then signs a different one at the same prevDigest. This lower bound is what makes that window finite.
        const {statement, expected} = honest();
        assert.deepStrictEqual(check(statement, expected, NOW + CommitStatement.DATE_TOLERANCE_MS + 1), [{kind: "BAD_COMMIT_STATEMENT", field: "date"}]);
        // The bridge takes a date equal to the extended one however far ahead, but never one more than T behind the clock:
        // a statement matching a forward-dated predecessor is refused once the clock passes its date plus T too.
        const ahead = NOW + CommitStatement.DATE_TOLERANCE_MS + 5 * 60_000;
        const matched = signStatement({...statement, date: ahead}, "u0");
        assert.deepStrictEqual(check(matched, {...expected, notBefore: ahead}, ahead + CommitStatement.DATE_TOLERANCE_MS), []);
        assert.deepStrictEqual(check(matched, {...expected, notBefore: ahead}, ahead + CommitStatement.DATE_TOLERANCE_MS + 1),
            [{kind: "BAD_COMMIT_STATEMENT", field: "date"}]);
    });
    
    it("validate refuses a policy on an add, and its absence on a policy op", () => {
        const {statement, expected} = honest();
        assert.deepStrictEqual(check(signStatement({...statement, policy: {update: "all"}}, "u0"), expected), [{kind: "BAD_COMMIT_STATEMENT", field: "policy"}]);
        const tree = BASE;
        const previous = creationStatement(tree, "u0", {groupId: "res", groupPubKey: GROUP_PUB, users: SEATS, managers: [], date: NOW - 1});
        const change = policyStatement(tree, 2, 5, "u0", {update: "user"}, {groupId: "grp", groupPubKey: GROUP_PUB, rosterVersion: 1, users: SEATS, managers: [], date: NOW, previous, creator: "u0"});
        const policyExpected: ExpectedStatement = {...expected, op: "policy", prevDigest: CommitStatement.digest(previous), notBefore: previous.date, keyVersion: 5, groupPubKey: GROUP_PUB, rosterVersion: 1,
            rosterHash: TreeHash.rosterHash(SEATS, []), tree: TreeHash.of(tree), path: [], removed: [],
            policyHash: CommitStatement.policyHash({update: "user"}, "u0" as types.cloud.UserId)};
        assert.deepStrictEqual(check(change, policyExpected), []);
        const bare: Partial<types.cloud.GroupTreeCommitStatement> = {...change};
        delete bare.policy;
        assert.deepStrictEqual(check(signStatement(bare as types.cloud.GroupTreeCommitStatement, "u0"), policyExpected), [{kind: "BAD_COMMIT_STATEMENT", field: "policy"}]);
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
    const creator = "u0";
    
    /** u0 creates the group (statement 1), u40 self-updates (statement 2): what storage holds afterwards. */
    function stored() {
        const created = planCommit({numLeaves: 64, leafAssignment: SEATS as types.cloud.UserId[], nodes: [], edges: []}, 0, {kind: "create", committer: "u0"}, 1);
        const create = statementFor(created, {kind: "create", committer: "u0"}, {groupId: "8b3f4c2e-1d5a-4e6b-9c7d-0a1b2c3d4e5f", groupPubKey: GROUP_PUB, rosterVersion: 1, ...roster});
        const update = planCommit(created.after, 1, {kind: "selfUpdate", committer: "u40"}, 2);
        const second = statementFor(update, {kind: "selfUpdate", committer: "u40"}, {groupId: "grp", groupPubKey: GROUP_PUB, rosterVersion: 1, creator, ...roster});
        return {
            group: {treeCommitSeq: 2, keyVersion: 1, groupPubKey: GROUP_PUB, rosterVersion: 1, creator: "u0" as types.cloud.UserId, ...roster},
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
    
    it("checkStoredState reports a stored policy, or creator, the latest statement does not hash", () => {
        const {group, tree, statements} = stored();
        assert.deepStrictEqual(CommitStatement.checkStoredState({...group, policy: {update: "all"}}, tree, statements),
            ["the stored policy does not hash to the latest statement's policyHash"]);
        assert.deepStrictEqual(CommitStatement.checkStoredState({...group, policy: {get: "all"}}, tree, statements), [], "an unsigned field");
        assert.deepStrictEqual(CommitStatement.checkStoredState({...group, creator: "u1" as types.cloud.UserId}, tree, statements),
            ["the stored policy does not hash to the latest statement's policyHash"]);
    });
    
    it("SECURITY: finds a filled node still vouched for by a former member", () => {
        // A removal blanks every node its departing members set; one that survived is a key a former member has.
        const {group, tree, statements} = stored();
        const problems = CommitStatement.checkStoredState({...group, users: SEATS.filter(u => u !== "u0")}, tree, statements);
        assert.ok(problems.includes("node 31 was set by u0, who is not a member"), JSON.stringify(problems));
    });
    
    it("SECURITY: finds a node whose subtree was rolled back to an older, genuinely vouched generation", () => {
        // u35 heals node 95 over u40's; u0, colluding, signs a state with 95 back at u40's generation. 95
        // itself still matches statement 2 (nothing keyed below it), but the root u35 minted sits over another subtree.
        const {group, tree, statements} = stored();
        const healed = planCommit(tree, 1, {kind: "selfUpdate", committer: "u35"}, 3);
        const old = tree.nodes.find(n => n.nodeIndex === 95)!;
        const rolledBack = {...healed.after, nodes: healed.after.nodes.map(n => n.nodeIndex === 95 ? old : n)};
        const ctx = {groupId: "grp", groupPubKey: GROUP_PUB, rosterVersion: 1, creator, ...roster};
        statements.set(3, statementFor(healed, {kind: "selfUpdate", committer: "u35"}, ctx));
        statements.set(4, statementFor({...healed, after: rolledBack, refreshedNodes: [], seq: 4}, {kind: "selfUpdate", committer: "u0"}, ctx));
        const problems = CommitStatement.checkStoredState({...group, treeCommitSeq: 4}, rolledBack, statements);
        assert.deepStrictEqual(problems, ["node 63 is not vouched for by statement 3"]);
    });
});
