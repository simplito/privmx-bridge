/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { TreeMath } from "../../service/cloud/keytree/TreeMath";
import { LadderMath } from "../../service/cloud/keytree/LadderMath";
import { CommitOp, TreeCommit, TreeTransitionValidator } from "../../service/cloud/keytree/TreeTransitionValidator";
import { CommitStatement } from "../../service/cloud/keytree/CommitStatement";
import { TreeHash } from "../../service/cloud/keytree/TreeHash";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { Crypto } from "../../utils/crypto/Crypto";
import { DateUtils } from "../../utils/DateUtils";
import type * as elliptic from "elliptic";

/**
 * Hidden key tree fixtures for the bridge's tests.
 *
 * The wrapped blobs are recognisable placeholders rather than real ciphertexts, and deliberately so: the bridge
 * cannot decrypt an edge, so every rule it enforces is decidable from indices, generations and roster membership.
 * A fixture that carried real keys would prove nothing extra and hide what is actually being checked. The real
 * crypto is exercised on the endpoint side (see privmx-endpoint/test/tests/unit/TreeKeysTest.cpp).
 *
 * `planCommit` mirrors the endpoint's planner without the crypto, so the tests submit exactly what an honest
 * client would.
 */

export function userId(name: string): types.cloud.UserId {
    return name as types.cloud.UserId;
}

let mintCounter = 0;

let realNodeKeys = false;

/** A placeholder public key, unique per call — what `PrivateKey::generateRandom()` gives the endpoint. */
function freshKey(nodeIndex: number, generation: number): types.core.EccPubKey {
    if (realNodeKeys) {
        return ECUtils.generateKeyPair().pub58;
    }
    return `pk:${nodeIndex}g${generation}#${++mintCounter}` as types.core.EccPubKey;
}

/** Mints real ECC public keys from here on, for tests whose requests pass the API validator. */
export function useRealNodeKeys() {
    realNodeKeys = true;
}

/** A placeholder wrap, unique per call so no two edges ever carry the same "ciphertext". */
function wrap(parent: string, child: string): types.core.UserKeyData {
    return `wrap:${parent}->${child}#${++mintCounter}` as types.core.UserKeyData;
}

export type PlanOp =
    | {kind: "create", committer: string}
    | {kind: "add", committer: string, members: string[], positions: number[]}
    | {kind: "remove", committer: string, removed: string[]}
    | {kind: "selfUpdate", committer: string};

/** What an honest endpoint submits for one commit, and the state the bridge holds once it is applied. */
export interface Plan {
    /** The committer's keyed path `R`, re-keyed. */
    refreshedNodes: types.cloud.GroupTreeRefreshedNode[];
    /** The edges `R` owes on the post state, plus the grant edge. */
    edges: types.cloud.GroupTreeEdge[];
    /** For a removal: the departing members' seats. */
    blankedPositions: number[];
    /** `B \ R` — what the commit leaves blank. */
    blanked: number[];
    /** The whole stored state after the commit, edges included, by the storage rule of `applyCommit`. */
    after: types.cloud.GroupTreeState;
    keyVersion: number;
    /** The seq of the statement this commit is signed as; its re-keyed records carry it in `setBy`. */
    seq: number;
}

type Resolved = {kind: "node", nodeIndex: number, generation: number}|{kind: "user", userId: types.cloud.UserId};

/**
 * Resolution, written out again rather than borrowed from `TreeValidator`: a planner sharing the validator's
 * code would agree with it by construction, and the tests built on it would prove nothing.
 */
function resolve(numLeaves: number, seating: types.cloud.UserId[], records: Map<number, types.cloud.GroupTreeNode>, nodeIndex: number): Resolved[] {
    if (nodeIndex % 2 === 0) {
        const holder = seating[nodeIndex / 2];
        return holder ? [{kind: "user", userId: holder}] : [];
    }
    const record = records.get(nodeIndex);
    if (TreeMath.isKeyed(nodeIndex, numLeaves) && record?.publicKey) {
        return [{kind: "node", nodeIndex, generation: record.generation}];
    }
    return TreeMath.children(nodeIndex, numLeaves).flatMap(child => resolve(numLeaves, seating, records, child));
}

/** The edges the filled nodes `parents` owe in the given state. */
function edgesOwed(numLeaves: number, seating: types.cloud.UserId[], records: Map<number, types.cloud.GroupTreeNode>, parents: number[]): types.cloud.GroupTreeEdge[] {
    const edges: types.cloud.GroupTreeEdge[] = [];
    for (const parentIndex of parents) {
        const parentGeneration = records.get(parentIndex)!.generation;
        for (const child of TreeMath.children(parentIndex, numLeaves)) {
            for (const target of resolve(numLeaves, seating, records, child)) {
                edges.push(target.kind === "user"
                    ? {parentIndex, parentGeneration, childKind: "user", childUserId: target.userId, data: wrap(`${parentIndex}`, target.userId)}
                    : {parentIndex, parentGeneration, childKind: "node", childIndex: target.nodeIndex, childGeneration: target.generation, data: wrap(`${parentIndex}`, `${target.nodeIndex}`)});
            }
        }
    }
    return edges;
}

/**
 * Plans one commit the way the endpoint does (spec §6): work out the post seating and the blank set, re-key the
 * committer's keyed path with fresh keys, wrap each re-keyed node to its children's resolutions on the post
 * state, and re-issue the grant edge. Then applies it to `before` with the bridge's storage rule, so a chain of
 * plans yields the states the bridge would hold.
 *
 * Deliberately does no validation: a test that wants a bad submission edits a good one.
 */
export function planCommit(before: types.cloud.GroupTreeState, keyVersion: number, op: PlanOp, seq = nextSeq(before, op)): Plan {
    let numLeaves = before.numLeaves;
    const seating = [...before.leafAssignment];
    const blank = new Set<number>();
    const blankedPositions: number[] = [];
    let newKeyVersion = keyVersion;
    if (op.kind === "create") {
        newKeyVersion = 1;
    }
    else if (op.kind === "add") {
        numLeaves = TreeMath.numLeavesToSeatAll(op.positions, numLeaves);
        while (seating.length < numLeaves) {
            seating.push("" as types.cloud.UserId);
        }
        op.positions.forEach((position, i) => {
            seating[position] = userId(op.members[i]);
            TreeMath.keyedPath(position, numLeaves).forEach(nodeIndex => blank.add(nodeIndex));
        });
    }
    else if (op.kind === "remove") {
        for (const removed of op.removed) {
            const position = seating.indexOf(userId(removed));
            blankedPositions.push(position);
            seating[position] = "" as types.cloud.UserId;
            TreeMath.keyedPath(position, numLeaves).forEach(nodeIndex => blank.add(nodeIndex));
        }
        newKeyVersion = keyVersion + 1;
    }
    const path = TreeMath.keyedPath(seating.indexOf(userId(op.committer)), numLeaves);
    
    const records = new Map<number, types.cloud.GroupTreeNode>();
    const unkeyed: number[] = [];
    for (const node of before.nodes) {
        if (!TreeMath.isKeyed(node.nodeIndex, numLeaves)) {
            unkeyed.push(node.nodeIndex);
            continue;
        }
        records.set(node.nodeIndex, blank.has(node.nodeIndex) ? {nodeIndex: node.nodeIndex, generation: node.generation} : {...node});
    }
    const refreshedNodes = path.map(nodeIndex => {
        const record = records.get(nodeIndex);
        const generation = record ? record.generation + 1 : 0;
        const refreshed: types.cloud.GroupTreeRefreshedNode = {
            nodeIndex,
            ...(record ? {fromGeneration: record.generation} : {}),
            generation,
            publicKey: freshKey(nodeIndex, generation),
        };
        records.set(nodeIndex, {nodeIndex, generation, publicKey: refreshed.publicKey, setBy: seq});
        return refreshed;
    });
    
    const rootIndex = TreeMath.root(numLeaves);
    const grant: types.cloud.GroupTreeEdge = TreeMath.isLeaf(rootIndex)
        ? {isGrantEdge: true, parentGeneration: newKeyVersion, childKind: "user", childUserId: seating[0], data: wrap("grant", seating[0])}
        : {isGrantEdge: true, parentGeneration: newKeyVersion, childKind: "node", childIndex: rootIndex,
            childGeneration: records.get(rootIndex)!.generation, data: wrap("grant", `${rootIndex}`)};
    const edges = [...edgesOwed(numLeaves, seating, records, path), grant];
    
    const touched = new Set([...blank, ...path, ...unkeyed]);
    const kept = before.edges.filter(edge => !edge.isGrantEdge && !touched.has(edge.parentIndex ?? -1));
    return {
        refreshedNodes,
        edges,
        blankedPositions,
        blanked: [...blank].filter(nodeIndex => !path.includes(nodeIndex)).sort((a, b) => a - b),
        after: {
            numLeaves,
            leafAssignment: seating,
            nodes: [...records.values()].sort((a, b) => a.nodeIndex - b.nodeIndex),
            edges: [...kept, ...edges],
        },
        keyVersion: newKeyVersion,
        seq,
    };
}

/**
 * The next statement seq, as far as a tree can tell: one past the highest `setBy` it holds. A rotation moves the
 * seq without touching a record, so a test that rotates passes the seq explicitly.
 */
function nextSeq(tree: types.cloud.GroupTreeState, op: PlanOp): number {
    return op.kind === "create" ? 1 : Math.max(0, ...tree.nodes.map(node => node.setBy ?? 0)) + 1;
}

// ── commit statements ───────────────────────────────────────────────────────────────────────────────────────

const userKeyPairs = new Map<string, elliptic.ec.KeyPair>();

/** A member's long-term key pair — generated once per name, or the one registered for it (`registerUserKey`). */
export function userKeys(name: string): {keyPair: elliptic.ec.KeyPair, pub58: types.cloud.UserPubKey} {
    let keyPair = userKeyPairs.get(name);
    if (!keyPair) {
        keyPair = ECUtils.generateKeyPair().keyPair;
        userKeyPairs.set(name, keyPair);
    }
    return {keyPair, pub58: ECUtils.publicToBase58DER(keyPair) as unknown as types.cloud.UserPubKey};
}

/** Makes `name` sign with a known key, e.g. the e2e test user's. */
export function registerUserKey(name: string, wif: types.core.EccWif) {
    userKeyPairs.set(name, ECUtils.fromWIF(wif)!);
}

/** Signs a statement the way the endpoint does: compact ECDSA over SHA-256 of the signed bytes. */
export function signStatement(unsigned: Omit<types.cloud.GroupTreeCommitStatement, "signature">, signer: string = unsigned.committer): types.cloud.GroupTreeCommitStatement {
    const signature = ECUtils.signToCompactSignature(userKeys(signer).keyPair, Crypto.sha256(CommitStatement.signedBytes(unsigned)));
    return {...unsigned, signature: signature.toString("base64") as types.core.EccSignature};
}

/** What a statement names besides the tree: the group, the grant key and the roster after the commit. */
export interface StatementContext {
    groupId: string;
    groupPubKey: types.cloud.GroupPubKey;
    rosterVersion: number;
    users: string[];
    managers: string[];
    /** For an addition: which of the newcomers join as managers. */
    addedManagers?: string[];
    date?: number;
}

/** The signed statement an honest committer sends with `plan`. */
export function statementFor(plan: Plan, op: PlanOp|{kind: "rotate", committer: string}, ctx: StatementContext): types.cloud.GroupTreeCommitStatement {
    const sorted = (values: string[]) => TreeHash.sortedUnique(values.map(userId));
    // A creation binds its roster through `rosterHash` alone.
    const addedManagers = op.kind === "add" ? (ctx.addedManagers ?? []) : [];
    const addedUsers = op.kind === "add" ? op.members.filter(m => !addedManagers.includes(m)) : [];
    return signStatement({
        seq: plan.seq,
        op: op.kind,
        groupId: ctx.groupId,
        treeVersion: TreeMath.TREE_VERSION,
        date: ctx.date ?? DateUtils.now(),
        keyVersion: plan.keyVersion,
        groupPubKey: ctx.groupPubKey,
        rosterVersion: ctx.rosterVersion,
        rosterHash: TreeHash.rosterHash(ctx.users, ctx.managers).toString("hex"),
        treeHash: TreeHash.treeHash(TreeHash.of(plan.after)).toString("hex"),
        committer: userId(op.committer),
        committerPubKey: userKeys(op.committer).pub58,
        committerSeat: plan.after.leafAssignment.indexOf(userId(op.committer)),
        path: plan.refreshedNodes.map(node => ({nodeIndex: node.nodeIndex, generation: node.generation, publicKey: node.publicKey})),
        addedUsers: sorted(addedUsers),
        addedManagers: sorted(addedManagers),
        removed: sorted(op.kind === "remove" ? op.removed : []),
    });
}

/** The creator's statement for a freshly built tree (`buildTree`): seq 1, epoch 1, the tree's records as the path.
 *  `ctx.groupId` is the resourceId the creator chose. */
export function creationStatement(tree: types.cloud.GroupTreeState, creator: string, ctx: Omit<StatementContext, "rosterVersion">) {
    const path = tree.nodes.map(node => ({nodeIndex: node.nodeIndex, generation: node.generation, publicKey: node.publicKey!}));
    return statementFor({refreshedNodes: path, edges: [], blankedPositions: [], blanked: [], after: tree, keyVersion: 1, seq: 1},
        {kind: "create", committer: creator}, {...ctx, rosterVersion: 1});
}

/** A rotation's statement: the tree as it stands, an empty path, the next seq and epoch. */
export function rotationStatement(tree: types.cloud.GroupTreeState, seq: number, newKeyVersion: number, committer: string, ctx: StatementContext) {
    return statementFor({refreshedNodes: [], edges: [], blankedPositions: [], blanked: [], after: tree, keyVersion: newKeyVersion, seq}, {kind: "rotate", committer}, ctx);
}

/** The bridge's description of `op` — the caller and the subjects, nothing the client computed. */
export function commitOpFor(op: PlanOp, plan: Plan): CommitOp {
    const committer = userId(op.committer);
    switch (op.kind) {
        case "create": return {kind: "create", committer};
        case "selfUpdate": return {kind: "selfUpdate", committer};
        case "add": return {kind: "add", committer, addedUsers: op.members.map(userId), positions: op.positions};
        case "remove": return {kind: "remove", committer, removedUsers: op.removed.map(userId), blankedPositions: plan.blankedPositions};
    }
}

/** Plans `op` on `tree` and runs it through the production validator — the `TreeCommit` storage receives. */
export function acceptedCommit(tree: types.cloud.GroupTreeState, keyVersion: number, op: PlanOp): {plan: Plan, commit: TreeCommit} {
    const plan = planCommit(tree, keyVersion, op);
    const result = TreeTransitionValidator.validateCommit(
        {numLeaves: tree.numLeaves, leafAssignment: tree.leafAssignment, keyVersion, nodes: tree.nodes},
        commitOpFor(op, plan),
        {baseKeyVersion: keyVersion, refreshedNodes: plan.refreshedNodes, edges: plan.edges},
    );
    if (!result.ok) {
        throw new Error(`honest commit refused: ${JSON.stringify(result.rejections)}`);
    }
    return {plan, commit: result.commit};
}

/**
 * A well-formed tree for the given seating, as created by `creator` (default: the first seated member) and then
 * carried to `keyVersion` — the grant edge is the only part of a tree that names the epoch. `""` marks a blank.
 */
export function buildTree(assignment: string[], keyVersion: number, creator?: string): types.cloud.GroupTreeState {
    const empty: types.cloud.GroupTreeState = {numLeaves: assignment.length, leafAssignment: assignment.map(userId), nodes: [], edges: []};
    const tree = planCommit(empty, 0, {kind: "create", committer: creator ?? assignment.find(a => a !== "")!}).after;
    tree.edges.find(edge => edge.isGrantEdge)!.parentGeneration = keyVersion;
    return tree;
}

export function cloneTree(tree: types.cloud.GroupTreeState): types.cloud.GroupTreeState {
    return JSON.parse(JSON.stringify(tree)) as types.cloud.GroupTreeState;
}

/** The wire transitions a plan becomes. */
export function additionOf(plan: Plan, keyVersion: number, positions: number[]): types.cloud.GroupTreeAdditionTransition {
    return {baseKeyVersion: keyVersion, positions, seatedNodes: plan.refreshedNodes, edges: plan.edges};
}

export function removalOf(plan: Plan, keyVersion: number): types.cloud.GroupTreeTransition {
    return {baseKeyVersion: keyVersion, blankedPositions: plan.blankedPositions, refreshedNodes: plan.refreshedNodes, edges: plan.edges};
}

export function selfUpdateOf(plan: Plan, keyVersion: number): types.cloud.GroupTreeSelfUpdateTransition {
    return {baseKeyVersion: keyVersion, refreshedNodes: plan.refreshedNodes, edges: plan.edges};
}

/** The addition delta an honest adder submits. */
export function additionTransition(tree: types.cloud.GroupTreeState, keyVersion: number, committer: string, members: string[], positions: number[]) {
    return additionOf(planCommit(tree, keyVersion, {kind: "add", committer, members, positions}), keyVersion, positions);
}

/** The removal delta an honest remover submits. */
export function removalTransition(tree: types.cloud.GroupTreeState, keyVersion: number, committer: string, removed: string[]) {
    return removalOf(planCommit(tree, keyVersion, {kind: "remove", committer, removed}), keyVersion);
}

/** The self-update an honest member submits. */
export function selfUpdateTransition(tree: types.cloud.GroupTreeState, keyVersion: number, committer: string) {
    return selfUpdateOf(planCommit(tree, keyVersion, {kind: "selfUpdate", committer}), keyVersion);
}

/** What `groupGet` serves, as far as planning a commit against it goes. */
export interface ServedGroup {
    id: string;
    numLeaves: number;
    leafAssignment: types.cloud.UserId[];
    treeNodes: types.cloud.GroupTreeNode[];
    treeEdges: types.cloud.GroupTreeEdge[];
    keyVersion: number;
    groupPubKey: types.cloud.GroupPubKey;
    rosterVersion: number;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    treeCommit?: types.cloud.GroupTreeCommitStatement;
}

/**
 * Plans `op` against a served group (scope `"plan"` or `"full"`) and signs its statement — what a client does
 * end to end. `groupPubKey` is the new grant key of a removal; added members join as users.
 */
export function commitAgainst(served: ServedGroup, op: PlanOp, groupPubKey?: types.cloud.GroupPubKey) {
    const tree = {numLeaves: served.numLeaves, leafAssignment: served.leafAssignment, nodes: served.treeNodes, edges: served.treeEdges};
    const plan = planCommit(tree, served.keyVersion, op, (served.treeCommit?.seq ?? 0) + 1);
    const leaving = new Set<string>(op.kind === "remove" ? op.removed : []);
    const commit = statementFor(plan, op, {
        groupId: served.id,
        groupPubKey: groupPubKey ?? served.groupPubKey,
        rosterVersion: served.rosterVersion + (op.kind === "selfUpdate" ? 0 : 1),
        users: [...served.users.filter(u => !leaving.has(u)), ...(op.kind === "add" ? op.members : [])],
        managers: served.managers.filter(u => !leaving.has(u)),
    });
    return {plan, commit};
}

/**
 * The one edge a rotation writes: the new grant key wrapped to the root, which the rotation does not move.
 *
 * `childGeneration` is taken from the tree rather than assumed, so a fixture built against a refreshed root
 * stays honest — that is exactly the staleness the bridge checks for.
 */
export function rotationGrantEdge(tree: types.cloud.GroupTreeState, newKeyVersion: number): types.cloud.GroupTreeEdge {
    const rootIndex = TreeMath.root(tree.numLeaves);
    const root = tree.nodes.find(node => node.nodeIndex === rootIndex);
    return {
        isGrantEdge: true,
        parentGeneration: newKeyVersion,
        childKind: "node",
        childIndex: rootIndex,
        childGeneration: root?.generation ?? 0,
        data: `wrap:grant->${rootIndex}` as types.core.UserKeyData,
    };
}

/** One epoch's worth of well-formed rungs, as an honest client would submit them. */
export function rungsFor(newKeyVersion: number, eraFloor: number): types.cloud.GroupArchiveRung[] {
    return LadderMath.rungSpansFor(newKeyVersion, eraFloor).map(span => ({
        atKeyVersion: span.at,
        targetKeyVersion: span.target,
        // `epoch`: addressed to the grant key at `at` and naming nobody, which is the ordinary rung and the one
        // ciphertext that serves the whole group. `user`/`group` are the era-crossing kinds, and those have to
        // name their recipient.
        recipientKind: "epoch" as const,
        data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
    }));
}
