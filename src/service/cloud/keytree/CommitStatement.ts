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
import { TreeHash } from "./TreeHash";

export type StatementProblem =
    | {kind: "BAD_COMMIT_STATEMENT", field: string}
    | {kind: "BAD_COMMIT_SIGNATURE"};

/** Everything a statement must say, as the bridge derives it from its own state and the caller — never from the
 *  statement itself. */
export interface ExpectedStatement {
    seq: number;
    op: types.cloud.GroupTreeCommitOp;
    groupId: string;
    treeVersion: number;
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
    rosterVersion: number;
    rosterHash: Buffer;
    treeHash: Buffer;
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
    
    /** Clock skew a statement's `date` may have against the bridge. */
    static readonly DATE_TOLERANCE_MS = 10 * 60 * 1000;
    
    static readonly OP_CODES: Record<types.cloud.GroupTreeCommitOp, number> = {create: 1, add: 2, remove: 3, selfUpdate: 4, rotate: 5};
    
    /** `SB` — the bytes the committer signs (the signature is over their SHA-256). */
    static signedBytes(cs: Omit<types.cloud.GroupTreeCommitStatement, "signature">): Buffer {
        const writer = new ByteWriter()
            .tag("pmx-tree-commit")
            .lp(cs.groupId)
            .u32(cs.treeVersion)
            .u64(cs.seq)
            .u8(CommitStatement.OP_CODES[cs.op])
            .u64(cs.date)
            .u64(cs.keyVersion)
            .lp(cs.groupPubKey)
            .u64(cs.rosterVersion)
            .raw(Buffer.from(cs.rosterHash, "hex"))
            .raw(Buffer.from(cs.treeHash, "hex"))
            .lp(cs.committer)
            .lp(cs.committerPubKey)
            .u32(cs.committerSeat)
            .u32(cs.path.length);
        for (const entry of cs.path) {
            writer.u32(entry.nodeIndex).u32(entry.generation).lp(entry.publicKey);
        }
        for (const list of [cs.addedUsers, cs.addedManagers, cs.removed]) {
            writer.u32(list.length);
            list.forEach(userId => writer.lp(userId));
        }
        return writer.bytes();
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
     * Compares a submitted statement with what the bridge expects — `committerPubKey` included — then checks its
     * signature against that key. Field problems are all reported; the signature is checked only when the fields agree, since a
     * signature over the wrong statement is beside the point.
     */
    static validate(
        cs: types.cloud.GroupTreeCommitStatement,
        expected: ExpectedStatement,
        now: number,
    ): StatementProblem[] {
        const problems: StatementProblem[] = [];
        const bad = (field: string) => problems.push({kind: "BAD_COMMIT_STATEMENT", field});
        const scalars = ["seq", "op", "groupId", "treeVersion", "keyVersion", "groupPubKey", "rosterVersion", "committer", "committerPubKey", "committerSeat"] as const;
        for (const field of scalars) {
            if (cs[field] !== expected[field]) {
                bad(field);
            }
        }
        if (!CommitStatement.isHash(cs.rosterHash) || cs.rosterHash !== expected.rosterHash.toString("hex")) {
            bad("rosterHash");
        }
        if (!CommitStatement.isHash(cs.treeHash) || cs.treeHash !== expected.treeHash.toString("hex")) {
            bad("treeHash");
        }
        const samePath = cs.path.length === expected.path.length && cs.path.every((entry, i) =>
            entry.nodeIndex === expected.path[i].nodeIndex
            && entry.generation === expected.path[i].generation
            && entry.publicKey === expected.path[i].publicKey);
        if (!samePath) {
            bad("path");
        }
        for (const field of ["addedUsers", "addedManagers", "removed"] as const) {
            if (!CommitStatement.sameList(cs[field], TreeHash.sortedUnique(expected[field]))) {
                bad(field);
            }
        }
        if (!Number.isSafeInteger(cs.date) || Math.abs(cs.date - now) > CommitStatement.DATE_TOLERANCE_MS) {
            bad("date");
        }
        if (problems.length > 0) {
            return problems;
        }
        return CommitStatement.verifySignature(cs) ? [] : [{kind: "BAD_COMMIT_SIGNATURE"}];
    }
    
    /**
     * The stored-state half of the statement invariant, for `verifyGroupTrees.ts` and the tests: the latest
     * statement describes the stored group exactly, every statement given is signed by the key it names, and every
     * filled record names a statement that lists its key.
     */
    static checkStoredState(
        group: {treeCommitSeq?: number, keyVersion: number, groupPubKey: types.cloud.GroupPubKey, rosterVersion: number,
            users: string[], managers: string[]},
        tree: types.cloud.GroupTreeState,
        statements: Map<number, types.cloud.GroupTreeCommitStatement>,
    ): string[] {
        const problems: string[] = [];
        const latest = group.treeCommitSeq === undefined ? undefined : statements.get(group.treeCommitSeq);
        if (!latest) {
            return [`no statement at treeCommitSeq ${group.treeCommitSeq ?? "(none)"}`];
        }
        if (latest.treeHash !== TreeHash.treeHash(TreeHash.of(tree)).toString("hex")) {
            problems.push("the tree does not hash to the latest statement's treeHash");
        }
        if (latest.rosterHash !== TreeHash.rosterHash(group.users, group.managers).toString("hex")) {
            problems.push("the roster does not hash to the latest statement's rosterHash");
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
            const listed = vouching?.path.some(entry =>
                entry.nodeIndex === node.nodeIndex && entry.generation === node.generation && entry.publicKey === node.publicKey);
            if (!listed || node.setBy! > latest.seq) {
                problems.push(`node ${node.nodeIndex} is not vouched for by statement ${node.setBy ?? "(none)"}`);
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
