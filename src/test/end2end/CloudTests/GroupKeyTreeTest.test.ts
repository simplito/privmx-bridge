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
import { additionTransition, applyAddition, applyAdditionWithPathRefresh, applyRemoval, buildTree, refreshNodes, removalTransition, withAdditionTransitionNodeKeys, withNodeKeys, withTransitionNodeKeys } from "../../testUtils/TreeFixtures";
import { TreeMath } from "../../../service/cloud/keytree/TreeMath";
import { LadderMath } from "../../../service/cloud/keytree/LadderMath";

/**
 * A tree-backed group against a real database: the unit tests state what the write path intends to do, this
 * states what Mongo ends up holding.
 *
 * Four members — three internal nodes and seven edges — small enough to assert on document by document.
 */

const SEATING = ["janek", "alice", "bob", "carol"];
const BOB_POSITION = 2;

const alice = "alice" as types.cloud.UserId;
const bob = "bob" as types.cloud.UserId;
const carol = "carol" as types.cloud.UserId;
const dave = "dave" as types.cloud.UserId;

/** Real ECC keys, memoized per `(nodeIndex, generation)`: the API validator rejects placeholder public keys. */
const nodeKeys = new Map<string, types.core.EccPubKey>();
function nodeKey(nodeIndex: number, generation: number): types.core.EccPubKey {
    const cacheKey = `${nodeIndex}/${generation}`;
    const existing = nodeKeys.get(cacheKey);
    if (existing) {
        return existing;
    }
    const generated = ECUtils.generateKeyPair().pub58 as types.core.EccPubKey;
    nodeKeys.set(cacheKey, generated);
    return generated;
}

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
    publicKey: string;
}

export class GroupKeyTreeTests extends BaseTestSet {
    
    private groupId?: types.group.GroupId;
    private _removedByDelta?: types.cloud.UserId;
    private keyVersion = 1;
    private version = 1;
    
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
        await this.removeMember(bob, BOB_POSITION);
        await this.verifyOnlyThePathWasRewritten(edgesBefore, nodesBefore);
        await this.verifyTheRemovalLanded();
    }
    
    @Test()
    async shouldSeatANewcomerWithoutAdvancingTheEpoch() {
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob, BOB_POSITION);
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
        await this.removeMember(bob, BOB_POSITION);
        const nodesBefore = await this.readNodes();
        const epochBefore = this.keyVersion;
        await this.addMemberByRekeyingThePath(dave, BOB_POSITION);
        await this.verifyOnlyThePathMoved(nodesBefore, epochBefore);
    }
    
    @Test()
    async shouldRefuseAnAdditionThatRekeysOffThePath() {
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob, BOB_POSITION);
        await this.verifyOffPathWorkIsRefusedWhenAdding();
    }
    
    @Test()
    async shouldServePruneAndCutTheEpochLadder() {
        await this.addMembersToContext([alice, bob, carol]);
        await this.createTreeBackedGroup();
        await this.removeMember(carol, 3);
        await this.removeMember(bob, BOB_POSITION);
        await this.removeMember(alice, 1);
        await this.verifyTheArchiveIsServedFromItsCollection();
        await this.verifyTheArchiveIsWindowed();
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
        await this.removeMemberByDelta(bob, BOB_POSITION);
        await this.verifyTheDeltaLandedLikeAWholeTreeWould();
    }
    
    @Test()
    async shouldAcceptAnAdditionAsADelta() {
        // The addition's half of the same bargain: the client asks what seating position 2 needs, gets `O(log n)`
        // of tree, and sends back `O(log n)`. `forPosition` is what makes that possible — the seat has no holder,
        // so `forUserId` cannot name it.
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob, BOB_POSITION);
        const nodesBefore = await this.readNodes();
        const epochBefore = this.keyVersion;
        await this.addMemberByDelta(dave, BOB_POSITION);
        await this.verifyOnlyThePathMoved(nodesBefore, epochBefore);
    }
    
    @Test()
    async shouldServeOnlyTheHistoryTheClientIsMissing() {
        // A client verifies the signed chain once and remembers where it got to; re-sending what it has already
        // verified is pure weight, since each entry carries the roster it was written with.
        await this.addMembersToContext([alice, bob, carol, dave]);
        await this.createTreeBackedGroup();
        await this.removeMember(bob, BOB_POSITION);
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
        await this.removeMember(bob, BOB_POSITION);
        await this.verifyDeletingTheGroupEmptiesEveryCollection();
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
    
    private async createTreeBackedGroup() {
        const tree = withNodeKeys(buildTree(SEATING, 1), nodeKey);
        const res = await this.apis.contextApi.groupCreate({
            contextId: testData.contextId,
            groupPubKey: epochKey(1),
            users: [alice, bob, carol],
            managers: [testData.userId],
            data: "group-data" as types.group.GroupData,
            keyId: keyIdAt(1),
            tree: tree,
        });
        assert(!!res.groupId, "groupCreate did not return a groupId");
        this.groupId = res.groupId;
        this.keyVersion = 1;
        this.version = 1;
        return tree;
    }
    
    /**
     * Removes a member from a path view alone: fetch with `forUserId`, build the delta, submit it.
     *
     * If this passes while `scope: "full"` is never requested, the `O(n)` fetch is genuinely off the removal path.
     */
    private async removeMemberByDelta(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId, forUserId: userId});
        assert(group.treeScope === "path", "the delta is meant to be built from a path view");
        const view: types.cloud.GroupTreeState = {
            numLeaves: group.numLeaves!,
            leafAssignment: group.leafAssignment!,
            nodes: group.treeNodes!,
            edges: group.treeEdges!,
        };
        const newEpoch = this.keyVersion + 1;
        const transition = withTransitionNodeKeys(removalTransition(view, position, this.keyVersion), nodeKey);
        const res = await this.apis.contextApi.groupRemoveMember({
            id: groupId,
            userId: userId,
            groupPubKey: epochKey(newEpoch),
            keyId: keyIdAt(newEpoch),
            data: "group-data" as types.group.GroupData,
            transition: transition,
            rungs: this.rungsFor(newEpoch),
            expectedKeyVersion: this.keyVersion,
        });
        assert(res === "OK", "groupRemoveMember with a transition did not return OK");
        this.keyVersion = newEpoch;
        this.version += 1;
        this._removedByDelta = userId;
    }
    
    private async verifyTheDeltaLandedLikeAWholeTreeWould() {
        const groupId = this.requireGroupId();
        const document = await this.readGroupDocument();
        assert(document.keyVersion === 2, `epoch should have advanced, got ${JSON.stringify(document.keyVersion)}`);
        assert(document.version === 2, "and a version appended");
        assert((document.leafAssignment as string[])[BOB_POSITION] === "", "the seat is blanked");
        assert(!(document.users as string[]).includes(bob), "and the roster no longer names them");
        
        const edges = await this.readEdges();
        assert(!edges.some(edge => edge.childUserId === this._removedByDelta), "the departing member's edge is gone");
        assert(edges.filter(edge => edge.isGrantEdge).length === 1, "one grant edge");
        assert(edges.find(edge => edge.isGrantEdge)?.parentGeneration === 2, "the grant edge names the new epoch");
        
        const nodes = await this.readNodes();
        // Bob sits under node 5, whose path to the root is 5 then 3. Node 1 is off it and must be untouched.
        const generationOf = (nodeIndex: number) => nodes.find(n => n.nodeIndex === nodeIndex)?.generation;
        assert(generationOf(5) === 1 && generationOf(3) === 1, `the path should be one generation on: ${JSON.stringify(nodes.map(n => [n.nodeIndex, n.generation]))}`);
        assert(generationOf(1) === 0, "a node off the path must not move");
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.length === 1, `the epoch step still needs its rung, got ${rungs.length}`);
    }
    
    /** Removes a member the way an honest client does: from the state the server just served. */
    private async removeMember(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const current = await this.currentTree();
        const newEpoch = this.keyVersion + 1;
        const tree = withNodeKeys(applyRemoval(current, position, newEpoch), nodeKey);
        const res = await this.apis.contextApi.groupRemoveMember({
            id: groupId,
            userId: userId,
            groupPubKey: epochKey(newEpoch),
            keyId: keyIdAt(newEpoch),
            data: "group-data" as types.group.GroupData,
            tree: tree,
            rungs: this.rungsFor(newEpoch),
            // The metadata key wrapped once to the group itself — the O(1) replacement for one wrap per member.
            groupKeys: {
                group: groupId,
                groupEpoch: newEpoch,
                keyId: keyIdAt(newEpoch),
                data: `metadata-key@${newEpoch}` as types.core.UserKeyData,
            },
            expectedKeyVersion: this.keyVersion,
        });
        assert(res === "OK", "groupRemoveMember did not return OK");
        this.keyVersion = newEpoch;
        this.version += 1;
    }
    
    private async addMember(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const current = await this.currentTree();
        const res = await this.apis.contextApi.groupAddMember({
            id: groupId,
            userId: userId,
            role: "user",
            position: position,
            keyId: keyIdAt(this.keyVersion),
            data: "group-data" as types.group.GroupData,
            tree: applyAddition(current, userId, position),
            expectedKeyVersion: this.keyVersion,
        });
        assert(res === "OK", "groupAddMember did not return OK");
        this.version += 1;
    }
    
    private async addMemberByRekeyingThePath(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const current = await this.currentTree();
        const tree = withNodeKeys(applyAdditionWithPathRefresh(current, userId, position, this.keyVersion), nodeKey);
        const res = await this.apis.contextApi.groupAddMember({
            id: groupId,
            userId: userId,
            role: "user",
            position: position,
            keyId: keyIdAt(this.keyVersion),
            data: "group-data" as types.group.GroupData,
            tree: tree,
            expectedKeyVersion: this.keyVersion,
        });
        assert(res === "OK", "groupAddMember did not return OK");
        this.version += 1;
    }
    
    private async addMemberByDelta(userId: types.cloud.UserId, position: number) {
        const groupId = this.requireGroupId();
        const {group} = await this.apis.contextApi.groupGet({groupId, forPosition: position});
        assert.ok(group.treeScope === "path", "the delta is meant to be built from a path view");
        const view: types.cloud.GroupTreeState = {
            numLeaves: group.numLeaves!,
            leafAssignment: group.leafAssignment!,
            nodes: group.treeNodes!,
            edges: group.treeEdges!,
        };
        const transition = withAdditionTransitionNodeKeys(
            additionTransition(view, userId, position, this.keyVersion), nodeKey,
        );
        const res = await this.apis.contextApi.groupAddMember({
            id: groupId,
            userId: userId,
            role: "user",
            position: position,
            keyId: keyIdAt(this.keyVersion),
            data: "group-data" as types.group.GroupData,
            transition: transition,
            expectedKeyVersion: this.keyVersion,
        });
        assert.ok(res === "OK", "groupAddMember did not return OK");
        this.version += 1;
    }
    
    /** One epoch's worth of rungs: the mandatory unit rung down to the previous epoch, plus the skips. */
    private rungsFor(newEpoch: number, floor = 1): types.cloud.GroupArchiveRung[] {
        return LadderMath.rungSpansFor(newEpoch, floor).map(span => ({
            atKeyVersion: span.at,
            targetKeyVersion: span.target,
            recipientKind: "epoch" as const,
            data: `rung:${span.at}->${span.target}` as types.core.UserKeyData,
            author: testData.userId,
        }));
    }
    
    // ── what the database holds ──────────────────────────────────────────────────────────────────────────────
    
    private async verifyTheDocumentCarriesNoState() {
        const document = await this.readGroupDocument();
        // The four fields that used to grow without a ceiling.
        for (const field of ["tree", "history", "archiveRungs", "allTimeUsers"]) {
            assert(!(field in document), `the group document must not carry '${field}'`);
        }
        assert(document.version === 1, `version should be a counter set to 1, got ${JSON.stringify(document.version)}`);
        assert(document.numLeaves === 4, "the seating stays on the document");
        assert(Array.isArray(document.leafAssignment) && document.leafAssignment.length === 4, "leafAssignment stays on the document");
        assert(document.keyVersion === 1, "a new tree-backed group starts at epoch 1");
        assert(document.eraFloor === 1, "and at era floor 1");
        // A tree-backed group carries no per-member entries: the metadata key is wrapped once, to its own grant key.
        assert(Array.isArray(document.keys) && document.keys.length === 0,
            `a tree-backed group must carry no per-member key entries, got ${JSON.stringify(document.keys)}`);
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
        // Identity derived from the seat, which is what makes a refresh an update in place.
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
        assert(group.version === 1, "version comes from the counter");
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
        
        // An edge names the current generation of both endpoints, so a refresh obliges the client to resubmit
        // exactly the edges incident to a refreshed node — no fewer, no more. The rest must be byte-identical.
        const refreshed = new Set(nodesAfter
            .filter(node => node.generation !== nodesBefore.find(n => n.nodeIndex === node.nodeIndex)?.generation)
            .map(node => node.nodeIndex));
        assert(refreshed.size > 0, "a removal has to refresh something");
        const isIncident = (edge: EdgeDocument) =>
            (edge.parentIndex !== undefined && refreshed.has(edge.parentIndex))
            || (edge.childIndex !== undefined && refreshed.has(edge.childIndex));
        const before = new Map(edgesBefore.map(edge => [edge._id, JSON.stringify(edge)]));
        for (const edge of edgesAfter) {
            const unchanged = before.get(edge._id) === JSON.stringify(edge);
            assert(unchanged !== isIncident(edge),
                `edge '${edge._id}' ${unchanged ? "was not rewritten but names a refreshed node" : "was rewritten without naming a refreshed node"}`);
        }
        assert(edgesAfter.some(edge => !isIncident(edge)), "and some edges really are off the path, or this proves nothing");
        
        assert(nodesAfter.length === nodesBefore.length, "a removal blanks a seat, it does not drop nodes");
        const generationOf = (nodes: NodeDocument[], nodeIndex: number) => nodes.find(n => n.nodeIndex === nodeIndex)?.generation;
        // Bob sits under node 5, whose direct path is 5 then the root 3. Node 1 is off the path.
        assert(generationOf(nodesAfter, 5) === (generationOf(nodesBefore, 5) ?? 0) + 1, "node 5 refreshed");
        assert(generationOf(nodesAfter, 3) === (generationOf(nodesBefore, 3) ?? 0) + 1, "node 3 refreshed");
        assert(generationOf(nodesAfter, 1) === generationOf(nodesBefore, 1), "node 1 is off the path and must not be touched");
        const keyOf = (nodes: NodeDocument[], nodeIndex: number) => nodes.find(n => n.nodeIndex === nodeIndex)?.publicKey;
        assert(keyOf(nodesAfter, 5) !== keyOf(nodesBefore, 5), "SECURITY: a refreshed node must carry a genuinely new key");
    }
    
    private async verifyTheRemovalLanded() {
        const groupId = this.requireGroupId();
        const document = await this.readGroupDocument();
        assert(document.keyVersion === 2, "a removal advances the epoch");
        assert(document.version === 2, "and appends a version");
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
        assert(document.version === this.version, "it does append a version");
        assert((document.users as string[]).includes(dave), "dave joined the roster");
        assert((document.leafAssignment as string[])[BOB_POSITION] === dave, "dave took the blank seat");
        const edgesAfter = await this.readEdges();
        assert(edgesAfter.length === edgesBefore.length + 1, "one new edge, and only one");
        const before = new Map(edgesBefore.map(edge => [edge._id, JSON.stringify(edge)]));
        const changed = edgesAfter.filter(edge => before.get(edge._id) !== JSON.stringify(edge));
        assert(changed.length === 1 && changed[0]._id.includes("user:dave"), "no existing edge is rewritten by an addition");
    }
    
    private async verifyOnlyThePathMoved(nodesBefore: NodeDocument[], epochBefore: number) {
        const document = await this.readGroupDocument();
        assert.ok(document.keyVersion === epochBefore, "an addition must not advance the epoch, even when it re-keys");
        assert.ok((document.leafAssignment as string[])[BOB_POSITION] === dave, "dave took the blank seat");
        const expected = TreeMath.directPath(BOB_POSITION, document.numLeaves as number).sort((a, b) => a - b);
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
        const offPath = 1; // parent of leaves 0 and 1, nowhere near the seat being filled at position 2
        assert.ok(!TreeMath.directPath(BOB_POSITION, 4).includes(offPath), "pick a node genuinely off the path");
        await shouldThrowErrorWithCode2(async () => {
            const current = await this.currentTree();
            const tree = withNodeKeys(
                refreshNodes(applyAdditionWithPathRefresh(current, dave, BOB_POSITION, this.keyVersion), [offPath]),
                nodeKey,
            );
            await this.apis.contextApi.groupAddMember({
                id: this.requireGroupId(),
                userId: dave,
                role: "user",
                position: BOB_POSITION,
                keyId: keyIdAt(this.keyVersion),
                data: "group-data" as types.group.GroupData,
                tree: tree,
                expectedKeyVersion: this.keyVersion,
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
    
    private async verifyPruningDeletesRungsAndRecordsAWatermark() {
        const groupId = this.requireGroupId();
        const res = await this.apis.contextApi.groupPruneArchive({id: groupId, belowEpoch: 2, expectedKeyVersion: this.keyVersion});
        assert(res === "OK", "groupPruneArchive did not return OK");
        const rungs = await this.helpers.readCollection("groupArchiveRung", {groupId});
        assert(rungs.every(rung => rung.targetKeyVersion >= 2), "rungs below the watermark are deleted, not filtered on read");
        const document = await this.readGroupDocument();
        assert(document.archivePrunedBelow === 2, "the watermark tells a client it was pruned, not tampered with");
        assert(Array.isArray(document.keyHistory) && (document.keyHistory as unknown[]).length === 3,
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
        const keyHistory = document.keyHistory as {keyVersion: number}[];
        assert(keyHistory.every(entry => entry.keyVersion >= 3),
            `the epoch registry must drop entries below the floor, got ${JSON.stringify(keyHistory.map(e => e.keyVersion))}`);
        const groupKeys = (document.groupKeys ?? []) as {keys: {groupEpoch?: number}[]}[];
        assert(groupKeys.every(entry => entry.keys.every(key => (key.groupEpoch ?? 0) >= 3)),
            "the group's own key entries below the floor must go too");
    }
    
    private async verifyTheDefaultViewIsThePath() {
        const groupId = this.requireGroupId();
        const {group: full} = await this.apis.contextApi.groupGet({groupId, scope: "full"});
        const {group: path} = await this.apis.contextApi.groupGet({groupId});
        
        assert(full.treeScope === "full", `full scope mismatch: ${String(full.treeScope)}`);
        assert(path.treeScope === "path", `default scope should be path, got ${String(path.treeScope)}`);
        assert((path.treeEdges?.length ?? 0) < (full.treeEdges?.length ?? 0),
            `the default view is not smaller: ${path.treeEdges?.length} vs ${full.treeEdges?.length}`);
        // The climb: one leaf edge (the caller's own) and the grant edge it ends on. Everything else the caller
        // would receive is somebody else's business.
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
        const {group: whole} = await this.apis.contextApi.groupGet({groupId});
        assert.ok(whole.history.length === 3, `three versions so far, got ${whole.history.length}`);
        assert.ok(whole.firstServedVersion === 1, "no parameter means from genesis");
        
        const {group: windowed} = await this.apis.contextApi.groupGet({groupId, fromVersion: 3});
        assert.ok(windowed.history.length === 1, `asked from 3, got ${windowed.history.length} entries`);
        assert.ok(windowed.firstServedVersion === 3, `window starts at 3, said ${windowed.firstServedVersion}`);
        assert.ok(windowed.data.length === 1, "the data array is windowed the same way");
        assert.ok(windowed.version === whole.version, "the head version is unchanged by windowing");
        const sizeOf = (g: unknown) => JSON.stringify(g).length;
        assert.ok(sizeOf(windowed) < sizeOf(whole), `windowed ${sizeOf(windowed)} B is not smaller than ${sizeOf(whole)} B`);
        
        // The head entry is never windowed out: it carries the current `data`, which is what a reader decrypts.
        const {group: past} = await this.apis.contextApi.groupGet({groupId, fromVersion: 99});
        assert.ok(past.history.length === 1 && past.data.length === 1,
            `asking past the head must still serve the head, got ${past.history.length} entries`);
        assert.ok(past.firstServedVersion === whole.version, `the head is version ${whole.version}, said ${past.firstServedVersion}`);
    }
    
    private async verifyListingCarriesNoState() {
        const res = await this.apis.contextApi.groupList({contextId: testData.contextId, limit: 10, skip: 0, sortOrder: "asc"});
        assert(res.groups.length === 1, `expected 1 group, got ${res.groups.length}`);
        const listed = res.groups[0] as unknown as Record<string, unknown>;
        for (const field of ["treeNodes", "treeEdges", "leafAssignment", "numLeaves", "history", "data", "keys", "groupKeys"]) {
            assert(!(field in listed), `groupList must not serve '${field}' — a page of these is the payload problem, not the fix`);
        }
        assert(listed.keyVersion === 1 && listed.version === 1, "a listing does carry the epoch and the version");
        // The same group asked for by id still serves everything.
        const {group} = await this.apis.contextApi.groupGet({groupId: this.requireGroupId()});
        assert(!!group.treeNodes && !!group.leafAssignment, "groupGet still serves the tree");
    }
    
    private async verifyAStaleEpochIsRefused() {
        // Computed against a tree that no longer exists.
        await shouldThrowErrorWithCode2(async () => {
            const tree = withNodeKeys(applyRemoval(await this.currentTree(), BOB_POSITION, this.keyVersion + 1), nodeKey);
            await this.apis.contextApi.groupRemoveMember({
                ...this.removalPayload(bob, tree),
                expectedKeyVersion: this.keyVersion - 1,
            });
        }, "ROTATED_ALREADY");
    }
    
    private async verifyASkippedRefreshIsRefused() {
        // SECURITY: one unrefreshed node on the path leaves the departing member holding a live key.
        await shouldThrowErrorWithCode2(async () => {
            const current = await this.currentTree();
            const tree = withNodeKeys(applyRemoval(current, BOB_POSITION, this.keyVersion + 1), nodeKey);
            const root = tree.nodes.find(node => node.nodeIndex === 3);
            const stale = current.nodes.find(node => node.nodeIndex === 3);
            assert(!!root && !!stale, "the tree of four has a root at index 3");
            root.generation = stale.generation;
            root.publicKey = stale.publicKey;
            await this.apis.contextApi.groupRemoveMember(this.removalPayload(bob, tree));
        }, "GROUP_TREE_INVALID");
    }
    
    private async verifyAnUpwardRungIsRefused() {
        // SECURITY: an upward rung hands the departing member everything written after their removal.
        await shouldThrowErrorWithCode2(async () => {
            const tree = withNodeKeys(applyRemoval(await this.currentTree(), BOB_POSITION, this.keyVersion + 1), nodeKey);
            await this.apis.contextApi.groupRemoveMember({
                ...this.removalPayload(bob, tree),
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
        assert(document.version === 1, "and append no version");
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
    
    private removalPayload(userId: types.cloud.UserId, tree: types.cloud.GroupTreeState) {
        const newEpoch = this.keyVersion + 1;
        return {
            id: this.requireGroupId(),
            userId: userId,
            groupPubKey: epochKey(newEpoch),
            keyId: keyIdAt(newEpoch),
            data: "group-data" as types.group.GroupData,
            tree: tree,
            rungs: this.rungsFor(newEpoch),
            expectedKeyVersion: this.keyVersion,
        };
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
    
    /**
     * The tree as the server serves it — what a client computes its next transition against.
     *
     * `scope: "full"` because submitting a transition means submitting the whole new state, and the validator
     * checks it as a whole. The default path view is for climbing and reading, not for writing (BR-10).
     */
    private async currentTree(): Promise<types.cloud.GroupTreeState> {
        const {group} = await this.apis.contextApi.groupGet({groupId: this.requireGroupId(), scope: "full"});
        assert(group.numLeaves !== undefined && group.leafAssignment && group.treeNodes && group.treeEdges, "groupGet served no tree");
        return {
            numLeaves: group.numLeaves,
            leafAssignment: group.leafAssignment,
            nodes: group.treeNodes,
            edges: group.treeEdges,
        };
    }
    
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
