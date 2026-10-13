/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-empty-function */

import "q2-test";
import * as assert from "assert";
import { RepositoryFactory } from "../../../db/RepositoryFactory";
import { CloudKeyService } from "../../../service/cloud/CloudKeyService";
import { GroupNotificationService } from "../../../service/cloud/GroupNotificationService";
import { GroupRepository } from "../../../service/cloud/GroupRepository";
import { GroupService } from "../../../service/cloud/GroupService";
import { createMock, fakeRateLimiter, hasNoCalls, hasOneCall, mock } from "../../testUtils/TestUtils";
import { buildTree, creationStatement, planCommit, PlanOp, settersOf, signStatement, statementFor, userKeys } from "../../testUtils/TreeFixtures";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import * as mongodb from "mongodb";
import { ContextUserRepository } from "../../../service/cloud/ContextUserRepository";
import { DateUtils } from "../../../utils/DateUtils";
import { AppException } from "../../../api/AppException";
import { CloudAclChecker } from "../../../service/cloud/CloudAclChecker";
import { PolicyService } from "../../../service/cloud/PolicyService";
import { CloudUser } from "../../../CommonTypes";
import { CloudAccessValidator } from "../../../service/cloud/CloudAccessValidator";
import { ActiveUsersMap } from "../../../cluster/master/ipcServices/ActiveUsers";
import { TreeMath } from "../../../service/cloud/keytree/TreeMath";
import { CommitStatement } from "../../../service/cloud/keytree/CommitStatement";
import { LadderMath } from "../../../service/cloud/keytree/LadderMath";
import { Config } from "../../../cluster/common/ConfigUtils";
import { TypesValidator } from "../../../api/TypesValidator";
import type { RotatedAlreadyData } from "../../../api/main/context/ContextApiTypes";

/**
 * Service-level tests for tree-backed group membership — the bridge's half of the contract, which is entirely
 * structural: exactly the path refreshed, no epoch rotated by an addition, no rung pointing upwards. That each
 * wrap really contains the key it claims is the endpoint's half, tested there.
 *
 * Tests marked SECURITY guard confidentiality and fail silently at runtime if the guard regresses.
 */

const solutionId = "MySolutionId" as types.cloud.SolutionId;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const keyId = "SomeKeyId" as types.core.KeyId;
const newKeyId = "AnotherKeyId" as types.core.KeyId;
/** What a creator names the group by in its first statement, before the bridge assigns an id. */
const RESOURCE_ID = "8b3f4c2e-1d5a-4e6b-9c7d-0a1b2c3d4e5f" as types.core.ClientResourceId;
/** What the winner of a CAS race committed, so a loser can tell an honest winner from a bridge inventing one. */
const data = "SomeGroupData" as types.group.GroupData;

// The keys the fixtures sign statements with, so the service's signature check sees the members' context keys.
const janekPub = userKeys("janek").pub58;
const alicePub = userKeys("alice").pub58;
const groupPubKey = janekPub as unknown as types.cloud.GroupPubKey;
const nextGroupPubKey = alicePub as unknown as types.cloud.GroupPubKey;

const janek = "janek" as types.cloud.UserId;   // manager
const alice = "alice" as types.cloud.UserId;   // member
const bob = "bob" as types.cloud.UserId;       // member
const carol = "carol" as types.cloud.UserId;   // member
const dave = "dave" as types.cloud.UserId;     // outsider, seated by addMember

const SEATING = ["janek", "alice", "bob", "carol"];
const EPOCH = 5;

const janekCloudUser = new CloudUser(janekPub);
const aliceCloudUser = new CloudUser(alicePub);

const myContext: db.context.Context = {
    id: contextId,
    created: DateUtils.now(),
    modified: DateUtils.now(),
    description: "" as types.context.ContextDescription,
    name: "" as types.context.ContextName,
    scope: "private",
    shares: [],
    solution: solutionId,
    policy: {},
};

function contextUser(userId: types.cloud.UserId, pub: types.cloud.UserPubKey): db.context.ContextUser {
    return {
        id: (userId + "-ctx") as db.context.ContextUserId,
        created: DateUtils.now(),
        contextId: contextId,
        userId: userId,
        userPubKey: pub,
        acl: "ALLOW ALL" as types.cloud.ContextAcl,
    };
}

const janekUser = contextUser(janek, janekPub);
const aliceUser = contextUser(alice, alicePub);

/**
 * The group document paired with its tree.
 *
 * The tree lives in its own collections now, so the document itself carries only the seating. The fixture keeps
 * the two together because a test almost always wants to talk about both, and `createGroupService` serves the
 * tree from here the way the repository serves it from `groupTreeNode`/`groupTreeEdge`.
 */
type TreeGroup = db.group.Group&{tree: types.cloud.GroupTreeState};

/** A tree-backed group at epoch 5 with four members, janek being the only manager. */
function treeBackedGroup(overrides: Partial<TreeGroup> = {}): TreeGroup {
    const tree = overrides.tree ?? buildTree(SEATING, EPOCH);
    return {
        id: groupId,
        contextId: contextId,
        groupPubKey: groupPubKey,
        createDate: DateUtils.now(),
        creator: janek,
        lastModificationDate: DateUtils.now(),
        lastModifier: janek,
        keyId: keyId,
        users: [alice, bob, carol],
        managers: [janek],
        publicMetaVersion: 1 as types.group.GroupVersion,
        privateMetaVersion: 1 as types.group.GroupVersion,
        rosterVersion: 1,
        policy: {},
        keyVersion: EPOCH,
        eraFloor: 1,
        treeVersion: TreeMath.TREE_VERSION,
        // Every record of a `buildTree` tree was set by statement 1; the fixtures sign the next commit as 2.
        treeCommitSeq: Math.max(1, ...tree.nodes.map(node => node.setBy ?? 0)),
        numLeaves: tree.numLeaves,
        leafAssignment: tree.leafAssignment,
        ...overrides,
        tree: tree,
    };
}

function createGroupService(group: TreeGroup = treeBackedGroup(), options: {rateLimited?: boolean, casMiss?: boolean, rungs?: types.cloud.GroupArchiveRung[], maxGroupMembers?: number,
    publicMetaKeyVersion?: number, privateMetaKeyVersion?: number} = {}) {
    let archiveWindow: {from?: number, to?: number}|null = null;
    const repositoryFactory = createMock<RepositoryFactory>({});
    const cloudKeyService = createMock<CloudKeyService>({});
    const groupNotificationService = createMock<GroupNotificationService>({});
    const groupRepository = createMock<GroupRepository>({});
    const contextUserRepository = createMock<ContextUserRepository>({});
    const cloudAclChecker = new CloudAclChecker();
    const policyService = new PolicyService();
    const cloudAccessValidator = createMock<CloudAccessValidator>({});
    const activeUsersMap = createMock<ActiveUsersMap>({});
    const groupRotationRateLimiter = fakeRateLimiter(() => !options.rateLimited);
    const groupService = new GroupService(
        repositoryFactory, activeUsersMap, "localhost" as types.core.Host, cloudKeyService, groupNotificationService,
        cloudAclChecker, policyService, cloudAccessValidator, groupRotationRateLimiter,
        {maxGroupMembers: options.maxGroupMembers ?? TypesValidator.MAX_GROUP_MEMBERS, maxGroupRotationsPerHour: 60} as Config,
    );
    
    mock(repositoryFactory, "createGroupRepository", () => groupRepository);
    mock(repositoryFactory, "createContextUserRepository", () => contextUserRepository);
    mock(repositoryFactory, "withTransaction", f => f({} as mongodb.ClientSession));
    
    mock(cloudKeyService, "checkUsersExistance", async () => {});
    mock(cloudKeyService, "buildKeys", (() => []) as never);
    mock(cloudKeyService, "checkKeysAndUsersDuringCreation", async () => []);
    
    mock(groupRepository, "get", async (id) => id === groupId ? group : null);
    mock(groupRepository, "createGroup", async () => group);
    // The tree and the keyIds come from their own collections now; the service asks the repository for them.
    mock(groupRepository, "getTree", async () => group.tree);
    mock(groupRepository, "getHistoryKeyIds", async () => [keyId]);
    mock(groupRepository, "getHistory", (async () => []) as never);
    mock(groupRepository, "getEpochKeys", (async () => []) as never);
    mock(groupRepository, "hasEpochWithGroupPubKey", (async (_id: types.group.GroupId, key: types.cloud.GroupPubKey) => key === group.groupPubKey) as never);
    mock(groupRepository, "getRootNode", (async () =>
        group.tree.nodes.find(n => n.nodeIndex === TreeMath.root(group.numLeaves))) as never);
    mock(groupRepository, "getArchiveRungs", (async (_id: types.group.GroupId, from?: number, to?: number) => {
        // Stands in for the indexed range read — the window itself is the repository's business, so what these
        // tests check is that the service hands it over untouched.
        archiveWindow = {from, to};
        return options.rungs ?? [];
    }) as never);
    const applied = options.casMiss ? (async () => null) : (async () => group as db.group.Group);
    mock(groupRepository, "addMembersWithTransition", applied as never);
    mock(groupRepository, "removeMembersWithTransition", applied as never);
    mock(groupRepository, "selfUpdateWithTransition", (async () => !options.casMiss) as never);
    // A commit is checked against every node record of the group.
    mock(groupRepository, "getNodes", (async () => group.tree.nodes) as never);
    mock(groupRepository, "getTreeCommitsAt", (async (_id: types.group.GroupId, seqs: number[]) => seqs
        .map(seq => seq === group.treeCommitSeq ? storedLatest(group) : {seq, committer: settersOf(group.tree).get(seq)})
        .filter(statement => statement.committer)) as never);
    mock(groupRepository, "getTreeCommitRange", (async (_id: types.group.GroupId, from: number, to: number) =>
        Array.from({length: to - from}, (_, i) => from + i + 1).map(seq => ({
            seq, statement: {seq}, ...(seq === 1 ? {genesis: {users: group.users, managers: group.managers}} : {}),
        }))) as never);
    // Where each metadata entry sits. Cutting or pruning above either would strand it, so the service reads
    // both first.
    mock(groupRepository, "getMetaHeadKeyVersions", (async () => ({
        publicMeta: options.publicMetaKeyVersion ?? group.keyVersion,
        privateMeta: options.privateMetaKeyVersion ?? group.keyVersion,
    })) as never);
    mock(groupRepository, "cutEra", (options.casMiss ? async () => null : async (g: db.group.Group, floor: number) => ({...g, eraFloor: floor})) as never);
    mock(groupRepository, "pruneArchive", (options.casMiss ? async () => null : async (g: db.group.Group, below: number) => ({...g, archivePrunedBelow: below})) as never);
    
    mock(contextUserRepository, "getUsers", async () => []);
    mock(activeUsersMap, "getUsersState", async () => []);
    mock(groupNotificationService, "sendCreatedGroup", () => {});
    mock(groupNotificationService, "sendUpdatedGroup", () => {});
    
    mock(cloudAccessValidator, "getUserFromContext", async (cloudUser, ctx) => {
        const usersByPub: Record<string, db.context.ContextUser> = {[janekPub]: janekUser, [alicePub]: aliceUser};
        const user = ctx === contextId ? usersByPub[cloudUser.pub] ?? null : null;
        if (!user) {
            throw new AppException("ACCESS_DENIED");
        }
        return {user, context: myContext};
    });
    mock(cloudAccessValidator, "checkIfCanExecuteInContext", async (executor, ctx, onCloudUser) => {
        const ctxId = typeof ctx === "string" ? ctx : ctx.id;
        const {user, context} = await cloudAccessValidator.getUserFromContext(executor as CloudUser, ctxId);
        await onCloudUser(user, context);
        return context;
    });
    
    return {groupService, groupRepository, groupNotificationService, groupRotationRateLimiter, cloudKeyService, group, getArchiveWindow: () => archiveWindow};
}

/** What storage holds at the group's `treeCommitSeq`, as far as the next statement reads it: its digest and date. */
function storedLatest(group: TreeGroup): types.cloud.GroupTreeCommitStatement {
    const seq = group.treeCommitSeq ?? 0;
    return {seq, prevDigest: "", op: "selfUpdate", groupId: group.id, treeVersion: 2, date: 0, keyVersion: 1,
        groupPubKey: "pk" as types.cloud.GroupPubKey, rosterVersion: 1, rosterHash: "00".repeat(32), treeHash: "00".repeat(32),
        committer: (settersOf(group.tree).get(seq) ?? janek) as types.cloud.UserId, committerPubKey: "pub" as types.cloud.UserPubKey,
        committerSeat: 0, path: [], addedUsers: [], addedManagers: [], removed: [], signature: "sig" as types.core.EccSignature};
}

/** The commit an honest `committer` plans for `op`, with its signed statement; the roster after it is derived. */
function honestCommit(group: TreeGroup, op: PlanOp, overrides: {groupPubKey?: types.cloud.GroupPubKey, addedManagers?: string[]} = {}) {
    const plan = planCommit(group.tree, group.keyVersion, op);
    const leaving = new Set(op.kind === "remove" ? op.removed : []);
    const added = op.kind === "add" ? op.members : [];
    const addedManagers = overrides.addedManagers ?? [];
    const commit = statementFor(plan, op, {
        groupId: group.id,
        groupPubKey: overrides.groupPubKey ?? group.groupPubKey,
        rosterVersion: group.rosterVersion + (op.kind === "selfUpdate" ? 0 : 1),
        users: [...group.users.filter(u => !leaving.has(u)), ...added.filter(m => !addedManagers.includes(m))],
        managers: [...group.managers.filter(u => !leaving.has(u)), ...addedManagers],
        addedManagers,
        previous: storedLatest(group),
    });
    return {plan, commit};
}

function additionCommit(group: TreeGroup, members: types.cloud.UserId[], positions: number[]) {
    const {plan, commit} = honestCommit(group, {kind: "add", committer: janek, members, positions});
    return {transition: {baseKeyVersion: group.keyVersion, positions, seatedNodes: plan.refreshedNodes, edges: plan.edges}, commit};
}

function removalCommit(group: TreeGroup, removed: types.cloud.UserId[]) {
    const {plan, commit} = honestCommit(group, {kind: "remove", committer: janek, removed}, {groupPubKey: nextGroupPubKey});
    return {transition: {baseKeyVersion: group.keyVersion, blankedPositions: plan.blankedPositions, refreshedNodes: plan.refreshedNodes, edges: plan.edges}, commit};
}

/** A creation's statement, signed by janek, for the roster the call names. */
function creation(tree: types.cloud.GroupTreeState, users: types.cloud.UserId[], managers: types.cloud.UserId[], creator = "janek") {
    return creationStatement(tree, creator, {groupId: RESOURCE_ID, groupPubKey, users, managers});
}

/** `createGroup` as janek, with the statement an honest creator signs for `tree` unless the test supplies one. */
function createGroupAs(groupService: GroupService, tree: types.cloud.GroupTreeState, users: types.cloud.UserId[], managers: types.cloud.UserId[],
    groupKeys?: Omit<types.cloud.GroupKeyEntrySet, "group">, statement = creation(tree, users, managers)) {
    return groupService.createGroup(janekCloudUser, RESOURCE_ID, contextId, undefined, groupPubKey, users, managers, data, data, data, keyId, {}, tree, statement, groupKeys);
}

/** The payload an honest client submits to seat `dave` in a blank at position 1. */
function additionModel(group: TreeGroup, position = 1, newMember: types.cloud.UserId = dave) {
    return {
        id: groupId,
        members: [{userId: newMember, role: "user" as types.cloud.ContainerRole, position}],
        // An addition does not rotate anything, so it reuses the group's current metadata keyId.
        keyId: keyId,
        data: data,
        ...additionCommit(group, [newMember], [position]),
        expectedKeyVersion: group.keyVersion,
        expectedRosterVersion: group.rosterVersion,
    };
}

/** The payload an honest client submits to remove the member at `position`, rungs included. */
function removalModel(group: TreeGroup, position: number) {
    const newEpoch = group.keyVersion + 1;
    const rungs: types.cloud.GroupArchiveRung[] = LadderMath.rungSpansFor(newEpoch, group.eraFloor ?? 1).map(span => ({
        atKeyVersion: span.at,
        targetKeyVersion: span.target,
        recipientKind: "epoch" as const,
        data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
        author: janek,
    }));
    return {
        id: groupId,
        userIds: [group.leafAssignment[position]],
        groupPubKey: nextGroupPubKey,
        keyId: newKeyId,
        data: data,
        // Removing yourself cannot be planned — there is no path left to re-key — so such a model carries an
        // empty transition, which the service refuses before reading it.
        ...(group.leafAssignment[position] === janek
            ? {transition: {baseKeyVersion: group.keyVersion, blankedPositions: [position], refreshedNodes: [], edges: []}, commit: creation(group.tree, [], [])}
            : removalCommit(group, [group.leafAssignment[position]])),
        rungs,
        expectedKeyVersion: group.keyVersion,
        expectedRosterVersion: group.rosterVersion,
    };
}

async function expectFailure(kind: Parameters<typeof AppException.is>[1], run: () => Promise<unknown>) {
    try {
        await run();
    }
    catch (e) {
        expect(AppException.is(e, kind)).toBe(true);
        return e as AppException;
    }
    throw new Error(`expected ${String(kind)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// creation
// ─────────────────────────────────────────────────────────────────────────────

it("createGroup accepts a tree-backed group with no per-member key entries", async () => {
    // Members reach the grant key by climbing, so the creator does not have to produce
    // one ciphertext per member just to hand out the current key.
    const {groupService, groupRepository} = createGroupService();
    await createGroupAs(groupService,
        buildTree(SEATING, 1),
        [alice, bob, carol], [janek],
    );
    hasOneCall(groupRepository.createGroup);
});

it("createGroup stores the metadata key as one self-addressed entry", async () => {
    const {groupService, groupRepository} = createGroupService();
    await createGroupAs(groupService,
        buildTree(SEATING, 1),
        [alice, bob, carol], [janek], {groupEpoch: 1, keyId: keyId, data: "self-addressed" as types.core.UserKeyData},
    );
    const call = groupRepository.createGroup.mock.calls[0];
    // One further along again: both metadata envelopes now sit between `data` and `keyId`.
    const groupKey = [...call][14] as types.cloud.GroupKeyEntry;
    assert.strictEqual(groupKey.groupEpoch, 1, "one entry, whatever the group's size");
});

it("createGroup refuses a self-addressed entry naming an epoch the group does not start at", async () => {
    const {groupService, groupRepository} = createGroupService();
    await expectFailure("INVALID_PARAMS", () => createGroupAs(groupService,
        buildTree(SEATING, 1),
        [alice, bob, carol], [janek], {groupEpoch: 2, keyId: keyId, data: "self-addressed" as types.core.UserKeyData},
    ));
    hasNoCalls(groupRepository.createGroup);
});

it("createGroup refuses more members than the configured limit, and says so", async () => {
    const {groupService, groupRepository} = createGroupService(treeBackedGroup(), {maxGroupMembers: 3});
    const tooMany = ["u1", "u2", "u3", "u4"].map(u => u as types.cloud.UserId);
    const error = await expectFailure("GROUP_MEMBER_LIMIT_EXCEEDED", () => createGroupAs(groupService,
        buildTree([...tooMany, janek], 1),
        tooMany, [janek],
    ));
    assert.deepStrictEqual(error.getData(), {limit: 3, requested: 5}, "the error carries both numbers");
    hasNoCalls(groupRepository.createGroup);
});

it("createGroup refuses more seats than the configured limit, blanks and all", async () => {
    // Two members in a four-seat tree: the roster is inside a limit of 3, the tree is not.
    const {groupService, groupRepository} = createGroupService(treeBackedGroup(), {maxGroupMembers: 3});
    const error = await expectFailure("GROUP_MEMBER_LIMIT_EXCEEDED", () => createGroupAs(groupService,
        buildTree(["janek", "", "bob", ""], 1),
        [bob], [janek],
    ));
    assert.deepStrictEqual(error.getData(), {limit: 3, requested: 4, seats: true}, "the error says it is about seats");
    hasNoCalls(groupRepository.createGroup);
});

it("addMember refuses to cross the limit", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group, {maxGroupMembers: 3});
    await expectFailure("GROUP_MEMBER_LIMIT_EXCEEDED", () => groupService.addMembers(janekCloudUser, additionModel(group)));
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("addMember refuses to grow the tree past the limit, blanks and all", async () => {
    // Two members in a four-seat tree, so the roster is well inside a limit of 3 — but appending at seat 4 grows
    // the tree to 5. Remove/add cycles leave blanks behind, so seats outrun members and the roster count alone
    // never bounds `leafAssignment`.
    const group = treeBackedGroup({users: [bob], tree: buildTree(["janek", "", "bob", ""], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group, {maxGroupMembers: 3});
    const error = await expectFailure("GROUP_MEMBER_LIMIT_EXCEEDED", () => groupService.addMembers(janekCloudUser, additionModel(group, 4)));
    assert.deepStrictEqual(error.getData(), {limit: 3, requested: 5, seats: true}, "the error says it is about seats");
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("createGroup rejects a tree that does not seat every member", async () => {
    const {groupService, groupRepository} = createGroupService();
    await expectFailure("GROUP_TREE_INVALID", () => createGroupAs(groupService,
        buildTree(["janek", "alice", "bob", ""], 1),
        [alice, bob, carol], [janek],
    ));
    hasNoCalls(groupRepository.createGroup);
});

it("createGroup rejects a tree leaving a keyed node unfilled", async () => {
    // The creator fills every keyed node, so no later commit starts from a blank path.
    const seating = Array.from({length: 64}, (_, i) => i === 0 ? "janek" : `u${i}`);
    const tree = buildTree(seating, 1);
    tree.nodes = tree.nodes.filter(node => node.nodeIndex !== 95);
    const {groupService, groupRepository} = createGroupService();
    const error = await expectFailure("GROUP_TREE_INVALID", () => createGroupAs(groupService,
        tree,
        seating.slice(1) as types.cloud.UserId[], [janek],
    ));
    assert.ok(JSON.stringify(error.getData()).includes("REFRESH_NOT_THE_PATH"));
    hasNoCalls(groupRepository.createGroup);
});

it("createGroup rejects a tree signed by somebody other than the caller", async () => {
    // Every node is set by the creator, and the creator is whoever is authenticated: its statement must say so.
    const {groupService, groupRepository} = createGroupService();
    const tree = buildTree(Array.from({length: 40}, (_, i) => ({0: "janek", 1: "alice", 2: "bob", 35: "carol"} as Record<number, string>)[i] ?? ""), 1, "carol");
    await expectFailure("GROUP_TREE_INVALID", () => createGroupAs(groupService, tree, [alice, bob, carol], [janek],
        undefined, creation(tree, [alice, bob, carol], [janek], "carol")));
    hasNoCalls(groupRepository.createGroup);
});

it("createGroup rejects a tree addressed to an epoch other than the first", async () => {
    const {groupService} = createGroupService();
    await expectFailure("GROUP_TREE_INVALID", () => createGroupAs(groupService,
        buildTree(SEATING, 4),
        [alice, bob, carol], [janek],
    ));
});

// ─────────────────────────────────────────────────────────────────────────────
// addMember
// ─────────────────────────────────────────────────────────────────────────────

it("addMember seats a newcomer in a blank without advancing the epoch", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository, groupNotificationService} = createGroupService(group);
    await groupService.addMembers(janekCloudUser, additionModel(group));
    hasOneCall(groupRepository.addMembersWithTransition);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("addMember appends a seat when every position is taken", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    // Growth to five leaves: node 7 becomes the root, and the grant edge re-links to it at the same epoch.
    await groupService.addMembers(janekCloudUser, additionModel(group, 4));
    hasOneCall(groupRepository.addMembersWithTransition);
});

it("SECURITY: addMember refuses a payload that advances the epoch", async () => {
    // An addition that rotated the grant key would stale every container the group can read, turning the cheap
    // operation into the expensive one — and letting one add force the whole group to re-key.
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const model = additionModel(group);
    model.transition.edges.find((e: types.cloud.GroupTreeEdge) => e.isGrantEdge)!.parentGeneration = EPOCH + 1;
    await expectFailure("GROUP_TREE_INVALID", () => groupService.addMembers(janekCloudUser, model));
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("SECURITY: addMember refuses a payload that re-keys a node off the adder's own path", async () => {
    // Only the adder's keyed path is fair game. Anything else is a key for a subtree the adder is not in — one
    // it would go on knowing after the members under it are removed.
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const model = additionModel(group);
    assert.ok(!TreeMath.keyedPath(0, 4).includes(5));
    model.transition.seatedNodes.push({
        nodeIndex: 5, fromGeneration: 0, generation: 1, publicKey: "pk:5g1" as types.core.EccPubKey,
    });
    await expectFailure("GROUP_TREE_INVALID", () => groupService.addMembers(janekCloudUser, model));
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("addMember seats a newcomer far from the adder", async () => {
    // Seat 5 is in the other half of the tree from the adder at seat 0. The adder re-keys its own path and the
    // newcomer's — here both just the root — and wraps it down to the newcomer.
    const seating = ["janek", "alice", "bob", "carol", "dave", "", "erin", "frank"];
    const roster = [alice, bob, carol, dave, "erin" as types.cloud.UserId, "frank" as types.cloud.UserId];
    const group = treeBackedGroup({users: roster, tree: buildTree(seating, EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    await groupService.addMembers(janekCloudUser, additionModel(group, 5, "grace" as types.cloud.UserId));
    const call = groupRepository.addMembersWithTransition.mock.calls[0];
    assert.ok(call, "expected the addition to be written");
    assert.strictEqual(group.keyVersion, EPOCH, "an addition must not move the epoch");
});

it("addMember refuses to seat somebody who is already a member", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.addMembers(janekCloudUser, {...additionModel(group), members: [{...additionModel(group).members[0], userId: bob}]}));
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("addMember refuses a caller working from a superseded epoch", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("ROTATED_ALREADY", () => groupService.addMembers(janekCloudUser, {...additionModel(group), expectedKeyVersion: EPOCH - 1}));
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("addMember requires a manager, not merely a member", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("ACCESS_DENIED", () => groupService.addMembers(aliceCloudUser, additionModel(group)));
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("addMember reports a lost race rather than overwriting the winner", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService} = createGroupService(group, {casMiss: true});
    await expectFailure("ROTATED_ALREADY", () => groupService.addMembers(janekCloudUser, additionModel(group)));
});

it("addMember refuses a group whose tree did not survive whatever wrote it", async () => {
    // Not a flat group — there is no such thing any more — but a group whose node collection came back empty.
    // The transition names a `fromGeneration` for nodes the bridge does not hold, and a node claimed as minted
    // when one already exists is exactly what `NODE_NOT_NEW` refuses. Nothing gets seated under nothing.
    const seating = ["janek", "", "bob", "carol"];
    const healthy = treeBackedGroup({users: [bob, carol], tree: buildTree(seating, EPOCH)});
    const gutted = treeBackedGroup({users: [bob, carol], tree: {...buildTree(seating, EPOCH), nodes: []}});
    const {groupService} = createGroupService(gutted);
    const problem = await expectFailure("GROUP_TREE_INVALID", () => groupService.addMembers(janekCloudUser, additionModel(healthy)));
    assert.ok(JSON.stringify(problem.data).includes("NODE_NOT_NEW"));
});

// ─────────────────────────────────────────────────────────────────────────────
// removeMember
// ─────────────────────────────────────────────────────────────────────────────

it("removeMember accepts an honest removal and charges the rotation budget", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupNotificationService, groupRotationRateLimiter} = createGroupService(group);
    await groupService.removeMembers(janekCloudUser, removalModel(group, 2));
    hasOneCall(groupRepository.removeMembersWithTransition);
    assert.deepStrictEqual(groupRotationRateLimiter.kept, [{key: `remove|${groupId}|${janek}`}]);
    hasOneCall(groupNotificationService.sendUpdatedGroup);
});

it("SECURITY: removeMember refuses a new epoch under the grant key of an earlier one", async () => {
    // T4-24: the key republished would reopen the new epoch to whoever held it then, the leaver included.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const error = await expectFailure("INVALID_PARAMS", () => groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), groupPubKey: group.groupPubKey}));
    assert.strictEqual(error.data, "groupPubKey of an earlier epoch");
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("removeMember works at every seat", async () => {
    for (let position = 1; position < SEATING.length; position++) {
        const group = treeBackedGroup();
        const {groupService, groupRepository} = createGroupService(group);
        await groupService.removeMembers(janekCloudUser, removalModel(group, position));
        hasOneCall(groupRepository.removeMembersWithTransition);
    }
});

it("SECURITY: removeMember refuses a refresh that skips a node on the path", async () => {
    // Skipping even one node leaves the removed member holding a key that still decrypts current content.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 2);
    const rootIndex = TreeMath.root(group.tree.numLeaves);
    model.transition.refreshedNodes = model.transition.refreshedNodes.filter((n: types.cloud.GroupTreeRefreshedNode) => n.nodeIndex !== rootIndex);
    await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("SECURITY: removeMember refuses a bumped generation carrying the old public key", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 2);
    const rootIndex = TreeMath.root(group.tree.numLeaves);
    model.transition.refreshedNodes.find((n: types.cloud.GroupTreeRefreshedNode) => n.nodeIndex === rootIndex)!.publicKey =
        group.tree.nodes.find(n => n.nodeIndex === rootIndex)!.publicKey!;
    await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("SECURITY: removeMember refuses a rung pointing upwards", async () => {
    // The single most important check in the archive: an upward rung encrypts a *later* epoch's key under an
    // earlier one, handing the member who just left everything that comes after their removal.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs.push({
        atKeyVersion: EPOCH,
        targetKeyVersion: EPOCH + 1,
        data: "rung:upwards" as types.core.UserKeyData,
    });
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("SECURITY: removeMember refuses a rung addressed to an epoch other than the one being created", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs[0] = {...model.rungs[0], atKeyVersion: EPOCH};
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
});

it("removeMember refuses a new epoch with no unit rung, which would orphan the group's history", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs = model.rungs.filter(r => r.targetKeyVersion !== EPOCH);
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
});

it("removeMember refuses a removal with no rungs at all unless it abandons history", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), rungs: []}));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("removeMember abandoning history takes no rungs and has storage close the era", async () => {
    // The removal a member who wrapped garbage to the grant edge cannot block: nobody can recover the old grant
    // key, so nobody can write a rung down to it.
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupNotificationService} = createGroupService(group);
    await groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), rungs: [], abandonHistory: true});
    hasOneCall(groupRepository.removeMembersWithTransition);
    const params = (groupRepository.removeMembersWithTransition as unknown as {mock: {calls: {abandonHistory?: boolean, rungs: unknown[]}[][]}}).mock.calls[0][0];
    assert.strictEqual(params.abandonHistory, true);
    assert.deepStrictEqual(params.rungs, []);
    // It cuts the era, so members are told so as well as about the removal.
    const kinds = (groupNotificationService.sendUpdatedGroup as unknown as {mock: {calls: unknown[][]}}).mock.calls.map(call => call[2]);
    assert.deepStrictEqual(kinds, ["memberRemoved", "eraCut"]);
});

it("removeMember abandoning history needs the right to cut the era as well", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const acl = janekUser.acl;
    janekUser.acl = ["ALLOW ALL", "DENY context/groupCutEra"].join("\n") as types.cloud.ContextAcl;
    try {
        await groupService.removeMembers(janekCloudUser, removalModel(group, 2));
        hasOneCall(groupRepository.removeMembersWithTransition);
        await expectFailure("ACCESS_DENIED", () => groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), rungs: [], abandonHistory: true}));
        hasOneCall(groupRepository.removeMembersWithTransition);
    }
    finally {
        janekUser.acl = acl;
    }
});

it("removeMember abandoning history refuses rungs", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), abandonHistory: true}));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("removeMember refuses a rung reaching below a cut era", async () => {
    const group = treeBackedGroup({eraFloor: 4});
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs.push({
        atKeyVersion: EPOCH + 1,
        targetKeyVersion: 2,
        data: "rung:below-floor" as types.core.UserKeyData,
    });
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
});

it("removeMember refuses a rung reaching below the prune watermark", async () => {
    const group = treeBackedGroup({archivePrunedBelow: 4});
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs.push({
        atKeyVersion: EPOCH + 1,
        targetKeyVersion: 3,
        data: "rung:below-watermark" as types.core.UserKeyData,
    });
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
});

it("removeMember refuses a rung carrying no ciphertext", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs[0] = {...model.rungs[0], data: "" as types.core.UserKeyData};
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
});

it("removeMember refuses a rung whose recipient does not match its kind", async () => {
    // `recipientKind`/`recipient` are part of a rung's derived id. An `epoch` rung names nobody — that is what
    // makes it one ciphertext for the whole group — and the era-crossing kinds have to name who they are for;
    // either one filled in wrong is a coordinate the next submission of the same span would not land on.
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const namedEpochRung = removalModel(group, 2);
    namedEpochRung.rungs[0] = {...namedEpochRung.rungs[0], recipientKind: "epoch", recipient: "dave"};
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, namedEpochRung));
    
    const anonymousUserRung = removalModel(group, 2);
    anonymousUserRung.rungs[0] = {...anonymousUserRung.rungs[0], recipientKind: "user", recipient: undefined};
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, anonymousUserRung));
});

it("removeMember refuses to remove somebody who is not a member", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), userIds: [dave]}));
});

it("removeMember refuses to empty the group", async () => {
    // The last member can only be removed by themselves, which is refused first; the manager policy and the
    // service's own last-member guard sit behind that. Either way the group cannot be emptied: an empty tree has
    // no occupied leaf and no client could ever climb it again.
    const soloSeating = ["janek"];
    const group = treeBackedGroup({users: [], managers: [janek], tree: buildTree(soloSeating, EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.removeMembers(janekCloudUser, {
        ...removalModel(group, 0), userIds: [janek],
    }));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("SECURITY: removeMember refuses a caller removing themselves, before anything else", async () => {
    // The remover mints the new grant key: removing yourself would make the member who is supposed to lose the
    // epoch the one who chooses it.
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService(group);
    const error = await expectFailure("INVALID_PARAMS", () => groupService.removeMembers(janekCloudUser, {
        ...removalModel(group, 2), userIds: [bob, janek],
    }));
    assert.strictEqual(error.getData(), "cannot remove yourself");
    hasNoCalls(groupRotationRateLimiter.reserve);
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("removeMember re-keys the remover's path, not the departing member's", async () => {
    const seating = Array.from({length: 64}, (_, i) => `u${i}`);
    seating[0] = "janek";
    seating[40] = "bob";
    const roster = seating.filter(u => u !== "janek") as types.cloud.UserId[];
    const group = treeBackedGroup({users: roster, tree: buildTree(seating, EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 40);
    assert.deepStrictEqual(model.transition.refreshedNodes.map(n => n.nodeIndex), [31, 63]);
    await groupService.removeMembers(janekCloudUser, model);
    const commit = (groupRepository.removeMembersWithTransition.mock.calls[0][0] as {commit: {blanked: number[]}}).commit;
    assert.deepStrictEqual(commit.blanked, [95], "the departing member's own keyed node is blanked by the bridge");
});

it("SECURITY: removeMember refuses a remover re-keying the departing member's path", async () => {
    const seating = Array.from({length: 64}, (_, i) => `u${i}`);
    seating[0] = "janek";
    seating[40] = "bob";
    const group = treeBackedGroup({users: seating.filter(u => u !== "janek") as types.cloud.UserId[], tree: buildTree(seating, EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 40);
    model.transition.refreshedNodes = model.transition.refreshedNodes.map(n => n.nodeIndex === 31 ? {...n, nodeIndex: 95, fromGeneration: undefined, generation: 0} : n);
    const error = await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
    assert.ok(JSON.stringify(error.getData()).includes("REFRESH_NOT_THE_PATH"));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("removeMember respects the rate limit", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group, {rateLimited: true});
    await expectFailure("GROUP_ROTATION_RATE_LIMIT", () => groupService.removeMembers(janekCloudUser, removalModel(group, 2)));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("SECURITY: removeMember is charged to the remover's own removal budget, never to the rotations'", async () => {
    // One budget shared by rotations and removals let a member allowed to rotate keep it empty, and with it
    // the removal of themselves.
    const group = treeBackedGroup();
    const {groupService, groupRotationRateLimiter} = createGroupService(group);
    await groupService.removeMembers(janekCloudUser, removalModel(group, 2));
    // And to nothing else: `remove` and the remover's own lost races are the only budgets a removal checks.
    assert.deepStrictEqual(groupRotationRateLimiter.reserve.mock.calls.map(call => call[0]),
        [{key: `remove|${groupId}|${janek}`}, {key: `stale|${groupId}|${janek}`, limit: 600}]);
    assert.deepStrictEqual(groupRotationRateLimiter.kept, [{key: `remove|${groupId}|${janek}`}]);
});

it("removeMember requires a manager", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("ACCESS_DENIED", () => groupService.removeMembers(aliceCloudUser, removalModel(group, 2)));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("removeMember refuses bad rungs before hashing the tree, and charges nothing", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService(group);
    const model = removalModel(group, 2);
    model.rungs = [];
    await expectFailure("GROUP_ARCHIVE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
    hasNoCalls(groupRepository.getNodes);
    assert.deepStrictEqual(groupRotationRateLimiter.kept, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// the metadata key: one wrap, not one per member
// ─────────────────────────────────────────────────────────────────────────────

/** The self-addressed metadata key a removal submits: one ciphertext, opened by climbing to the grant key. */
function selfKey(epoch: number, keyId_: types.core.KeyId = newKeyId): types.cloud.GroupKeyEntrySet {
    return {group: groupId, groupEpoch: epoch, keyId: keyId_, data: "metadata-key" as types.core.UserKeyData};
}

it("removeMember stores the metadata key wrapped once to the group itself", async () => {
    // Rotating the metadata key on a removal costs one wrap, not one per remaining member.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), groupKeys: selfKey(EPOCH + 1)});
    hasOneCall(groupRepository.removeMembersWithTransition);
});

it("removeMember hands the repository only the new epoch's metadata key, for that epoch's own row", async () => {
    // Earlier epochs' keys stay in their own rows (`groupEpochKey`); nothing re-sends them with every rotation.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    let stored: types.cloud.GroupKeyEntry|undefined;
    mock(groupRepository, "removeMembersWithTransition", (async (params: {groupKey?: types.cloud.GroupKeyEntry}) => {
        stored = params.groupKey;
        return group;
    }) as never);
    await groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), groupKeys: selfKey(EPOCH + 1)});
    assert.deepStrictEqual(stored, {keyId: newKeyId, data: "metadata-key", groupEpoch: EPOCH + 1});
});

it("SECURITY: removeMember refuses a metadata key addressed to a different group", async () => {
    // Wrapping this group's metadata key to another group would hand it to that group's members, who are not
    // members here.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.removeMembers(janekCloudUser, {
        ...removalModel(group, 2),
        groupKeys: {...selfKey(EPOCH + 1), group: "other-group" as types.group.GroupId},
    }));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("SECURITY: removeMember refuses a metadata key wrapped to an earlier epoch", async () => {
    // An entry wrapped to the *old* grant key would still open for the member being removed — that is the key
    // they hold. This is the check that keeps the O(1) path as strong as the O(n) one it replaces.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.removeMembers(janekCloudUser, {
        ...removalModel(group, 2), groupKeys: selfKey(EPOCH),
    }));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("removeMember refuses a metadata key naming a keyId other than the one being introduced", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    await expectFailure("INVALID_PARAMS", () => groupService.removeMembers(janekCloudUser, {
        ...removalModel(group, 2), groupKeys: selfKey(EPOCH + 1, keyId),
    }));
});

it("removeMember still accepts a removal with no metadata rotation at all", async () => {
    // Rotating the metadata key is the caller's choice; the grant key rotates either way, so the removal is
    // effective for content regardless.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await groupService.removeMembers(janekCloudUser, removalModel(group, 2));
    hasOneCall(groupRepository.removeMembersWithTransition);
});

// ─────────────────────────────────────────────────────────────────────────────
// era floor and pruning
// ─────────────────────────────────────────────────────────────────────────────

it("cutEra raises the floor", async () => {
    const {groupService, groupRepository} = createGroupService();
    await groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH});
    hasOneCall(groupRepository.cutEra);
});

it("cutEra refuses to lower a floor, which would resurrect abandoned epochs", async () => {
    const {groupService, groupRepository} = createGroupService(treeBackedGroup({eraFloor: 4}));
    await expectFailure("INVALID_PARAMS", () => groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 2, expectedKeyVersion: EPOCH}));
    hasNoCalls(groupRepository.cutEra);
});

it("cutEra refuses a floor above the current epoch", async () => {
    const {groupService} = createGroupService();
    await expectFailure("INVALID_PARAMS", () => groupService.cutEra(janekCloudUser, {id: groupId, newFloor: EPOCH + 1, expectedKeyVersion: EPOCH}));
});

// An entry stays at the epoch it was written under, so a floor above it takes away the only route to its key —
// permanently, for everybody. The planes move independently, so only one may be stranded, and the message has to
// name which: rewriting the wrong plane costs the client a freshly signed envelope for nothing. Written as four
// cases because an implementation that only takes `min(public, private)` passes the first, second and fourth and
// fails the "and not the other plane" half of the first two.
it("cutEra refuses a floor that strands the public plane, and names only that plane", async () => {
    const {groupService, groupRepository} = createGroupService(treeBackedGroup(), {publicMetaKeyVersion: 2, privateMetaKeyVersion: EPOCH});
    const e = await expectFailure("GROUP_META_UNREACHABLE", () => groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH}));
    expect(e.data).toContain("groupUpdatePublicMeta");
    expect(e.data).not.toContain("groupUpdatePrivateMeta");
    // Never the policy method: a policy write moves no counter and appends no entry, so it lifts no epoch, and
    // naming it would send the operator into a loop that can never clear the refusal.
    expect(e.data).not.toContain("groupUpdatePolicy");
    hasNoCalls(groupRepository.cutEra);
});

it("cutEra refuses a floor that strands the private plane, and names only that plane", async () => {
    const {groupService, groupRepository} = createGroupService(treeBackedGroup(), {publicMetaKeyVersion: EPOCH, privateMetaKeyVersion: 2});
    const e = await expectFailure("GROUP_META_UNREACHABLE", () => groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH}));
    expect(e.data).toContain("groupUpdatePrivateMeta");
    expect(e.data).not.toContain("groupUpdatePublicMeta");
    expect(e.data).not.toContain("groupUpdatePolicy");
    hasNoCalls(groupRepository.cutEra);
});

it("cutEra names both planes when both are stranded", async () => {
    const {groupService} = createGroupService(treeBackedGroup(), {publicMetaKeyVersion: 2, privateMetaKeyVersion: 2});
    const e = await expectFailure("GROUP_META_UNREACHABLE", () => groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH}));
    expect(e.data).toContain("groupUpdatePublicMeta");
    expect(e.data).toContain("groupUpdatePrivateMeta");
});

it("cutEra allows a floor both planes sit at or above", async () => {
    // Without this the three refusals above would also pass with the check hardwired to refuse everything.
    const {groupService, groupRepository} = createGroupService(treeBackedGroup(), {publicMetaKeyVersion: 3, privateMetaKeyVersion: 4});
    await groupService.cutEra(janekCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH});
    hasOneCall(groupRepository.cutEra);
});

it("cutEra requires a manager", async () => {
    const {groupService} = createGroupService();
    await expectFailure("ACCESS_DENIED", () => groupService.cutEra(aliceCloudUser, {id: groupId, newFloor: 3, expectedKeyVersion: EPOCH}));
});

it("pruneArchive records a watermark", async () => {
    const {groupService, groupRepository} = createGroupService();
    await groupService.pruneArchive(janekCloudUser, {id: groupId, belowEpoch: 3, expectedKeyVersion: EPOCH});
    hasOneCall(groupRepository.pruneArchive);
});

it("pruneArchive refuses a watermark that strands the public plane, and names only that plane", async () => {
    const {groupService, groupRepository} = createGroupService(treeBackedGroup(), {publicMetaKeyVersion: 2, privateMetaKeyVersion: EPOCH});
    const e = await expectFailure("GROUP_META_UNREACHABLE", () => groupService.pruneArchive(janekCloudUser, {id: groupId, belowEpoch: 3, expectedKeyVersion: EPOCH}));
    expect(e.data).toContain("groupUpdatePublicMeta");
    expect(e.data).not.toContain("groupUpdatePrivateMeta");
    hasNoCalls(groupRepository.pruneArchive);
});

it("pruneArchive refuses a watermark that strands the private plane, and names only that plane", async () => {
    const {groupService, groupRepository} = createGroupService(treeBackedGroup(), {publicMetaKeyVersion: EPOCH, privateMetaKeyVersion: 2});
    const e = await expectFailure("GROUP_META_UNREACHABLE", () => groupService.pruneArchive(janekCloudUser, {id: groupId, belowEpoch: 3, expectedKeyVersion: EPOCH}));
    expect(e.data).toContain("groupUpdatePrivateMeta");
    expect(e.data).not.toContain("groupUpdatePublicMeta");
    hasNoCalls(groupRepository.pruneArchive);
});

it("pruneArchive refuses to prune past the current epoch", async () => {
    const {groupService, groupRepository} = createGroupService();
    await expectFailure("INVALID_PARAMS", () => groupService.pruneArchive(janekCloudUser, {id: groupId, belowEpoch: EPOCH + 2, expectedKeyVersion: EPOCH}));
    hasNoCalls(groupRepository.pruneArchive);
});

// ─────────────────────────────────────────────────────────────────────────────
// serving the archive
// ─────────────────────────────────────────────────────────────────────────────

const ladder: types.cloud.GroupArchiveRung[] = [2, 3, 4, 5].map(at => ({
    atKeyVersion: at,
    targetKeyVersion: at - 1,
    data: `rung:${at}` as types.core.UserKeyData,
}));

it("getKeyArchive serves the whole ladder by default", async () => {
    const {groupService, getArchiveWindow} = createGroupService(treeBackedGroup(), {rungs: ladder});
    const result = await groupService.getKeyArchive(janekCloudUser, groupId);
    expect(result.rungs.length).toBe(4);
    // No bounds asked for, no bounds imposed: the read is unwindowed rather than windowed to something invented.
    assert.deepStrictEqual(getArchiveWindow(), {from: undefined, to: undefined});
});

it("getKeyArchive windows by epoch, so a client fetches only what it is descending through", async () => {
    // The window has to reach the query — filtering a fully loaded archive is exactly what the group's state was
    // moved out of the document to stop doing.
    const {groupService, getArchiveWindow} = createGroupService(treeBackedGroup(), {rungs: ladder});
    await groupService.getKeyArchive(janekCloudUser, groupId, 3, 4);
    assert.deepStrictEqual(getArchiveWindow(), {from: 3, to: 4});
});

it("getKeyArchive is readable by an ordinary member", async () => {
    // Every rung is a ciphertext only a holder of the epoch key above it can open, so serving the archive to a
    // member reveals nothing they could not already reach by descending.
    const {groupService} = createGroupService();
    const result = await groupService.getKeyArchive(aliceCloudUser, groupId);
    expect(result.group.id).toBe(groupId);
});

// ─────────────────────────────────────────────────────────────────────────────
// batches
// ─────────────────────────────────────────────────────────────────────────────

/** Removing several members at once: one delta over the union of their paths, one epoch. */
function batchRemovalModel(group: TreeGroup, positions: number[]) {
    const newEpoch = group.keyVersion + 1;
    return {
        id: groupId,
        userIds: positions.map(position => group.leafAssignment[position]),
        groupPubKey: nextGroupPubKey,
        keyId: newKeyId,
        data: data,
        ...removalCommit(group, positions.map(position => group.leafAssignment[position])),
        rungs: LadderMath.rungSpansFor(newEpoch, group.eraFloor ?? 1).map(span => ({
            atKeyVersion: span.at,
            targetKeyVersion: span.target,
            recipientKind: "epoch" as const,
            data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
            author: janek,
        })),
        expectedKeyVersion: group.keyVersion,
        expectedRosterVersion: group.rosterVersion,
    };
}

it("removeMembers takes several at once and charges the rotation budget once", async () => {
    // The reason the batch exists: done one at a time this would advance the epoch twice, stale every container
    // the group can read twice, and spend two of the group's rotation allowance.
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService(group);
    await groupService.removeMembers(janekCloudUser, batchRemovalModel(group, [2, 3]));
    hasOneCall(groupRepository.removeMembersWithTransition);
    assert.strictEqual(groupRotationRateLimiter.kept.length, 1);
});

it("removeMembers can clear everybody but the caller in one epoch", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await groupService.removeMembers(janekCloudUser, batchRemovalModel(group, [1, 2, 3]));
    hasOneCall(groupRepository.removeMembersWithTransition);
});

it("removeMembers refuses the same member twice", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = batchRemovalModel(group, [2]);
    await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMembers(janekCloudUser, {
        ...model, userIds: [model.userIds[0], model.userIds[0]],
    }));
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

/** Seats two newcomers by appending, which is all a full four-seat fixture allows. */
function batchAdditionModel(group: TreeGroup, seats: number[], members: types.cloud.UserId[]) {
    return {
        id: groupId,
        members: members.map(userId => ({userId, role: "user" as types.cloud.ContainerRole})),
        keyId: keyId,
        data: data,
        ...additionCommit(group, members, seats),
        expectedKeyVersion: group.keyVersion,
        expectedRosterVersion: group.rosterVersion,
    };
}

it("addMembers seats several at once without advancing the epoch", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    await groupService.addMembers(janekCloudUser, batchAdditionModel(group, [4, 5], [dave, "heidi" as types.cloud.UserId]));
    hasOneCall(groupRepository.addMembersWithTransition);
});

it("addMembers refuses more members than the transition seats", async () => {
    // `members` and `transition.positions` are index-aligned, so a length mismatch is the one way they can still
    // disagree — and the tree validator is what says so.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = batchAdditionModel(group, [4, 5], [dave, "heidi" as types.cloud.UserId]);
    await expectFailure("GROUP_TREE_INVALID", () => groupService.addMembers(janekCloudUser, {
        ...model, members: [model.members[0]],
    }));
    hasNoCalls(groupRepository.addMembersWithTransition);
});

// ─────────────────────────────────────────────────────────────────────────────
// what a lost race hands back
// ─────────────────────────────────────────────────────────────────────────────

it("a lost race hands back only where the epoch is now", async () => {
    // T4-20: the endpoint re-reads and re-verifies after a lost race and adopts nothing, so the winner's metadata key
    // and confirmation tag the payload once carried were decoration, each an extra read on the error path.
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group, {casMiss: true});
    const error = await expectFailure("ROTATED_ALREADY", () => groupService.removeMembers(janekCloudUser, removalModel(group, 2)));
    assert.deepStrictEqual(error.getData() as RotatedAlreadyData, {keyVersion: EPOCH, groupPubKey: group.groupPubKey});
});

it("a roster write planned against a superseded roster version is refused", async () => {
    // The epoch is not enough of a precondition on its own: an addition moves `rosterVersion` and leaves
    // `keyVersion` alone, so a caller can hold the current epoch and still be planning against a roster that
    // has already grown. Letting that through would land the entry at a version its `rosterTag` never
    // committed to, which no reader could then verify.
    const group = treeBackedGroup({rosterVersion: 9});
    const {groupService} = createGroupService(group);
    await expectFailure("GROUP_ROSTER_VERSION_MISMATCH",
        () => groupService.addMembers(janekCloudUser, {...additionModel(group), expectedRosterVersion: 8}));
    await expectFailure("GROUP_ROSTER_VERSION_MISMATCH",
        () => groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), expectedRosterVersion: 8}));
});

// ─────────────────────────────────────────────────────────────────────────────
// selfUpdate
// ─────────────────────────────────────────────────────────────────────────────

function selfUpdateModel(group: TreeGroup, member: types.cloud.UserId) {
    return {
        id: groupId,
        ...(() => {
            const {plan, commit} = honestCommit(group, {kind: "selfUpdate", committer: member});
            return {transition: {baseKeyVersion: group.keyVersion, refreshedNodes: plan.refreshedNodes, edges: plan.edges}, commit};
        })(),
        expectedKeyVersion: group.keyVersion,
    };
}

it("selfUpdate re-keys the caller's path quietly: no epoch, no history, no event", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupNotificationService, groupRotationRateLimiter} = createGroupService(group);
    await groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice));
    hasOneCall(groupRepository.selfUpdateWithTransition);
    hasNoCalls(groupNotificationService.sendUpdatedGroup);
    // Charged to the member, in its own namespace — never to the group's rotation budget.
    // And to the group's own self-update budget, which bounds a storm whatever the group's size.
    assert.deepStrictEqual(groupRotationRateLimiter.reserve.mock.calls.map(call => call[0]), [
        {key: `selfUpdate|${groupId}|${alice}`}, {key: `selfUpdate|${groupId}`, limit: 240},
        {key: `refused|${groupId}|${alice}`}, {key: `stale|${groupId}|${alice}`, limit: 600},
    ]);
    assert.deepStrictEqual(groupRotationRateLimiter.kept, [{key: `selfUpdate|${groupId}|${alice}`}, {key: `selfUpdate|${groupId}`}]);
});

it("the group's self-update budget scales with its keyed nodes, so a blanked 16k tree can heal", async () => {
    const seating = Array.from({length: 4096}, (_, i) => i === 0 ? "janek" : i === 1 ? "alice" : `u${i}`);
    const group = treeBackedGroup({users: seating.slice(1) as types.cloud.UserId[], tree: buildTree(seating, EPOCH)});
    const {groupService, groupRotationRateLimiter} = createGroupService(group);
    await groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice));
    const groupCheck = groupRotationRateLimiter.reserve.mock.calls.map(call => call[0]).find(model => model.key === `selfUpdate|${groupId}`);
    assert.strictEqual(groupCheck?.limit, 4 * TreeMath.keyedNodes(4096).length);
});

it("a self-update losing a race (only STALE_BASE_*) is charged to the member's `stale` budget alone", async () => {
    // A healer after a removal loses many races; charging them to `refused` would lock it out of adding members,
    // and to the group's self-update budget would let one burst of losers drain it.
    const group = treeBackedGroup();
    const {groupService, groupRotationRateLimiter} = createGroupService(group);
    const model = selfUpdateModel(group, alice);
    const stale = {...model, transition: {...model.transition,
        refreshedNodes: model.transition.refreshedNodes.map(node => ({...node, fromGeneration: (node.fromGeneration ?? 0) + 7}))}};
    const error = await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(aliceCloudUser, stale));
    assert((error.getData() as {kind: string}[]).every(problem => problem.kind.startsWith("STALE_BASE_")), JSON.stringify(error.getData()));
    assert.deepStrictEqual(groupRotationRateLimiter.kept, [{key: `stale|${groupId}|${alice}`}]);
});

it("SECURITY: a removal losing a race (only STALE_BASE_*) is charged to the remover's own lost races, not its removals", async () => {
    // A healing storm makes a manager's removals lose races; charging them to `remove` would let the member being
    // removed (or the storm) lock the manager out of removing for an hour. Charging nothing would make them free.
    const group = treeBackedGroup();
    const {groupService, groupRotationRateLimiter} = createGroupService(group);
    const model = removalModel(group, 2);
    model.transition.refreshedNodes = model.transition.refreshedNodes.map((node: types.cloud.GroupTreeRefreshedNode) =>
        ({...node, fromGeneration: (node.fromGeneration ?? 0) + 7}));
    const error = await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMembers(janekCloudUser, model));
    assert((error.getData() as {kind: string}[]).every(problem => problem.kind.startsWith("STALE_BASE_")), JSON.stringify(error.getData()));
    assert.deepStrictEqual(groupRotationRateLimiter.kept, [{key: `stale|${groupId}|${janek}`}]);
});

it("the group's self-update budget refuses once spent", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService(group);
    groupRotationRateLimiter.allow = key => key !== `selfUpdate|${groupId}`;
    await expectFailure("GROUP_ROTATION_RATE_LIMIT", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice)));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("SECURITY: selfUpdate re-keys the caller's own path, whatever path the request covers", async () => {
    // Alice submits janek's path. Both reach the root, but in a 64-seat tree they differ below it.
    const seating = Array.from({length: 64}, (_, i) => `u${i}`);
    seating[0] = "janek";
    seating[40] = "alice";
    const group = treeBackedGroup({users: seating.filter(u => u !== "janek") as types.cloud.UserId[], tree: buildTree(seating, EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, janek)));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("selfUpdate is refused to somebody holding no seat", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    await expectFailure("ACCESS_DENIED", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, janek)));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("a refused selfUpdate or addition is charged to the caller's refusals, a removal to its removals, since checking it hashed the tree", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRotationRateLimiter} = createGroupService(group);
    const unsigned = <T extends {commit: types.cloud.GroupTreeCommitStatement}>(model: T): T => ({...model, commit: signStatement(model.commit, "alice")});
    await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(janekCloudUser, unsigned(selfUpdateModel(group, janek))));
    await expectFailure("GROUP_TREE_INVALID", () => groupService.addMembers(janekCloudUser, unsigned(additionModel(group))));
    await expectFailure("GROUP_TREE_INVALID", () => groupService.removeMembers(janekCloudUser, unsigned(removalModel(group, 2))));
    assert.deepStrictEqual(groupRotationRateLimiter.kept,
        [{key: `refused|${groupId}|${janek}`}, {key: `refused|${groupId}|${janek}`}, {key: `remove|${groupId}|${janek}`}]);
});

it("SECURITY: a version mismatch hands the group's key state only to somebody who may read the group", async () => {
    // alice belongs to the context but not to the group: the payload of a mismatch is not hers to see.
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService} = createGroupService(group);
    await expectFailure("ACCESS_DENIED", () => groupService.removeMembers(aliceCloudUser, {...removalModel(group, 2), expectedKeyVersion: -1}));
    await expectFailure("ACCESS_DENIED", () => groupService.removeMembers(aliceCloudUser, {...removalModel(group, 2), expectedRosterVersion: -1}));
    await expectFailure("ROTATED_ALREADY", () => groupService.removeMembers(janekCloudUser, {...removalModel(group, 2), expectedKeyVersion: -1}));
});

it("selfUpdate respects the per-member rate limit and charges nothing for a refusal", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository, groupRotationRateLimiter} = createGroupService(group, {rateLimited: true});
    await expectFailure("GROUP_ROTATION_RATE_LIMIT", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice)));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
    assert.deepStrictEqual(groupRotationRateLimiter.kept, []);
});

it("selfUpdate planned at a superseded epoch, or losing the race, is ROTATED_ALREADY", async () => {
    const group = treeBackedGroup();
    const stale = createGroupService(group);
    await expectFailure("ROTATED_ALREADY", () => stale.groupService.selfUpdate(aliceCloudUser, {...selfUpdateModel(group, alice), expectedKeyVersion: EPOCH - 1}));
    const raced = createGroupService(group, {casMiss: true});
    await expectFailure("ROTATED_ALREADY", () => raced.groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice)));
    assert.deepStrictEqual(raced.groupRotationRateLimiter.kept, []);
});

it("selfUpdate that would move the epoch is refused", async () => {
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = selfUpdateModel(group, alice);
    model.transition.edges.find(e => e.isGrantEdge)!.parentGeneration = EPOCH + 1;
    await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(aliceCloudUser, model));
});

it("no commit is accepted on a group from before tree version 2", async () => {
    const group = treeBackedGroup({treeVersion: undefined});
    const {groupService, groupRepository} = createGroupService(group);
    const error = await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice)));
    assert.ok(JSON.stringify(error.getData()).includes("UNSUPPORTED_TREE_VERSION"));
    await expectFailure("GROUP_TREE_INVALID", () => groupService.addMembers(janekCloudUser, additionModel(treeBackedGroup({treeVersion: undefined}), 4)));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
    hasNoCalls(groupRepository.addMembersWithTransition);
});

it("no commit is accepted on a group whose latest statement predates chained statements", async () => {
    // I-6: stored without `prevDigest`, it has no digest to extend; refused cleanly, not as a TypeError.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    mock(groupRepository, "getTreeCommitsAt", (async () => [{...storedLatest(group), prevDigest: undefined}]) as never);
    const error = await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice)));
    assert.ok(JSON.stringify(error.getData()).includes("UNSUPPORTED_TREE_VERSION"));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

// ─────────────────────────────────────────────────────────────────────────────
// commit statements
// ─────────────────────────────────────────────────────────────────────────────

/** The statement fields the service reported as wrong, or `["SIGNATURE"]`. */
async function statementProblems(run: () => Promise<unknown>): Promise<string[]> {
    const error = await expectFailure("GROUP_TREE_INVALID", run);
    return (error.getData() as {kind: string, field?: string}[]).map(problem => problem.kind === "BAD_COMMIT_SIGNATURE" ? "SIGNATURE" : problem.field ?? problem.kind);
}

it("every tree commit hands its statement to storage, at the next seq", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService, groupRepository} = createGroupService(group);
    const model = additionModel(group);
    await groupService.addMembers(janekCloudUser, model);
    const params = groupRepository.addMembersWithTransition.mock.calls[0][0] as {statement: types.cloud.GroupTreeCommitStatement};
    assert.strictEqual(params.statement, model.commit);
    assert.strictEqual(model.commit.seq, group.treeCommitSeq! + 1);
});

it("SECURITY: a commit whose statement is signed by somebody else is refused, for every operation", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const resign = <T extends {commit: types.cloud.GroupTreeCommitStatement}>(model: T): T => ({...model, commit: signStatement(model.commit, "alice")});
    const {groupService, groupRepository} = createGroupService(group);
    assert.deepStrictEqual(await statementProblems(() => groupService.addMembers(janekCloudUser, resign(additionModel(group)))), ["SIGNATURE"]);
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, resign(removalModel(group, 2)))), ["SIGNATURE"]);
    assert.deepStrictEqual(await statementProblems(() => groupService.selfUpdate(janekCloudUser, resign(selfUpdateModel(group, janek)))), ["SIGNATURE"]);
    hasNoCalls(groupRepository.addMembersWithTransition);
    hasNoCalls(groupRepository.removeMembersWithTransition);
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("SECURITY: a statement must name the caller's current context key, even one validly signed by another key", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = removalModel(group, 2);
    const otherKey = {...model, commit: signStatement({...model.commit, committerPubKey: userKeys("alice").pub58}, "alice")};
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, otherKey)), ["committerPubKey"]);
    hasNoCalls(groupRepository.removeMembersWithTransition);
});

it("SECURITY: a statement that does not describe the state the commit leaves behind is refused", async () => {
    // Signed by the right member, about the wrong state: a client verifying the latest statement against what the
    // bridge then serves would reject the group, so the bridge must never store it.
    const group = treeBackedGroup();
    const {groupService} = createGroupService(group);
    const model = removalModel(group, 2);
    const wrong = (patch: Partial<types.cloud.GroupTreeCommitStatement>) => ({...model, commit: signStatement({...model.commit, ...patch}, "janek")});
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, wrong({seq: model.commit.seq + 1}))), ["seq"]);
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, wrong({treeHash: "00".repeat(32)}))), ["treeHash"]);
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, wrong({rosterHash: "00".repeat(32)}))), ["rosterHash"]);
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, wrong({groupPubKey: groupPubKey}))), ["groupPubKey"]);
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, wrong({removed: []}))), ["removed"]);
    assert.deepStrictEqual(await statementProblems(() => groupService.removeMembers(janekCloudUser, wrong({op: "rotate"}))), ["op"]);
});

it("SECURITY: a statement must extend exactly the latest one stored", async () => {
    // T4-02/T4-17: what the signer saw as the history is part of what it signs; any other base is a fork.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const model = selfUpdateModel(group, alice);
    for (const prevDigest of ["", "00".repeat(32)]) {
        const forked = {...model, commit: signStatement({...model.commit, prevDigest}, alice)};
        assert.deepStrictEqual(await statementProblems(() => groupService.selfUpdate(aliceCloudUser, forked)), ["prevDigest"]);
    }
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("SECURITY: a statement dated before the one it extends is refused", async () => {
    // T4-04: dates never go back along the chain; the bridge reads the bound off the latest statement it stores.
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const latest = {...storedLatest(group), date: DateUtils.now() + 60_000};
    mock(groupRepository, "getTreeCommitsAt", (async () => [latest]) as never);
    const model = selfUpdateModel(group, alice);
    const earlier = {...model, commit: signStatement({...model.commit, prevDigest: CommitStatement.digest(latest)}, alice)};
    assert.deepStrictEqual(await statementProblems(() => groupService.selfUpdate(aliceCloudUser, earlier)), ["date"]);
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("an addition's statement names newcomers by role", async () => {
    const group = treeBackedGroup();
    const {groupService, groupRepository} = createGroupService(group);
    const {plan, commit} = honestCommit(group, {kind: "add", committer: janek, members: [dave], positions: [4]}, {addedManagers: [dave]});
    assert.deepStrictEqual([commit.addedUsers, commit.addedManagers], [[], [dave]]);
    await groupService.addMembers(janekCloudUser, {
        id: groupId, members: [{userId: dave, role: "manager"}], keyId, data,
        transition: {baseKeyVersion: EPOCH, positions: [4], seatedNodes: plan.refreshedNodes, edges: plan.edges}, commit,
        expectedKeyVersion: EPOCH, expectedRosterVersion: group.rosterVersion,
    });
    hasOneCall(groupRepository.addMembersWithTransition);
});

it("a creation's statement is seq 1, names the resourceId the creator chose, and binds the genesis roster by hash alone", async () => {
    const tree = buildTree(SEATING, 1);
    const resourceId = "6f1c5c86-2f0e-4c8e-9a51-4dfb2b3bd2b0" as types.core.ClientResourceId;
    const signed = creationStatement(tree, "janek", {groupId: resourceId, groupPubKey, users: [alice, bob, carol], managers: [janek]});
    const create = (statement: types.cloud.GroupTreeCommitStatement) => createGroupService().groupService.createGroup(
        janekCloudUser, resourceId, contextId, undefined, groupPubKey, [alice, bob, carol], [janek], data, data, data, keyId, {}, tree, statement);
    await create(signed);
    assert.deepStrictEqual(await statementProblems(() => create(creation(tree, [alice, bob, carol], [janek]))), ["groupId"]);
    assert.deepStrictEqual(await statementProblems(() => create(signStatement({...signed, seq: 2}, "janek"))), ["seq"]);
    // I-1: no deltas, or every read citing seq 1 would carry the whole roster; `getTreeCommits` serves it from seq 0.
    assert.deepStrictEqual([signed.addedUsers, signed.addedManagers], [[], []]);
    assert.deepStrictEqual(await statementProblems(() => create(signStatement({...signed, addedUsers: [alice]}, "janek"))), ["addedUsers"]);
});

it("no commit is accepted on a group from before commit statements", async () => {
    const group = treeBackedGroup({treeCommitSeq: undefined});
    const {groupService, groupRepository} = createGroupService(group);
    const error = await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice)));
    assert.ok(JSON.stringify(error.getData()).includes("UNSUPPORTED_TREE_VERSION"));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("no commit is accepted on a version 2 group: its rungs and genesis carry what version 3 binds", async () => {
    const group = treeBackedGroup({treeVersion: 2});
    const {groupService, groupRepository} = createGroupService(group);
    const error = await expectFailure("GROUP_TREE_INVALID", () => groupService.selfUpdate(aliceCloudUser, selfUpdateModel(group, alice)));
    assert.ok(JSON.stringify(error.getData()).includes("UNSUPPORTED_TREE_VERSION"));
    hasNoCalls(groupRepository.selfUpdateWithTransition);
});

it("getTreeCommits serves a page up to the latest, never past it", async () => {
    const group = treeBackedGroup({treeCommitSeq: 9});
    const {groupService} = createGroupService(group);
    assert.deepStrictEqual((await groupService.getTreeCommits(aliceCloudUser, groupId, 6)).commits.map(c => c.seq), [7, 8, 9]);
    assert.deepStrictEqual((await groupService.getTreeCommits(aliceCloudUser, groupId, 6, 7)).commits.map(c => c.seq), [7]);
    assert.deepStrictEqual((await groupService.getTreeCommits(aliceCloudUser, groupId, 6, 99)).commits.map(c => c.seq), [7, 8, 9]);
    assert.deepStrictEqual((await groupService.getTreeCommits(aliceCloudUser, groupId, 9)).commits, []);
    assert.strictEqual((await groupService.getTreeCommits(aliceCloudUser, groupId, 6)).genesis, undefined);
});

it("getTreeCommits from seq 0 serves the genesis roster beside the chain (I-1)", async () => {
    const group = treeBackedGroup({treeCommitSeq: 3});
    const {groupService} = createGroupService(group);
    assert.deepStrictEqual((await groupService.getTreeCommits(aliceCloudUser, groupId, 0)).genesis, {users: group.users, managers: group.managers});
});

it("getTreeCommits needs read access to the group", async () => {
    const group = treeBackedGroup({users: [bob, carol], tree: buildTree(["janek", "", "bob", "carol"], EPOCH)});
    const {groupService} = createGroupService(group);
    await expectFailure("ACCESS_DENIED", () => groupService.getTreeCommits(aliceCloudUser, groupId, 0));
});
