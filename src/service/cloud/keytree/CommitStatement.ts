/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import { Crypto } from "../../../utils/crypto/Crypto";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { ByteWriter } from "./ByteWriter";
import { HashableTree, TreeHash } from "./TreeHash";

export type StatementProblem =
    | {kind: "BAD_COMMIT_STATEMENT", field: string}
    | {kind: "BAD_COMMIT_SIGNATURE"};

/** Everything a statement must say, as the bridge derives it from its own state and the caller — never from the
 *  statement itself. */
export interface ExpectedStatement {
    seq: number;
    /** `digest` of the stored latest statement, "" for a creation: a statement extends exactly the history stored. */
    prevDigest: string;
    /** The stored latest statement's date: a chain's dates never go back; past the tolerance only a date equal to
     *  this one is taken (see `CommitStatement.isBadDate`). */
    notBefore: number;
    op: types.cloud.GroupTreeCommitOp;
    groupId: string;
    treeVersion: number;
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
    rosterVersion: number;
    rosterHash: Buffer;
    /** `CommitStatement.policyHash` of the group's policy after the commit: the stored one, or the one a creation or
     *  a policy commit carries. */
    policyHash: Buffer;
    /** The tree after the commit: the statement's `treeHash` and each path entry's `subtreeHash` are read off it. */
    tree: HashableTree;
    committer: types.cloud.UserId;
    /** The caller's current context key: the statement must name it, and is checked against it. */
    committerPubKey: types.cloud.UserPubKey;
    committerSeat: number;
    /** The refreshed nodes as submitted in the transition, in submitted order. */
    path: {nodeIndex: number, generation: number, publicKey: types.core.EccPubKey}[];
    addedUsers: types.cloud.UserId[];
    addedManagers: types.cloud.UserId[];
    removed: types.cloud.UserId[];
}

/**
 * Commit statements (addendum spec §3): the signed bytes, the signature, and the bridge's field-by-field check.
 *
 * The bridge checks a statement so that what it stores is something every client will accept, and so that a
 * client which trusts the latest statement never finds a bridge-written state behind it. It does not make the
 * statement trustworthy — that is the signature, checked by the clients themselves.
 */
export class CommitStatement {
    
    /** Clock skew a statement's `date` may have against the bridge; past it ahead only a date equal to the extended
     *  statement's is taken (see `isBadDate`). */
    static readonly DATE_TOLERANCE_MS = 10 * 60 * 1000;
    
    /** Whether `date` is unacceptable for a statement extending one dated `notBefore`, at bridge time `now`.
     *  Dates never go back and are at most T behind the clock. Past `now + T` only a date equal to `notBefore` is
     *  taken, so a forward-dated statement cannot freeze the honest commits after it nor be moved further ahead. */
    private static isBadDate(date: number, notBefore: number, now: number): boolean {
        const tolerance = CommitStatement.DATE_TOLERANCE_MS;
        return !Number.isSafeInteger(date) || date < notBefore || date < now - tolerance || date > Math.max(now + tolerance, notBefore);
    }
    
    static readonly OP_CODES: Record<types.cloud.GroupTreeCommitOp, number> = {create: 1, add: 2, remove: 3, selfUpdate: 4, rotate: 5, policy: 6};
    
    /** The rules a v3 group's statements sign, and what an absent, `inherit` or `default` value means for them.
     *  Frozen with the format and deliberately NOT `DefaultContextPolicy`: the context only holds a veto (T4-10). */
    static readonly V3_POLICY_DEFAULTS = {
        update: "manager",
        rotateKeys: "manager",
        updatePolicy: "manager",
        ownerCanBeRemovedFromManagers: "yes",
    } as const satisfies Record<string, types.cloud.PolicyEntry>;
    
    /** A signed rule of `policy`, verbatim, or its v3 default. */
    static resolve(policy: types.cloud.ContainerPolicy|undefined, field: keyof typeof CommitStatement.V3_POLICY_DEFAULTS): types.cloud.PolicyEntry {
        const value = policy?.[field];
        return value === undefined || value === "inherit" || value === "default" ? CommitStatement.V3_POLICY_DEFAULTS[field] : value;
    }
    
    /**
     * `PH`: what every statement signs of the group's policy, the four rules that govern commits and the creator the
     * `owner` atom names. `H("pmx-group-policy\0" || lp(creator) || lp(update) || lp(rotateKeys) || lp(updatePolicy)
     * || lp(ownerCanBeRemovedFromManagers))`. The rest of the policy is the bridge's alone and is not hashed.
     */
    static policyHash(policy: types.cloud.ContainerPolicy|undefined, creator: types.cloud.UserId): Buffer {
        const writer = new ByteWriter().tag("pmx-group-policy").lp(creator);
        for (const field of ["update", "rotateKeys", "updatePolicy", "ownerCanBeRemovedFromManagers"] as const) {
            writer.lp(CommitStatement.resolve(policy, field));
        }
        return Crypto.sha256(writer.bytes());
    }
    
    /**
     * A group's id, derived rather than generated: lowercase hex of `H("pmx-group-id\0" || lp(contextId) || lp(resourceId))`.
     * The creator signs only the resourceId at seq 1, so this is what ties that statement to one group id — clients
     * recompute it, and a genesis statement cannot be served as another group's.
     */
    static groupId(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId): types.group.GroupId {
        return Crypto.sha256(new ByteWriter().tag("pmx-group-id").lp(contextId).lp(resourceId).bytes()).toString("hex") as types.group.GroupId;
    }
    
    /** `SB` — the bytes the committer signs (the signature is over their SHA-256). */
    static signedBytes(cs: Omit<types.cloud.GroupTreeCommitStatement, "signature">): Buffer {
        const prevDigest = Buffer.from(cs.prevDigest, "hex");
        const writer = new ByteWriter()
            .tag("pmx-tree-commit")
            .lp(cs.groupId)
            .u32(cs.treeVersion)
            .u64(cs.seq)
            .u32(prevDigest.length)
            .raw(prevDigest)
            .u8(CommitStatement.OP_CODES[cs.op])
            .u64(cs.date)
            .u64(cs.keyVersion)
            .lp(cs.groupPubKey)
            .u64(cs.rosterVersion)
            .raw(Buffer.from(cs.rosterHash, "hex"))
            .raw(Buffer.from(cs.treeHash, "hex"))
            .raw(Buffer.from(cs.policyHash, "hex"))
            .lp(cs.committer)
            .lp(cs.committerPubKey)
            .u32(cs.committerSeat)
            .u32(cs.path.length);
        for (const entry of cs.path) {
            writer.u32(entry.nodeIndex).u32(entry.generation).lp(entry.publicKey).raw(Buffer.from(entry.subtreeHash, "hex"));
        }
        for (const list of [cs.addedUsers, cs.addedManagers, cs.removed]) {
            writer.u32(list.length);
            list.forEach(userId => writer.lp(userId));
        }
        return writer.bytes();
    }
    
    /** Identity of a statement as signed — what the next one names as `prevDigest`. Hex. */
    static digest(cs: types.cloud.GroupTreeCommitStatement): string {
        return Crypto.sha256(Buffer.concat([CommitStatement.signedBytes(cs), Buffer.from(cs.signature, "base64")])).toString("hex");
    }
    
    /** Against the key the statement names itself; whether that is the committer's key is the reader's check. */
    static verifySignature(cs: types.cloud.GroupTreeCommitStatement): boolean {
        try {
            return ECUtils.verifySignature2(cs.committerPubKey, cs.signature, Crypto.sha256(CommitStatement.signedBytes(cs)));
        }
        catch {
            return false;
        }
    }
    
    /**
     * Compares a submitted statement with what the bridge expects — `committerPubKey` included — and checks its
     * signature against that key. Cheapest first: the plain fields, then the signature, and only then the tree,
     * which costs a hash of every node — so a statement nobody signed never gets that far. Problems within a
     * stage are all reported; a later stage runs only when the earlier ones agree.
     */
    static validate(
        cs: types.cloud.GroupTreeCommitStatement,
        expected: ExpectedStatement,
        now: number,
    ): StatementProblem[] {
        const problems: StatementProblem[] = [];
        const bad = (field: string) => problems.push({kind: "BAD_COMMIT_STATEMENT", field});
        const scalars = ["seq", "prevDigest", "op", "groupId", "treeVersion", "keyVersion", "groupPubKey", "rosterVersion", "committer", "committerPubKey", "committerSeat"] as const;
        for (const field of scalars) {
            if (cs[field] !== expected[field]) {
                bad(field);
            }
        }
        if (!CommitStatement.isHash(cs.rosterHash) || cs.rosterHash !== expected.rosterHash.toString("hex")) {
            bad("rosterHash");
        }
        if (!CommitStatement.isHash(cs.policyHash) || cs.policyHash !== expected.policyHash.toString("hex")) {
            bad("policyHash");
        }
        // The policy object travels with exactly the ops that set it; anywhere else it would be served as if signed.
        if ((cs.policy !== undefined) !== (expected.op === "create" || expected.op === "policy")) {
            bad("policy");
        }
        for (const field of ["addedUsers", "addedManagers", "removed"] as const) {
            if (!CommitStatement.sameList(cs[field], TreeHash.sortedUnique(expected[field]))) {
                bad(field);
            }
        }
        if (CommitStatement.isBadDate(cs.date, expected.notBefore, now)) {
            bad("date");
        }
        if (problems.length > 0) {
            return problems;
        }
        if (!CommitStatement.verifySignature(cs)) {
            return [{kind: "BAD_COMMIT_SIGNATURE"}];
        }
        const hashes = new Map<number, Buffer>();
        if (!CommitStatement.isHash(cs.treeHash) || cs.treeHash !== TreeHash.treeHash(expected.tree, hashes).toString("hex")) {
            bad("treeHash");
        }
        const samePath = cs.path.length === expected.path.length && cs.path.every((entry, i) =>
            entry.nodeIndex === expected.path[i].nodeIndex
            && entry.generation === expected.path[i].generation
            && entry.publicKey === expected.path[i].publicKey
            && entry.subtreeHash === hashes.get(entry.nodeIndex)?.toString("hex"));
        if (!samePath) {
            bad("path");
        }
        return problems;
    }
    
    /**
     * The stored-state half of the statement invariant, for `verifyGroupTrees.ts` and the tests: the latest
     * statement describes the stored group exactly, every statement given is signed by the key it names, and every
     * filled record names a statement that lists its key over its current subtree and was signed by a current member.
     */
    static checkStoredState(
        group: {treeCommitSeq?: number, keyVersion: number, groupPubKey: types.cloud.GroupPubKey, rosterVersion: number,
            users: string[], managers: string[], creator: types.cloud.UserId, policy?: types.cloud.ContainerPolicy},
        tree: types.cloud.GroupTreeState,
        statements: Map<number, types.cloud.GroupTreeCommitStatement>,
    ): string[] {
        const problems: string[] = [];
        const latest = group.treeCommitSeq === undefined ? undefined : statements.get(group.treeCommitSeq);
        if (!latest) {
            return [`no statement at treeCommitSeq ${group.treeCommitSeq ?? "(none)"}`];
        }
        const hashes = new Map<number, Buffer>();
        if (latest.treeHash !== TreeHash.treeHash(TreeHash.of(tree), hashes).toString("hex")) {
            problems.push("the tree does not hash to the latest statement's treeHash");
        }
        if (latest.rosterHash !== TreeHash.rosterHash(group.users, group.managers).toString("hex")) {
            problems.push("the roster does not hash to the latest statement's rosterHash");
        }
        if (latest.policyHash !== CommitStatement.policyHash(group.policy ?? {}, group.creator).toString("hex")) {
            problems.push("the stored policy does not hash to the latest statement's policyHash");
        }
        if (latest.keyVersion !== group.keyVersion || latest.groupPubKey !== group.groupPubKey || latest.rosterVersion !== group.rosterVersion) {
            problems.push("the latest statement names another epoch, grant key or roster version");
        }
        for (const statement of statements.values()) {
            if (!CommitStatement.verifySignature(statement)) {
                problems.push(`statement ${statement.seq} is not signed by the key it names`);
            }
        }
        for (const node of tree.nodes.filter(record => record.publicKey)) {
            const vouching = node.setBy === undefined ? undefined : statements.get(node.setBy);
            // Over the subtree it was minted over, too: a child re-keyed since without re-keying it is a rollback.
            const listed = vouching?.path.some(entry =>
                entry.nodeIndex === node.nodeIndex && entry.generation === node.generation && entry.publicKey === node.publicKey
                && entry.subtreeHash === hashes.get(node.nodeIndex)?.toString("hex"));
            if (!listed || node.setBy! > latest.seq) {
                problems.push(`node ${node.nodeIndex} is not vouched for by statement ${node.setBy ?? "(none)"}`);
            }
            // A removal blanks every node its departing members set, so a filled node's setter is still a member.
            else if (!group.users.includes(vouching!.committer) && !group.managers.includes(vouching!.committer)) {
                problems.push(`node ${node.nodeIndex} was set by ${vouching!.committer}, who is not a member`);
            }
        }
        return problems;
    }
    
    private static isHash(value: string): boolean {
        return /^[0-9a-f]{64}$/.test(value);
    }
    
    /** Same values in the same order: the statement's lists must already be in their canonical sorted form. */
    private static sameList(got: string[], expected: string[]): boolean {
        return got.length === expected.length && got.every((value, i) => value === expected[i]);
    }
}
