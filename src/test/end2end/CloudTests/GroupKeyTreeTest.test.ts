/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode2, Test } from "../BaseTestSet";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import { additionOf, buildTree, commitAgainst, creationStatement, PlanOp, policyCommitAgainst, registerUserKey, removalOf, rotationGrantEdge, rotationStatement, selfUpdateOf, ServedGroup, useRealNodeKeys } from "../../testUtils/TreeFixtures";
import { CommitStatement } from "../../../service/cloud/keytree/CommitStatement";
import { TreeMath } from "../../../service/cloud/keytree/TreeMath";
import { LadderMath } from "../../../service/cloud/keytree/LadderMath";

/**
 * A tree-backed group against a real database: the unit tests state what the write path intends to do, this
 * states what Mongo ends up holding.
 *
 * Four members — one bucket, so the root is the only keyed node: one node record and five edges (the root to each
 * member, plus the grant edge) — small enough to assert on document by document. Every commit by the caller in
 * seat 0 re-keys exactly that root.
 */

const SEATING = ["janek", "alice", "bob", "carol"];
const BOB_POSITION = 2;

const alice = "alice" as types.cloud.UserId;
const bob = "bob" as types.cloud.UserId;
const carol = "carol" as types.cloud.UserId;
const dave = "dave" as types.cloud.UserId;

// Real ECC node keys — the API validator rejects placeholders — and statements signed with the test user's key,
// which is the one the bridge checks them against.
useRealNodeKeys();
registerUserKey(testData.userId, testData.userPrivKey as types.core.EccWif);

/** The group's grant public key at a given epoch — rotated by every removal. */
const epochKeys = new Map<number, types.cloud.GroupPubKey>();
function epochKey(epoch: number): types.cloud.GroupPubKey {
    const existing = epochKeys.get(epoch);
    if (existing) {
        return existing;
    }
    const generated = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;
    epochKeys.set(epoch, generated);
    return generated;
}

function keyIdAt(epoch: number) {
    return `group-key-${epoch}` as types.core.KeyId;
}

interface EdgeDocument {
    _id: string;
    isGrantEdge?: boolean;
    parentIndex?: number;
    parentGeneration: number;
    childIndex?: number;
    childGeneration?: number;
    childUserId?: string;
    data: string;
}

interface NodeDocument {
    _id: string;
    nodeIndex: number;
    generation: number;
    publicKey?: string;
    setBy?: number;
}

export class GroupKeyTreeTests extends BaseTestSet {
    
    private groupId?: types.group.GroupId;
    private _removedByDelta?: types.cloud.UserId;
    private keyVersion = 1;
    // Only roster operations move this: rotations, removals and additions. Each metadata plane has its own.
    private rosterVersion = 1;
    // Those other counters, one per metadata plane, each moved only by writes to that plane.
    private publicMetaVersion = 1;
    private privateMetaVersion = 1;
    
    @Test()
    async shouldKeepGroupStateOutOfTheDocument() {
        await this.addMembersToContext([alice, bob, carol]);
        const submitted = await this.createTreeBackedGroup();
        await this.verifyTheDocumentCarriesNoState();
        await this.verifyTheCollectionsCarryIt(submitted);
        await this.verifyGroupGetReassemblesTheTree(submitted);
    }
    
    @Test()
    async shouldRewriteOnlyThePathWhenRemovingAMember() {
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        const edgesBefore = await this.readEdges();
        const nodesBefore = await this.readNodes();
        await this.removeMember(bob);
        await this.verifyOnlyThePathWasRewritten(edgesBefore, nodesBefore);
        await this.verifyTheRemovalLanded();
    }
    
    @Test()
    async shouldSeatANewcomerWithoutAdvancingTheEpoch() {
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob);
        const edgesBefore = await this.readEdges();
        const epochBefore = this.keyVersion;
        await this.addMember(dave, BOB_POSITION);
        await this.verifyTheAdditionCostOneEdge(edgesBefore, epochBefore);
    }
    
    @Test()
    async shouldSeatANewcomerByRekeyingThePath() {
        // How a real client seats anybody: it cannot wrap to a node it holds no key for, so it re-keys the path
        // down to the seat. The epoch must still not move — a container granted to the group stays valid.
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob);
        const nodesBefore = await this.readNodes();
        const epochBefore = this.keyVersion;
        await this.addMemberByRekeyingThePath(dave, BOB_POSITION);
        await this.verifyOnlyThePathMoved(nodesBefore, epochBefore);
    }
    
    @Test()
    async shouldRefuseAnAdditionThatRekeysOffThePath() {
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob);
        await this.verifyOffPathWorkIsRefusedWhenAdding();
    }
    
    @Test()
    async shouldAcceptASelfUpdateQuietly() {
        // Re-keying your own path moves no counter, writes no history and changes nothing a reader caches.
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        const nodesBefore = await this.readNodes();
        const {plan, commit} = await this.commitFor({kind: "selfUpdate", committer: testData.userId});
        const res = await this.apis.contextApi.groupSelfUpdate({
            id: this.requireGroupId(),
            transition: selfUpdateOf(plan, this.keyVersion),
            commit: commit,
            expectedKeyVersion: this.keyVersion,
        });
        assert(res === "OK", "groupSelfUpdate did not return OK");
        const document = await this.readGroupDocument();
        assert(document.keyVersion === 1 && document.rosterVersion === 1, "a self-update moves neither the epoch nor the roster");
        const history = await this.helpers.readCollection("groupHistoryEntry", {groupId: this.requireGroupId()});
        assert(history.length === 1, `a self-update appends no history, found ${history.length}`);
        const [root] = await this.readNodes();
        assert(root.generation === nodesBefore[0].generation + 1 && root.publicKey !== nodesBefore[0].publicKey, "the root was re-keyed");
        const edges = await this.readEdges();
        assert(edges.length === 5 && edges.every(edge => edge.isGrantEdge ? edge.childGeneration === root.generation : edge.parentGeneration === root.generation),
            "every edge was re-wrapped under the new root");
        // The statement chain moved, and a reader is served what vouches for what it reads.
        assert(root.setBy === 2, `the re-keyed root is vouched for by statement 2, got ${String(root.setBy)}`);
        const {commits} = await this.apis.contextApi.groupGetTreeCommits({groupId: this.requireGroupId(), fromSeq: 0});
        assert.deepStrictEqual(commits.map(c => [c.seq, c.op]), [[1, "create"], [2, "selfUpdate"]]);
        const {group} = await this.apis.contextApi.groupGet({groupId: this.requireGroupId()});
        assert(group.treeCommit?.seq === 2, "groupGet serves the latest statement");
        assert.deepStrictEqual(group.treeCommits.map(c => c.seq), [2], "and the one vouching for the served root");
        assert(group.copathHashes?.length === 2, "a path view of four seats has two copath hashes");
    }
    
    @Test()
    async shouldTakeAPolicyChangeAsASignedCommit() {
        // A policy change is a commit: the chain moves, the stored policy is the one the statement carries and
        // signs, and nothing else moves.
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        const groupId = this.requireGroupId();
        const served = (await this.apis.contextApi.groupGet({groupId, scope: "plan"})).group as unknown as ServedGroup;
        const request = policyCommitAgainst(served, testData.userId, {update: "user", get: "all"});
        assert(await this.apis.contextApi.groupUpdatePolicy(request) === "OK", "groupUpdatePolicy did not return OK");
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.treeCommit?.seq === 2 && group.treeCommit.op === "policy", "the policy statement is the latest");
        assert.deepStrictEqual(group.policy, {update: "user", get: "all"}, "the stored policy is the one it carries");
        assert(group.treeCommit.policyHash === CommitStatement.policyHash(group.policy, group.creator).toString("hex"), "and signs");
        assert(group.keyVersion === 1 && group.rosterVersion === 1, "no epoch and no roster moved");
        const {commits} = await this.apis.contextApi.groupGetTreeCommits({groupId, fromSeq: 0});
        assert.deepStrictEqual(commits.map(c => [c.seq, c.op]), [[1, "create"], [2, "policy"]]);
        assert(commits[1].prevDigest === CommitStatement.digest(commits[0]), "chained to the creation");
        // The same request again extends a head that is gone: a lost race, nothing stored.
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupUpdatePolicy(request), "ROTATED_ALREADY");
    }
    
    @Test()
    async shouldRefuseRemovingYourself() {
        // SECURITY: the remover mints the new grant key, so the member meant to lose the epoch would choose it.
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await shouldThrowErrorWithCode2(async () => {
            const {plan, commit} = await this.commitFor({kind: "remove", committer: testData.userId, removed: [bob]}, epochKey(this.keyVersion + 1));
            await this.apis.contextApi.groupRemoveMembers({...this.removalPayload(bob, removalOf(plan, this.keyVersion), commit), userIds: [bob, testData.userId]});
        }, "INVALID_PARAMS");
        await this.verifyNothingWasWritten();
    }
    
    @Test()
    async shouldServePruneAndCutTheEpochLadder() {
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await this.removeMember(carol);
        await this.removeMember(bob);
        await this.removeMember(alice);
        await this.verifyTheArchiveIsServedFromItsCollection();
        await this.verifyTheArchiveIsWindowed();
        // The metadata entry is still the one `groupCreate` wrote at epoch 1 — removals move the roster plane and
        // leave it alone — so the ladder cannot be cut out from under it until it is rewritten at the current epoch.
        await this.verifyTheLadderCannotBeCutOutFromUnderTheMetadata();
        await this.rewriteEachMetadataPlaneAtTheCurrentEpoch();
        await this.verifyPruningDeletesRungsAndRecordsAWatermark();
        await this.verifyCuttingAnEraDropsTheRungsBelowTheFloor();
    }
    
    @Test()
    async shouldServeOnlyTheCallersPathByDefault() {
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await this.verifyTheDefaultViewIsThePath();
    }
    
    @Test()
    async shouldAcceptARemovalAsADelta() {
        // The shape the tree was built for: the client reads `O(log n)`, sends `O(log n)`, and the bridge checks it
        // against what it already holds. Nobody handles the whole tree.
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await this.removeMemberByDelta(bob);
        await this.verifyTheDeltaLandedLikeAWholeTreeWould();
    }
    
    @Test()
    async shouldAcceptAnAdditionAsADelta() {
        // The addition's half of the same bargain: the client asks for a seat and the node records, and sends back
        // its own re-keyed path.
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob);
        const nodesBefore = await this.readNodes();
        const epochBefore = this.keyVersion;
        await this.addMemberByDelta(dave, BOB_POSITION);
        await this.verifyOnlyThePathMoved(nodesBefore, epochBefore);
    }
    
    @Test()
    async shouldServeOnlyTheHeadUnlessAskedForTheTrail() {
        // A read verifies the head and nothing else, so the head is what a read gets. The trail is one full
        // metadata envelope per version — real weight, and only an audit has a reason to carry it.
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob);
        await this.addMemberByDelta(dave, BOB_POSITION);
        await this.verifyHistoryIsWindowed();
    }
    
    @Test()
    async shouldNotServeTreeStateInListings() {
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await this.verifyListingCarriesNoState();
    }
    
    @Test()
    async shouldLeaveNothingBehindWhenATransitionIsRejected() {
        // A transition spans several documents now, so half a tree left in the collections would be read as real.
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await this.verifyAStaleEpochIsRefused();
        await this.verifyASkippedRefreshIsRefused();
        await this.verifyAnUpwardRungIsRefused();
        await this.verifyNothingWasWritten();
    }
    
    @Test()
    async shouldTakeTheGroupStateDownWithTheGroup() {
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob);
        await this.verifyDeletingTheGroupEmptiesEveryCollection();
    }
    
    /** A one-member group rotates, its grant edge going straight to the sole member, whose leaf is the
     *  root; growing to two moves it to node 1, and every later rotation keeps exactly one grant edge. */
    @Test()
    async shouldRotateAOneMemberGroupAndKeepOneGrantEdgeThroughGrowingAndShrinking() {
        await this.addMembersToContext([alice]);
        await this.createTreeBackedGroup([testData.userId], []);
        await this.rotate();
        await this.verifyTheOnlyGrantEdge(`user:${testData.userId}`, 2);
        await this.addMember(alice, 1);
        await this.verifyTheOnlyGrantEdge("node:1", 2);
        await this.rotate();
        await this.verifyTheOnlyGrantEdge("node:1", 3);
        await this.removeMember(alice);
        assert((await this.readGroupDocument()).numLeaves === 2, "a removal blanks the seat, it does not shrink the tree");
        await this.verifyTheOnlyGrantEdge("node:1", 4);
        await this.rotate();
        await this.verifyTheOnlyGrantEdge("node:1", 5);
    }
    
    // ── the group under test ─────────────────────────────────────────────────────────────────────────────────
    
    private async addMembersToContext(users: types.cloud.UserId[]) {
        this.helpers.authorizePlainApi();
        for (const userId of users) {
            const res = await this.plainApis.contextApi.addUserToContext({
                contextId: testData.contextId,
                userId: userId,
                userPubKey: ECUtils.generateKeyPair().pub58 as types.cloud.UserPubKey,
                acl: "ALLOW ALL" as types.cloud.ContextAcl,
            });
            assert(res === "OK", `addUserToContext(${userId}) did not return OK`);
        }
    }
    
    private async createTreeBackedGroup(seating: string[] = SEATING, users: types.cloud.UserId[] = [alice, bob, carol]) {
        const tree = buildTree(seating, 1);
        const resourceId = this.helpers.generateResourceId();
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            resourceId: resourceId,
            groupPubKey: epochKey(1),
            users: users,
            managers: [testData.userId],
            data: "group-data" as types.group.GroupData,
            publicMeta: "group-public-meta" as types.group.GroupData,
            privateMeta: "group-private-meta" as types.group.GroupData,
            keyId: keyIdAt(1),
            tree: tree,
            commit: creationStatement(tree, testData.userId, {groupId: resourceId, groupPubKey: epochKey(1), users: users, managers: [testData.userId]}),
        });
        assert(!!res.groupId, "groupCreate did not return a groupId");
        this.groupId = res.groupId;
        this.keyVersion = 1;
        this.rosterVersion = 1;
        this.publicMetaVersion = 1;
        this.privateMetaVersion = 1;
        return tree;
    }
    
    /**
     * Removes a member from the planning view alone: every node record, the caller's climb, no other edges.
     *
     * If this passes while `scope: "full"` is never requested, the `O(n)` edge fetch is genuinely off the removal
     * path.
     */
    private async removeMemberByDelta(userId: types.cloud.UserId) {
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId, scope: "plan", forUserIds: [userId]});
        assert(group.treeScope === "plan", "the delta is meant to be built from the planning view");
        const view: types.cloud.GroupTreeState = {
            numLeaves: group.numLeaves!,
            leafAssignment: group.leafAssignment!,
            nodes: group.treeNodes!,
            edges: group.treeEdges!,
        };
        const newEpoch = this.keyVersion + 1;
        const {plan, commit} = commitAgainst(group as unknown as ServedGroup, {kind: "remove", committer: testData.userId, removed: [userId]}, epochKey(newEpoch));
        assert(plan.after.numLeaves === view.numLeaves, "planned against the served view");
        const transition = removalOf(plan, this.keyVersion);
        const res = await this.apis.contextApi.groupRemoveMembers({
            id: groupId,
            userIds: [userId],
            groupPubKey: epochKey(newEpoch),
            keyId: keyIdAt(newEpoch),
            data: "group-data" as types.group.GroupData,
            transition: transition,
            commit: commit,
            rungs: this.rungsFor(newEpoch),
            expectedKeyVersion: this.keyVersion,
            expectedRosterVersion: this.rosterVersion,
        });
        assert(res === "OK", "groupRemoveMembers with a transition did not return OK");
        this.keyVersion = newEpoch;
        this.rosterVersion += 1;
        this._removedByDelta = userId;
    }
    
    private async verifyTheDeltaLandedLikeAWholeTreeWould() {
        const groupId = this.requireGroupId();
        const document = await this.readGroupDocument();
        assert(document.keyVersion === 2, `epoch should have advanced, got ${JSON.stringify(document.keyVersion)}`);
        assert(document.rosterVersion === 2, "and a roster version appended");
        assert(document.publicMetaVersion === 1, "the public-metadata counter is untouched by a removal");
        assert(document.privateMetaVersion === 1, "and so is the private one");
        assert((document.leafAssignment as string[])[BOB_POSITION] === "", "the seat is blanked");
        assert(!(document.users as string[]).includes(bob), "and the roster no longer names them");
        
        const edges = await this.readEdges();
        assert(!edges.some(edge => edge.childUserId === this._removedByDelta), "the departing member's edge is gone");
        assert(edges.filter(edge => edge.isGrantEdge).length === 1, "one grant edge");
        assert(edges.find(edge => edge.isGrantEdge)?.parentGeneration === 2, "the grant edge names the new epoch");
        
        const nodes = await this.readNodes();
        // The remover's keyed path is the root alone; bucket nodes 1 and 5 never get a record.
        assert.deepStrictEqual(nodes.map(n => [n.nodeIndex, n.generation]), [[3, 1]], "only the root, one generation on");
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.length === 1, `the epoch step still needs its rung, got ${rungs.length}`);
    }
    
    /** Removes a member the way an honest client does: from the state the server just served. */
    private async removeMember(userId: types.cloud.UserId) {
        const groupId = this.requireGroupId();
        const newEpoch = this.keyVersion + 1;
        const {plan, commit} = await this.commitFor({kind: "remove", committer: testData.userId, removed: [userId]}, epochKey(newEpoch));
        const transition = removalOf(plan, this.keyVersion);
        const res = await this.apis.contextApi.groupRemoveMembers({
            id: groupId,
            userIds: [userId],
            groupPubKey: epochKey(newEpoch),
            keyId: keyIdAt(newEpoch),
            data: "group-data" as types.group.GroupData,
            transition: transition,
            commit: commit,
            rungs: this.rungsFor(newEpoch),
            // The metadata key wrapped once to the group itself — the O(1) replacement for one wrap per member.
            groupKeys: {
                group: groupId,
                groupEpoch: newEpoch,
                keyId: keyIdAt(newEpoch),
                data: `metadata-key@${newEpoch}` as types.core.UserKeyData,
            },
            expectedKeyVersion: this.keyVersion,
            expectedRosterVersion: this.rosterVersion,
        });
        assert(res === "OK", "groupRemoveMembers did not return OK");
        this.keyVersion = newEpoch;
        this.rosterVersion += 1;
    }
    
    private async addMember(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const {plan, commit} = await this.commitFor({kind: "add", committer: testData.userId, members: [userId], positions: [position]});
        const res = await this.apis.contextApi.groupAddMembers({
            id: groupId,
            members: [{userId: userId, role: "user"}],
            keyId: keyIdAt(this.keyVersion),
            data: "group-data" as types.group.GroupData,
            transition: additionOf(plan, this.keyVersion, [position]),
            commit: commit,
            expectedKeyVersion: this.keyVersion,
            expectedRosterVersion: this.rosterVersion,
        });
        assert(res === "OK", "groupAddMembers did not return OK");
        this.rosterVersion += 1;
    }
    
    private async addMemberByRekeyingThePath(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const {plan, commit} = await this.commitFor({kind: "add", committer: testData.userId, members: [userId], positions: [position]});
        const res = await this.apis.contextApi.groupAddMembers({
            id: groupId,
            members: [{userId: userId, role: "user"}],
            keyId: keyIdAt(this.keyVersion),
            data: "group-data" as types.group.GroupData,
            transition: additionOf(plan, this.keyVersion, [position]),
            commit: commit,
            expectedKeyVersion: this.keyVersion,
            expectedRosterVersion: this.rosterVersion,
        });
        assert(res === "OK", "groupAddMembers did not return OK");
        this.rosterVersion += 1;
    }
    
    private async addMemberByDelta(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId, scope: "plan", forNewMembers: 1});
        assert.ok(group.treeScope === "plan", "the delta is meant to be built from the planning view");
        assert.deepStrictEqual(group.nextFreeSeats, [position], "the bridge allocates the blank seat");
        const view: types.cloud.GroupTreeState = {
            numLeaves: group.numLeaves!,
            leafAssignment: group.leafAssignment!,
            nodes: group.treeNodes!,
            edges: group.treeEdges!,
        };
        const {plan, commit} = commitAgainst(group as unknown as ServedGroup, {kind: "add", committer: testData.userId, members: [userId], positions: [position]});
        assert.ok(plan.after.numLeaves >= view.numLeaves, "planned against the served view");
        const transition = additionOf(plan, this.keyVersion, [position]);
        const res = await this.apis.contextApi.groupAddMembers({
            id: groupId,
            members: [{userId: userId, role: "user"}],
            keyId: keyIdAt(this.keyVersion),
            data: "group-data" as types.group.GroupData,
            transition: transition,
            commit: commit,
            expectedKeyVersion: this.keyVersion,
            expectedRosterVersion: this.rosterVersion,
        });
        assert.ok(res === "OK", "groupAddMembers did not return OK");
        this.rosterVersion += 1;
    }
    
    /** Rotates the grant key as the test user, planned against what the bridge serves. Shared with Track F
     *  (03/04/09/11 extend its statement, not the edge). */
    private async rotate() {
        const groupId = this.requireGroupId();
        const served = (await this.apis.contextApi.groupGet({groupId, scope: "full"})).group as unknown as ServedGroup;
        const tree = {numLeaves: served.numLeaves, leafAssignment: served.leafAssignment, nodes: served.treeNodes, edges: served.treeEdges};
        const newEpoch = this.keyVersion + 1;
        const res = await this.apis.contextApi.groupGenerateNewKey({
            id: groupId,
            groupPubKey: epochKey(newEpoch),
            keyId: keyIdAt(newEpoch),
            data: "group-data" as types.group.GroupData,
            grantEdge: rotationGrantEdge(tree, newEpoch),
            commit: rotationStatement(tree, (served.treeCommit?.seq ?? 0) + 1, newEpoch, testData.userId, {
                groupId, groupPubKey: epochKey(newEpoch), rosterVersion: served.rosterVersion + 1,
                users: served.users, managers: served.managers, ...(served.treeCommit ? {previous: served.treeCommit} : {}),
            }),
            rungs: this.rungsFor(newEpoch),
            expectedKeyVersion: this.keyVersion,
            expectedRosterVersion: this.rosterVersion,
        });
        assert(res === "OK", "groupGenerateNewKey did not return OK");
        this.keyVersion = newEpoch;
        this.rosterVersion += 1;
    }
    
    /** Exactly one grant edge is stored, to `child`, at `epoch`, and the group document is at that epoch. */
    private async verifyTheOnlyGrantEdge(child: string, epoch: number) {
        const grants = (await this.readEdges()).filter(edge => edge.isGrantEdge);
        assert.deepStrictEqual(grants.map(edge => [edge._id.slice(edge._id.indexOf("|") + 1), edge.parentGeneration]), [[`grant>${child}`, epoch]],
            `one grant edge to ${child} at epoch ${epoch}`);
        assert((await this.readGroupDocument()).keyVersion === epoch, `the group is at epoch ${epoch}`);
    }
    
    /** One epoch's worth of rungs: the mandatory unit rung down to the previous epoch, plus the skips. */
    private rungsFor(newEpoch: number, floor = 1): types.cloud.GroupArchiveRungSubmission[] {
        return LadderMath.rungSpansFor(newEpoch, floor).map(span => ({
            atKeyVersion: span.at,
            targetKeyVersion: span.target,
            data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
        }));
    }
    
    // ── what the database holds ──────────────────────────────────────────────────────────────────────────────
    
    private async verifyTheDocumentCarriesNoState() {
        const document = await this.readGroupDocument();
        // The fields that used to grow without a ceiling. `keys` is here too: a group carries no per-member key
        // entries at all — the metadata key is wrapped once, to its own grant key, in `groupKeys`.
        for (const field of ["tree", "history", "archiveRungs", "allTimeUsers", "keys"]) {
            assert(!(field in document), `the group document must not carry '${field}'`);
        }
        assert(document.publicMetaVersion === 1, `publicMetaVersion should be a counter set to 1, got ${JSON.stringify(document.publicMetaVersion)}`);
        assert(document.privateMetaVersion === 1, `privateMetaVersion should be a counter set to 1, got ${JSON.stringify(document.privateMetaVersion)}`);
        // The single counter is gone from the document, not merely unread.
        assert(!("version" in document), "the group document must not carry the pre-split 'version' counter");
        assert(document.rosterVersion === 1, `roster version should be a counter set to 1, got ${JSON.stringify(document.rosterVersion)}`);
        assert(document.numLeaves === 4, "the seating stays on the document");
        assert(Array.isArray(document.leafAssignment) && document.leafAssignment.length === 4, "leafAssignment stays on the document");
        assert(document.keyVersion === 1, "a new tree-backed group starts at epoch 1");
        assert(document.eraFloor === 1, "and at era floor 1");
    }
    
    private async verifyTheCollectionsCarryIt(submitted: types.cloud.GroupTreeState) {
        const groupId = this.requireGroupId();
        const nodes = await this.readNodes();
        const edges = await this.readEdges();
        const history = await this.helpers.readCollection("groupHistoryEntry", {groupId}) as unknown as {_id: string, version: number, author: string}[];
        assert(nodes.length === submitted.nodes.length, `expected ${submitted.nodes.length} node documents, got ${nodes.length}`);
        assert(edges.length === submitted.edges.length, `expected ${submitted.edges.length} edge documents, got ${edges.length}`);
        assert(history.length === 1, `expected a single genesis entry, got ${history.length}`);
        assert(history[0]._id === `${groupId}|1`, "a history entry is identified by (groupId, version), so appending one is an insert");
        assert(history[0].version === 1, "genesis is version 1");
        assert(history[0].author === testData.userId, "genesis author mismatch");
        // Identity is derived from the seat, so a refresh is an update in place.
        assert(nodes.every(node => node._id === `${groupId}|${node.nodeIndex}`), "node ids are derived from (groupId, nodeIndex)");
        assert(edges.filter(edge => edge._id.includes("grant")).length === 1, "exactly one grant edge");
    }
    
    private async verifyGroupGetReassemblesTheTree(submitted: types.cloud.GroupTreeState) {
        const {group} = await this.apis.contextApi.groupGet({groupId: this.requireGroupId(), scope: "full"});
        assert(group.numLeaves === submitted.numLeaves, "numLeaves round-trip");
        assert.deepStrictEqual(group.leafAssignment, submitted.leafAssignment);
        assert.deepStrictEqual(sortNodes(group.treeNodes ?? []), sortNodes(submitted.nodes));
        assert.deepStrictEqual(sortEdges(group.treeEdges ?? []), sortEdges(submitted.edges));
        assert(group.ownLeafPosition === 0, "janek sits in seat 0");
        assert(group.publicMetaVersion === 1 && group.privateMetaVersion === 1 && group.rosterVersion === 1,
            "all three counters come from the document");
        assert(group.history.length === 1, "the history is served from its collection");
        // Storage detail must not leak into the API.
        assert(group.treeNodes?.every(node => !("groupId" in node) && !("id" in node)), "served nodes carry no storage fields");
    }
    
    private async verifyOnlyThePathWasRewritten(edgesBefore: EdgeDocument[], nodesBefore: NodeDocument[]) {
        const edgesAfter = await this.readEdges();
        const nodesAfter = await this.readNodes();
        assert(edgesAfter.length === edgesBefore.length - 1, "the departing member's edge is the only one that disappears");
        assert(!edgesAfter.some(edge => edge._id.includes("user:bob")), "bob's edge is gone");
        assert(edgesBefore.some(edge => edge._id.includes("user:bob")), "bob had an edge to begin with");
        
        // The remover re-keys its own keyed path — here the root alone — so every surviving edge is out of the
        // re-keyed root at its new generation, and the grant edge names the new epoch and the new root.
        assert.deepStrictEqual(nodesAfter.map(node => node.nodeIndex), [3], "the root is the only record, before and after");
        assert(nodesAfter[0].generation === nodesBefore[0].generation + 1, "the root moved one generation");
        assert(nodesAfter[0].publicKey !== nodesBefore[0].publicKey, "SECURITY: a refreshed node must carry a genuinely new key");
        for (const edge of edgesAfter) {
            if (edge.isGrantEdge) {
                assert(edge.parentGeneration === 2 && edge.childGeneration === nodesAfter[0].generation, `stale grant edge ${edge._id}`);
            }
            else {
                assert(edge.parentIndex === 3 && edge.parentGeneration === nodesAfter[0].generation, `edge ${edge._id} not re-wrapped under the new root`);
            }
        }
    }
    
    private async verifyTheRemovalLanded() {
        const groupId = this.requireGroupId();
        const document = await this.readGroupDocument();
        assert(document.keyVersion === 2, "a removal advances the epoch");
        assert(document.rosterVersion === 2, "and appends a roster version");
        assert(!(document.users as string[]).includes(bob), "bob is out of the roster");
        assert((document.leafAssignment as string[])[BOB_POSITION] === "", "his seat is left blank rather than compacted");
        const history = await this.helpers.readCollection("groupHistoryEntry", {groupId});
        assert(history.length === 2, `expected 2 history entries, got ${history.length}`);
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.length === 1, `a step from epoch 1 to 2 needs one unit rung, got ${rungs.length}`);
        assert(rungs[0].atKeyVersion === 2 && rungs[0].targetKeyVersion === 1, "and it must point downwards");
        const {group} = await this.apis.contextApi.groupGet({groupId});
        assert(group.keyVersion === 2 && group.leafAssignment?.[BOB_POSITION] === "", "the served state matches the stored one");
    }
    
    private async verifyTheAdditionCostOneEdge(edgesBefore: EdgeDocument[], epochBefore: number) {
        const document = await this.readGroupDocument();
        assert(document.keyVersion === epochBefore, "an addition must not advance the epoch — that is the whole economy of the tree");
        assert(document.rosterVersion === this.rosterVersion, "it does append a roster version");
        assert((document.users as string[]).includes(dave), "dave joined the roster");
        assert((document.leafAssignment as string[])[BOB_POSITION] === dave, "dave took the blank seat");
        const edgesAfter = await this.readEdges();
        assert(edgesAfter.length === edgesBefore.length + 1, "one new edge, and only one");
        const before = new Map(edgesBefore.map(edge => [edge._id, JSON.stringify(edge)]));
        const changed = edgesAfter.filter(edge => before.get(edge._id) !== JSON.stringify(edge));
        // An addition re-keys the adder's own keyed path and the newcomer's. So the edges it touches are dave's
        // own, the ones out of those paths, and the grant edge. Nothing else may move: an addition
        // does not advance the epoch, so any other change would be a re-key nobody accounts for.
        assert(changed.some(edge => edge._id.includes("user:dave")), "dave's own edge was written");
        const path = [...TreeMath.keyedPath(0, document.numLeaves as number), ...TreeMath.keyedPath(BOB_POSITION, document.numLeaves as number)];
        for (const edge of changed) {
            const parent = edge.parentIndex;
            assert(
                edge.isGrantEdge === true || (parent !== undefined && path.includes(parent)),
                `edge ${edge._id} is off the adder's path — an addition must not touch it`,
            );
        }
    }
    
    private async verifyOnlyThePathMoved(nodesBefore: NodeDocument[], epochBefore: number) {
        const document = await this.readGroupDocument();
        assert.ok(document.keyVersion === epochBefore, "an addition must not advance the epoch, even when it re-keys");
        assert.ok((document.leafAssignment as string[])[BOB_POSITION] === dave, "dave took the blank seat");
        // The adder (seat 0) re-keys its keyed path and the newcomer's.
        const expected = [...new Set([...TreeMath.keyedPath(0, document.numLeaves as number),
            ...TreeMath.keyedPath(BOB_POSITION, document.numLeaves as number)])].sort((a, b) => a - b);
        const before = new Map(nodesBefore.map(node => [node.nodeIndex, node]));
        const moved: number[] = [];
        for (const node of await this.readNodes()) {
            const previous = before.get(node.nodeIndex);
            assert.ok(previous !== undefined, `node ${node.nodeIndex} appeared out of nowhere`);
            if (previous.generation === node.generation && previous.publicKey === node.publicKey) {
                continue;
            }
            assert.ok(node.generation === previous.generation + 1, `node ${node.nodeIndex} skipped a generation`);
            assert.ok(node.publicKey !== previous.publicKey, `node ${node.nodeIndex} bumped but kept its key`);
            moved.push(node.nodeIndex);
        }
        assert.deepStrictEqual(moved.sort((a, b) => a - b), expected,
            `the addition re-keyed ${JSON.stringify(moved)}, expected the path ${JSON.stringify(expected)}`);
        // The seat is reachable again: the newcomer has an edge, and it hangs off the re-keyed parent.
        const daveEdge = (await this.readEdges()).find(edge => edge.childUserId === dave);
        assert.ok(daveEdge !== undefined, "the newcomer got no edge, so they cannot climb");
        assert.ok(moved.includes(daveEdge.parentIndex ?? -1), "the newcomer's edge does not hang off a re-keyed node");
    }
    
    private async verifyOffPathWorkIsRefusedWhenAdding() {
        const offPath = 5; // a bucket node above the seat being filled: no key may ever sit there
        assert.ok(!TreeMath.keyedPath(0, 4).includes(offPath), "pick a node genuinely off the adder's path");
        await shouldThrowErrorWithCode2(async () => {
            const {plan, commit} = await this.commitFor({kind: "add", committer: testData.userId, members: [dave], positions: [BOB_POSITION]});
            const transition = additionOf(plan, this.keyVersion, [BOB_POSITION]);
            transition.seatedNodes.push({
                nodeIndex: offPath, fromGeneration: 0, generation: 1,
                publicKey: ECUtils.generateKeyPair().pub58,
            });
            await this.apis.contextApi.groupAddMembers({
                id: this.requireGroupId(),
                members: [{userId: dave, role: "user"}],
                keyId: keyIdAt(this.keyVersion),
                data: "group-data" as types.group.GroupData,
                transition: transition,
                commit: commit,
                expectedKeyVersion: this.keyVersion,
                expectedRosterVersion: this.rosterVersion,
            });
        }, "GROUP_TREE_INVALID");
    }
    
    private async verifyTheArchiveIsServedFromItsCollection() {
        const groupId = this.requireGroupId();
        const document = await this.readGroupDocument();
        assert(!("archiveRungs" in document), "rungs are not on the document");
        const stored = await this.helpers.readCollection("groupArchiveRung", {groupId});
        const served = await this.apis.contextApi.groupGetKeyArchive({id: groupId});
        assert(served.rungs.length === stored.length, "the whole ladder is served by default");
        assert(served.keyVersion === 4 && served.eraFloor === 1, "three removals put the group at epoch 4");
        assert(served.rungs.every(rung => rung.targetKeyVersion < rung.atKeyVersion), "SECURITY: every rung points downwards");
    }
    
    private async verifyTheArchiveIsWindowed() {
        const groupId = this.requireGroupId();
        // Descending from one epoch reads that epoch's rungs, not the whole archive.
        const served = await this.apis.contextApi.groupGetKeyArchive({id: groupId, fromKeyVersion: 3, toKeyVersion: 3});
        assert(served.rungs.length > 0, "epoch 3 has rungs");
        assert(served.rungs.every(rung => rung.atKeyVersion === 3), "and only epoch 3's are served");
        const all = await this.apis.contextApi.groupGetKeyArchive({id: groupId});
        assert(served.rungs.length < all.rungs.length, "the window actually narrows the answer");
    }
    
    /**
     * A floor above the metadata entry's epoch is refused, on both operations that raise one.
     *
     * The entry stays at the epoch it was written under, and its key is addressed to that epoch's grant key — the
     * very key material a cut drops. Letting the floor past it would make `publicMeta`/`privateMeta` unreadable
     * for everybody, permanently, so it is refused with the way out named.
     */
    private async verifyTheLadderCannotBeCutOutFromUnderTheMetadata() {
        const groupId = this.requireGroupId();
        const before = await this.helpers.readCollection("groupArchiveRung", {groupId});
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupPruneArchive({
            id: groupId, belowEpoch: 2, expectedKeyVersion: this.keyVersion,
        }), "GROUP_META_UNREACHABLE");
        await shouldThrowErrorWithCode2(() => this.apis.contextApi.groupCutEra({
            id: groupId, newFloor: 3, expectedKeyVersion: this.keyVersion,
        }), "GROUP_META_UNREACHABLE");
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.length === before.length, `a refused cut deletes nothing, went from ${before.length} to ${rungs.length} rungs`);
        const document = await this.readGroupDocument();
        assert(document.eraFloor === 1 && document.archivePrunedBelow === undefined, "and records neither floor nor watermark");
    }
    
    /**
     * The way out the refusal names — but per plane, which is the point.
     *
     * The two planes lag independently, so rewriting one lifts one epoch and the cut stays refused until the
     * other is rewritten too. This walks that: rewrite public, check the refusal now names only the private
     * plane, then rewrite private and check the cut goes through. An implementation that took `min(public,
     * private)` and named both planes unconditionally would pass every step but the middle one.
     */
    private async rewriteEachMetadataPlaneAtTheCurrentEpoch() {
        const groupId = this.requireGroupId();
        
        const bothStranded = await this.expectCutRefusal();
        assert(bothStranded.includes("groupUpdatePublicMeta") && bothStranded.includes("groupUpdatePrivateMeta"),
            `with both planes lagging the refusal must name both, got ${bothStranded}`);
        
        assert(await this.apis.contextApi.groupUpdatePublicMeta({
            id: groupId,
            data: "group-public-meta@current" as types.group.GroupData,
            keyId: keyIdAt(this.keyVersion),
            version: this.publicMetaVersion as types.group.GroupVersion,
        }) === "OK", "groupUpdatePublicMeta did not return OK");
        this.publicMetaVersion += 1;
        const [publicHead] = await this.helpers.readCollection("groupPublicMetaEntry", {groupId, version: this.publicMetaVersion});
        assert(publicHead.keyVersion === this.keyVersion,
            `the public entry should now sit at the current epoch ${this.keyVersion}, got ${JSON.stringify(publicHead.keyVersion)}`);
        
        // The step a `min()`-only floor check fails: one plane is current, the other is not, and the message has
        // to have stopped naming the plane that no longer needs rewriting.
        const onlyPrivate = await this.expectCutRefusal();
        assert(onlyPrivate.includes("groupUpdatePrivateMeta"),
            `the private plane still lags, so the refusal must name it, got ${onlyPrivate}`);
        assert(!onlyPrivate.includes("groupUpdatePublicMeta"),
            `the public plane is current now, so the refusal must not still name it, got ${onlyPrivate}`);
        assert(!onlyPrivate.includes("groupUpdatePolicy"),
            `a policy write lifts no epoch, so it must never be offered as the fix, got ${onlyPrivate}`);
        
        assert(await this.apis.contextApi.groupUpdatePrivateMeta({
            id: groupId,
            data: "group-private-meta@current" as types.group.GroupData,
            keyId: keyIdAt(this.keyVersion),
            version: this.privateMetaVersion as types.group.GroupVersion,
        }) === "OK", "groupUpdatePrivateMeta did not return OK");
        this.privateMetaVersion += 1;
        const [privateHead] = await this.helpers.readCollection("groupPrivateMetaEntry", {groupId, version: this.privateMetaVersion});
        assert(privateHead.keyVersion === this.keyVersion,
            `the private entry should now sit at the current epoch ${this.keyVersion}, got ${JSON.stringify(privateHead.keyVersion)}`);
    }
    
    /** Runs the cut that must still be refused and hands back the message, so a caller can read what it names. */
    private async expectCutRefusal(): Promise<string> {
        try {
            await this.apis.contextApi.groupCutEra({
                id: this.requireGroupId(), newFloor: this.keyVersion, expectedKeyVersion: this.keyVersion,
            });
        }
        catch (e) {
            return JSON.stringify(e);
        }
        throw new Error("the cut was expected to be refused while a metadata plane still lags");
    }
    
    private async verifyPruningDeletesRungsAndRecordsAWatermark() {
        const groupId = this.requireGroupId();
        const res = await this.apis.contextApi.groupPruneArchive({id: groupId, belowEpoch: 2, expectedKeyVersion: this.keyVersion});
        assert(res === "OK", "groupPruneArchive did not return OK");
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.every(rung => rung.targetKeyVersion >= 2), "rungs below the watermark are deleted, not filtered on read");
        const document = await this.readGroupDocument();
        assert(document.archivePrunedBelow === 2, "the watermark tells a client it was pruned, not tampered with");
        const epochRows = await this.helpers.readCollection("groupEpochKey", {groupId});
        assert(epochRows.filter(row => row.keyVersion < this.keyVersion).length === 3,
            "pruning is housekeeping: it leaves the epoch registry alone for a member still holding an old key");
    }
    
    private async verifyCuttingAnEraDropsTheRungsBelowTheFloor() {
        const groupId = this.requireGroupId();
        const res = await this.apis.contextApi.groupCutEra({id: groupId, newFloor: 3, expectedKeyVersion: this.keyVersion});
        assert(res === "OK", "groupCutEra did not return OK");
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.every(rung => rung.targetKeyVersion >= 3), "nothing below the floor can be descended to any more");
        const document = await this.readGroupDocument();
        assert(document.eraFloor === 3, "the floor is recorded");
        // Key material for the closed epochs goes with them: the registry entry has no rung to verify against
        // any more, and the wrapped key is addressed to a grant key nobody can climb to. These are the two
        // fields that otherwise grow with every rotation for the life of the group.
        // They live one row per epoch in `groupEpochKey`, never on the document.
        assert(!("keyHistory" in document) && !("groupKeys" in document), "per-epoch key material stays off the group document");
        const epochRows = await this.helpers.readCollection("groupEpochKey", {groupId});
        assert(epochRows.every(row => row.keyVersion >= 3),
            `the epoch rows below the floor must go, got ${JSON.stringify(epochRows.map(row => row.keyVersion))}`);
    }
    
    private async verifyTheDefaultViewIsThePath() {
        const groupId = this.requireGroupId();
        const {group: full} = await this.apis.contextApi.groupGet({groupId, scope: "full"});
        const {group: path} = await this.apis.contextApi.groupGet({groupId});
        
        assert(full.treeScope === "full", `full scope mismatch: ${String(full.treeScope)}`);
        assert(path.treeScope === "path", `default scope should be path, got ${String(path.treeScope)}`);
        assert((path.treeEdges?.length ?? 0) < (full.treeEdges?.length ?? 0),
            `the default view is not smaller: ${path.treeEdges?.length} vs ${full.treeEdges?.length}`);
        // The climb: one leaf edge (the caller's own) and the grant edge it ends on, plus the records of the
        // caller's keyed path. Everything else the caller would receive is somebody else's business.
        assert(path.treeEdges?.filter(e => e.childKind === "user").length === 1, "exactly one leaf edge");
        assert(path.treeEdges?.filter(e => e.isGrantEdge).length === 1, "one grant edge");
        assert(path.ownLeafPosition === 0, `ownLeafPosition should survive the narrowing, got ${String(path.ownLeafPosition)}`);
        assert(path.numLeaves === full.numLeaves, "the geometry is unchanged");
        assert.deepStrictEqual(path.leafAssignment, full.leafAssignment, "the roster is unchanged");
        // What the narrowing is for, in bytes.
        const sizeOf = (g: unknown) => JSON.stringify(g).length;
        assert(sizeOf(path) < sizeOf(full), `path view ${sizeOf(path)} B is not smaller than full ${sizeOf(full)} B`);
    }
    
    private async verifyHistoryIsWindowed() {
        const groupId = this.requireGroupId();
        // No parameter is the head alone. Nothing on the read path replays the trail: the head attests the
        // roster, and an older epoch's key comes down the ladder, not out of an old entry. The metadata entry
        // is served alongside it and is never windowed — there is only ever one current.
        const {group: head} = await this.apis.contextApi.groupGet({groupId});
        assert.ok(head.history.length === 1, `no parameter serves the head alone, got ${head.history.length}`);
        assert.ok(head.data.length === 1, "the data array carries the head alone too");
        // Where the window starts is read off the entries themselves. There is no echoed
        // `firstServedRosterVersion` to trust instead — it was removed because nothing read it.
        assert.ok(head.history[0].version === head.rosterVersion,
            `the head is roster version ${head.rosterVersion}, served ${head.history[0].version}`);
        assert.ok(!!head.publicMeta && !!head.privateMeta, "a read always carries both current metadata entries");
        
        // The audit trail is what `fromRosterVersion` is for, and asking for it costs what it costs.
        const {group: trail} = await this.apis.contextApi.groupGet({groupId, fromRosterVersion: 1});
        assert.ok(trail.history.length === 3, `three roster versions so far, got ${trail.history.length}`);
        assert.ok(trail.history[0].version === 1, "asking from 1 means from genesis");
        const sizeOf = (g: unknown) => JSON.stringify(g).length;
        assert.ok(sizeOf(head) < sizeOf(trail), `head ${sizeOf(head)} B is not smaller than the trail ${sizeOf(trail)} B`);
        
        const {group: windowed} = await this.apis.contextApi.groupGet({groupId, fromRosterVersion: 3});
        assert.ok(windowed.history.length === 1, `asked from 3, got ${windowed.history.length} entries`);
        assert.ok(windowed.history[0].version === 3, `window starts at 3, served ${windowed.history[0].version}`);
        assert.ok(windowed.rosterVersion === trail.rosterVersion, "the head roster version is unchanged by windowing");
        
        // The head entry is never windowed out: it carries the current `data`, which is what a reader decrypts.
        const {group: past} = await this.apis.contextApi.groupGet({groupId, fromRosterVersion: 99});
        assert.ok(past.history.length === 1 && past.data.length === 1,
            `asking past the head must still serve the head, got ${past.history.length} entries`);
        assert.ok(past.history[0].version === trail.rosterVersion,
            `the head is roster version ${trail.rosterVersion}, served ${past.history[0].version}`);
    }
    
    private async verifyListingCarriesNoState() {
        const res = await this.apis.contextApi.groupList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(res.groups.length === 1, `expected 1 group, got ${res.groups.length}`);
        const listed = res.groups[0] as unknown as Record<string, unknown>;
        for (const field of ["treeNodes", "treeEdges", "leafAssignment", "numLeaves", "history", "data", "keys", "groupKeys", "users", "managers", "treeCommit"]) {
            assert(!(field in listed), `groupList must not serve '${field}' — a page of these is the payload problem, not the fix`);
        }
        assert(listed.keyVersion === 1 && listed.publicMetaVersion === 1 && listed.privateMetaVersion === 1,
            "a listing does carry the epoch and both metadata counters");
        // The same group asked for by id still serves everything.
        const {group} = await this.apis.contextApi.groupGet({groupId: this.requireGroupId()});
        assert(!!group.treeNodes && !!group.leafAssignment, "groupGet still serves the tree");
    }
    
    private async verifyAStaleEpochIsRefused() {
        // Computed against a tree that no longer exists.
        await shouldThrowErrorWithCode2(async () => {
            const {plan, commit} = await this.commitFor({kind: "remove", committer: testData.userId, removed: [bob]}, epochKey(this.keyVersion + 1));
            await this.apis.contextApi.groupRemoveMembers({
                ...this.removalPayload(bob, removalOf(plan, this.keyVersion), commit),
                expectedKeyVersion: this.keyVersion - 1,
                expectedRosterVersion: this.rosterVersion,
            });
        }, "ROTATED_ALREADY");
    }
    
    private async verifyASkippedRefreshIsRefused() {
        // SECURITY: one unrefreshed node on the path leaves the departing member holding a live key.
        await shouldThrowErrorWithCode2(async () => {
            const {plan, commit} = await this.commitFor({kind: "remove", committer: testData.userId, removed: [bob]}, epochKey(this.keyVersion + 1));
            const transition = removalOf(plan, this.keyVersion);
            // Drop the root from the refresh set: the tree of four has its root at index 3.
            assert(transition.refreshedNodes.some(node => node.nodeIndex === 3), "the root is on the path");
            transition.refreshedNodes = transition.refreshedNodes.filter(node => node.nodeIndex !== 3);
            await this.apis.contextApi.groupRemoveMembers(this.removalPayload(bob, transition, commit));
        }, "GROUP_TREE_INVALID");
    }
    
    private async verifyAnUpwardRungIsRefused() {
        // SECURITY: an upward rung hands the departing member everything written after their removal.
        await shouldThrowErrorWithCode2(async () => {
            const {plan, commit} = await this.commitFor({kind: "remove", committer: testData.userId, removed: [bob]}, epochKey(this.keyVersion + 1));
            await this.apis.contextApi.groupRemoveMembers({
                ...this.removalPayload(bob, removalOf(plan, this.keyVersion), commit),
                rungs: [
                    ...this.rungsFor(this.keyVersion + 1),
                    {
                        atKeyVersion: this.keyVersion,
                        targetKeyVersion: this.keyVersion + 1,
                        data: "rung:upwards" as types.core.UserKeyData,
                    },
                ],
            });
        }, "GROUP_ARCHIVE_INVALID");
    }
    
    private async verifyNothingWasWritten() {
        const groupId = this.requireGroupId();
        const document = await this.readGroupDocument();
        assert(document.keyVersion === 1, "three refusals must leave the epoch where it was");
        assert(document.rosterVersion === 1, "and append no roster version");
        assert((document.users as string[]).includes(bob), "bob is still a member");
        const history = await this.helpers.readCollection("groupHistoryEntry", {groupId});
        assert(history.length === 1, `a refused removal must not append a history entry, found ${history.length}`);
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.length === 0, `a refused removal must not leave rungs behind, found ${rungs.length}`);
        const edges = await this.readEdges();
        assert(edges.some(edge => edge.childUserId === bob), "bob's edge is untouched");
        // A refresh leaked through from any of the three refused calls would show up as a generation nothing
        // ever adopted.
        const nodes = await this.readNodes();
        assert(nodes.every(node => node.generation === 0), "no node was refreshed by a refused removal");
        assert(edges.every(edge => (edge.isGrantEdge ? edge.parentGeneration === 1 : edge.parentGeneration === 0)),
            "no edge was re-wrapped to a generation or an epoch that never came to exist");
    }
    
    private removalPayload(userId: types.cloud.UserId, transition: types.cloud.GroupTreeTransition, commit: types.cloud.GroupTreeCommitStatement) {
        const newEpoch = this.keyVersion + 1;
        return {
            id: this.requireGroupId(),
            userIds: [userId],
            groupPubKey: epochKey(newEpoch),
            keyId: keyIdAt(newEpoch),
            data: "group-data" as types.group.GroupData,
            transition: transition,
            commit: commit,
            rungs: this.rungsFor(newEpoch),
            expectedKeyVersion: this.keyVersion,
            expectedRosterVersion: this.rosterVersion,
        };
    }
    
    /** Plans `op` against what the bridge serves and signs its statement as the test user. */
    private async commitFor(op: PlanOp, groupPubKey?: types.cloud.GroupPubKey) {
        const {group} = await this.apis.contextApi.groupGet({groupId: this.requireGroupId(), scope: "full"});
        return commitAgainst(group as unknown as ServedGroup, op, groupPubKey);
    }
    
    private async verifyDeletingTheGroupEmptiesEveryCollection() {
        const groupId = this.requireGroupId();
        const res = await this.apis.contextApi.groupDelete({groupId});
        assert(res === "OK", "groupDelete did not return OK");
        for (const collection of ["group", "groupTreeNode", "groupTreeEdge", "groupHistoryEntry", "groupArchiveRung"]) {
            const filter = collection === "group" ? {_id: groupId} : {groupId};
            const left = await this.helpers.readCollection(collection, filter);
            assert(left.length === 0, `'${collection}' still holds ${left.length} document(s) of a deleted group`);
        }
    }
    
    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────
    
    private async readGroupDocument(): Promise<Record<string, unknown>> {
        const documents = await this.helpers.readCollection("group", {_id: this.requireGroupId()});
        assert(documents.length === 1, "the group document is missing");
        return documents[0] as unknown as Record<string, unknown>;
    }
    
    private async readNodes(): Promise<NodeDocument[]> {
        const documents = await this.helpers.readCollection("groupTreeNode", {groupId: this.requireGroupId()});
        return documents as unknown as NodeDocument[];
    }
    
    private async readEdges(): Promise<EdgeDocument[]> {
        const documents = await this.helpers.readCollection("groupTreeEdge", {groupId: this.requireGroupId()});
        return documents as unknown as EdgeDocument[];
    }
    
    private requireGroupId(): types.group.GroupId {
        if (!this.groupId) {
            throw new Error("groupId not initialized yet");
        }
        return this.groupId;
    }
}

function sortNodes(nodes: types.cloud.GroupTreeNode[]) {
    return [...nodes].sort((a, b) => a.nodeIndex - b.nodeIndex);
}

/** Order is not part of the contract — a client looks an edge up by its parent and child. */
function sortEdges(edges: types.cloud.GroupTreeEdge[]) {
    const key = (edge: types.cloud.GroupTreeEdge) =>
        `${edge.isGrantEdge ? "grant" : edge.parentIndex ?? -1}>${edge.childKind}:${edge.childUserId ?? edge.childIndex ?? -1}`;
    return [...edges].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
