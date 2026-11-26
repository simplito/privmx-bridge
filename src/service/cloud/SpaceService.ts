/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { CloudUser, Executor } from "../../CommonTypes";
import { CloudAclChecker } from "./CloudAclChecker";
import { CloudAccessValidator } from "./CloudAccessValidator";
import { DbDuplicateError } from "../../error/DbDuplicateError";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
import { BaseContainerService } from "./BaseContainerService";
import { SpaceNotificationService } from "./SpaceNotificationService";
import { GroupEpochs } from "../../api/main/GroupKeys";
import { Crypto } from "../../utils/crypto/Crypto";
import { ByteWriter } from "./keytree/ByteWriter";
import { DateUtils } from "../../utils/DateUtils";
import { SpaceStatement } from "./SpaceStatement";
import { CommitStatement } from "./keytree/CommitStatement";
import { GroupRotationRateLimiter } from "../../cluster/master/ipcServices/GroupRotationRateLimiter";
import { Config } from "../../cluster/common/ConfigUtils";
import type { SpaceAddRecipientsModel, SpaceCreateModel, SpaceGetKeysModel, SpaceGetStatementsModel, SpaceRemoveRecipientsModel, SpaceUpdateMetaModel } from "../../api/main/context/ContextApiTypes";

type Caller = {userId: types.cloud.UserId, pubKey: types.cloud.UserPubKey, ownGroupIds: types.group.GroupId[]};
type Recipients = Pick<db.space.Space, "groups"|"users">;

type SpaceAcl = "context/spaceGetStatements"|"context/spaceGetKeys"|"context/spaceGet"|"context/spaceList"|"context/spaceCreate"|"context/spaceDelete"|"context/spaceAddRecipients"
    |"context/spaceRemoveRecipients"|"context/spaceRotateKey"|"context/spaceUpdatePublicMeta"|"context/spaceUpdatePrivateMeta";

/** A space with what one caller is served of it. `keys` is empty for a caller that is not a user. */
export interface SpaceView {
    space: db.space.Space;
    keys: db.space.SpaceKey[];
    keyIsStale: boolean;
}

/**
 * A space holds versions of one key, each wrapped for several groups and users, and nothing else. Its rules are
 * fixed: a recipient reads it and may move it to a new key, a manager changes its recipients and metadata.
 */
export class SpaceService extends BaseContainerService {
    
    /** Recipients of one space, groups and users together. */
    static readonly MAX_RECIPIENTS = 128;
    /** Key versions per `spaceGetKeys` page when the caller names no limit. */
    static readonly KEY_PAGE = 64;
    
    constructor(
        repositoryFactory: RepositoryFactory,
        activeUsersMap: ActiveUsersMap,
        host: types.core.Host,
        private cloudAclChecker: CloudAclChecker,
        private cloudAccessValidator: CloudAccessValidator,
        private spaceNotificationService: SpaceNotificationService,
        private rotationRateLimiter: GroupRotationRateLimiter,
        private config: Config,
    ) {
        super(repositoryFactory, activeUsersMap, host);
    }
    
    /** Derived as a group's id is: lowercase hex of `H("pmx-space-id\0" || lp(contextId) || lp(resourceId))`. */
    static spaceId(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId): types.space.SpaceId {
        return Crypto.sha256(new ByteWriter().tag("pmx-space-id").lp(contextId).lp(resourceId).bytes()).toString("hex") as types.space.SpaceId;
    }
    
    /** The caller's role in the space: the highest of its own and of the groups it belongs to. */
    static roleOf(space: {groups: types.cloud.GroupGrant[], users: {userId: types.cloud.UserId, role: types.cloud.ContainerRole}[]}, userId: types.cloud.UserId, ownGroupIds: types.group.GroupId[]): types.cloud.ContainerRole|undefined {
        const roles = [
            ...space.users.filter(u => u.userId === userId).map(u => u.role),
            ...space.groups.filter(g => ownGroupIds.includes(g.groupId)).map(g => g.role),
        ];
        return roles.includes("manager") ? "manager" : roles[0];
    }
    
    /** True when a recipient group is past the epoch the current key was wrapped to, or cannot be found. */
    static isStale(space: {groups: {groupId: types.group.GroupId, groupKeyVersion: number}[]}, groupEpochs: GroupEpochs): boolean {
        return space.groups.some(g => {
            const epoch = groupEpochs.get(g.groupId);
            return epoch === undefined || epoch > g.groupKeyVersion;
        });
    }
    
    /**
     * Which rotation budget a change of key spends. A removal spends its own (`spaceRemove`), so nothing anybody
     * else does — a member rotating a recipient group, which makes the space stale and the next writer re-key it —
     * can use up the allowance a manager removes somebody with; it stays limited because each removal also adds a
     * key version. A rotation that only replaces a stale key (a recipient group past the epoch the key was wrapped
     * to) spends no hourly budget: it is what a group's own, already rate-limited, epoch change forces. It does spend
     * a per-minute budget of its own (`spaceRotateStaleBurst`), since a user naming many groups of its own could
     * otherwise rotate them in turn and re-key the space as fast as it likes. Only a gratuitous rotation spends
     * `spaceRotate`.
     */
    static rotationBudget(removing: boolean, staying: {groupId: types.group.GroupId, groupKeyVersion: number}[], groupEpochs: GroupEpochs): "rotate"|"remove"|"stale" {
        if (removing) {
            return "remove";
        }
        return SpaceService.isStale({groups: staying}, groupEpochs) ? "stale" : "rotate";
    }
    
    private static recipientKey(recipient: {groupId: types.group.GroupId}|{userId: types.cloud.UserId}) {
        return "groupId" in recipient ? "g:" + recipient.groupId : "u:" + recipient.userId;
    }
    
    /**
     * The submitted wraps have to be exactly one per recipient and version asked for. A group's wrap names the
     * group epoch it was made for: an epoch the group has had, and at `currentVersion` the epoch it is at now -
     * a new key wrapped to a past epoch would be stale from its first moment.
     */
    static assertKeysCover(
        keys: types.cloud.SpaceKeyEntry[],
        recipients: ({groupId: types.group.GroupId}|{userId: types.cloud.UserId})[],
        versions: number[],
        currentVersion: number,
        groupEpochs: GroupEpochs,
    ) {
        const expected = new Set(recipients.flatMap(r => versions.map(v => v + "/" + SpaceService.recipientKey(r))));
        const given = keys.map(k => k.keyVersion + "/" + SpaceService.recipientKey(k.recipient));
        if (given.length !== expected.size || !given.every(k => expected.has(k)) || new Set(given).size !== given.length) {
            throw new AppException("SPACE_KEYS_INVALID", "there has to be exactly one key entry for every recipient and key version");
        }
        for (const key of keys) {
            if (!("groupId" in key.recipient)) {
                continue;
            }
            const epoch = groupEpochs.get(key.recipient.groupId);
            const wrappedTo = key.recipient.groupKeyVersion;
            if (epoch === undefined || wrappedTo > epoch || (key.keyVersion === currentVersion && wrappedTo !== epoch)) {
                throw new AppException("SPACE_KEYS_INVALID", `group '${key.recipient.groupId}' is at epoch ${epoch}, the entry names ${wrappedTo}`);
            }
        }
    }
    
    /**
     * Holds a submitted statement to the history it continues and to the state the bridge is about to store.
     * Whether its signer was entitled is the readers' question, with one part answered here as well: the
     * standing the signer claims has to be one it has and one that allows the change. A statement the readers
     * would refuse must not get into the history, or every reader would stop at it for good.
     */
    static assertStatement(st: types.cloud.SpaceStatement, x: {
        spaceId: types.space.SpaceId, contextId: types.context.ContextId, prior?: Pick<db.space.Space, "seq"|"statement"|"groups"|"users">,
        op: types.cloud.SpaceStatementOp, keyVersion: number, after: Recipients, caller: Caller, managerOnly: boolean,
    }) {
        const bad = (why: string): never => {
            throw new AppException("SPACE_STATEMENT_INVALID", why);
        };
        if (st.seq !== (x.prior ? x.prior.seq + 1 : 1)) {
            throw new AppException("SPACE_VERSION_MISMATCH", `the next statement is seq ${x.prior ? x.prior.seq + 1 : 1}`);
        }
        if (st.spaceId !== x.spaceId || st.contextId !== x.contextId) {
            bad("the statement names another space or context");
        }
        if (st.prevDigest !== (x.prior ? SpaceStatement.digest(x.prior.statement) : "")) {
            bad("prevDigest is not the digest of the statement before");
        }
        if (st.op !== x.op) {
            bad(`the statement is a '${st.op}', the call a '${x.op}'`);
        }
        // The same bound as a group statement's, so a forward-dated statement cannot freeze the ones after it.
        if (CommitStatement.isBadDate(st.date, x.prior ? x.prior.statement.date : 0, DateUtils.now())) {
            bad("date is off the bridge's clock or before the statement it extends");
        }
        if (st.keyVersion !== x.keyVersion) {
            bad(`the statement names key version ${st.keyVersion}, the change makes ${x.keyVersion}`);
        }
        if (x.op === "add" && st.keyCommit !== x.prior!.statement.keyCommit) {
            bad("adding recipients does not change the key: keyCommit has to stay");
        }
        if (!SpaceStatement.sameRecipients(st, x.after)) {
            bad("groups and users are not the recipients after the change, each group at its current epoch and key");
        }
        if (st.signer !== x.caller.userId || st.signerPubKey !== x.caller.pubKey) {
            bad("the signer is not the caller under its context key");
        }
        if (!SpaceStatement.verifySignature(st)) {
            bad("the signature does not verify");
        }
        // The standing is judged in the state before the change; a creation has only its own.
        const before = x.prior || x.after;
        let role: types.cloud.ContainerRole|undefined;
        if (st.via === "") {
            if (st.viaSignature !== "") {
                bad("viaSignature without via");
            }
            role = before.users.find(u => u.userId === x.caller.userId && u.pubKey === x.caller.pubKey)?.role;
            if (!role) {
                bad("the signer is not a user the space names: name the group it acts through in via");
            }
        }
        else {
            const group = before.groups.find(g => g.groupId === st.via);
            if (!group || !x.caller.ownGroupIds.includes(st.via)) {
                bad("via is not a recipient group the caller belongs to");
            }
            if (!SpaceStatement.verifyViaSignature(st, group!.groupPubKey)) {
                bad("viaSignature does not verify under the key the space holds for the group");
            }
            role = group!.role;
        }
        if (x.managerOnly && role !== "manager") {
            bad("the change takes a manager, and the standing the statement names is not one");
        }
    }
    
    /**
     * Holds every group the space wraps at or above the group's floors, inside the space's transaction. The group
     * document is written as well (`touchLadder`), so a floor raised concurrently (a removal
     * abandoning history writes that document too) is a write conflict and
     * one transaction re-runs against the other's result. A check alone would be write skew: each side would pass
     * against the other's old state, and the space would hold a key nobody can sign through any more.
     */
    // ponytail: every space write touches each named group's document, so concurrent writes to many spaces sharing
    // a group serialize on that document. Upgrade path: have floor-raising ops bump the spaces naming the group
    // instead, and keep `touchLadder` only for groups newly added to a space.
    static async assertGroupFloors(groupRepository: Pick<ReturnType<RepositoryFactory["createGroupRepository"]>, "get"|"touchLadder">, groups: db.space.Space["groups"]) {
        for (const g of groups) {
            const group = await groupRepository.get(g.groupId);
            if (!group || g.groupKeyVersion < group.eraFloor || !await groupRepository.touchLadder(group)) {
                throw new AppException("SPACE_KEYS_INVALID", `group '${g.groupId}' no longer reaches epoch ${g.groupKeyVersion}`);
            }
        }
    }
    
    private async view(space: db.space.Space, caller: {userId: types.cloud.UserId, ownGroupIds: types.group.GroupId[]}|undefined, currentKeysOnly: boolean): Promise<SpaceView> {
        const [view] = await this.views([space], caller, currentKeysOnly);
        return view;
    }
    
    private async views(spaces: db.space.Space[], caller: {userId: types.cloud.UserId, ownGroupIds: types.group.GroupId[]}|undefined, currentKeysOnly: boolean): Promise<SpaceView[]> {
        if (spaces.length === 0) {
            return [];
        }
        const groupEpochs = await this.getGroupEpochs(spaces[0].contextId, spaces);
        const keys = caller
            ? await this.repositoryFactory.createSpaceRepository().getKeys(spaces.map(s => s.id), caller.userId, caller.ownGroupIds,
                currentKeysOnly ? new Map(spaces.map(s => [s.id, s.keyVersion])) : undefined)
            : [];
        return spaces.map(space => ({space, keys: keys.filter(k => k.spaceId === space.id), keyIsStale: SpaceService.isStale(space, groupEpochs)}));
    }
    
    /** The caller's standing in a space. A backend (no user) passes as a manager and is served no keys. */
    private async access(executor: Executor, space: db.space.Space, acl: SpaceAcl) {
        let caller: Caller&{role: types.cloud.ContainerRole}|undefined;
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, space.contextId, async user => {
            this.cloudAclChecker.verifyAccess(user.acl, acl, ["spaceId=" + space.id]);
            const ownGroupIds = await this.getCallerGroupIds(space.contextId, user.userId);
            const role = SpaceService.roleOf(space, user.userId, ownGroupIds);
            if (!role) {
                throw new AppException("ACCESS_DENIED");
            }
            caller = {userId: user.userId, pubKey: user.userPubKey, ownGroupIds, role};
        });
        return caller;
    }
    
    async getSpace(executor: Executor, id: types.space.SpaceId): Promise<SpaceView> {
        const space = await this.repositoryFactory.createSpaceRepository().get(id);
        if (!space) {
            throw new AppException("SPACE_DOES_NOT_EXIST");
        }
        // The current version only: the older ones are paged (`getKeys`), or one read could carry thousands of versions.
        return this.view(space, await this.access(executor, space, "context/spaceGet"), true);
    }
    
    /** A page of the older key versions' wraps the caller can open; a backend (no user) is served none. */
    async getKeys(executor: Executor, model: SpaceGetKeysModel) {
        const repository = this.repositoryFactory.createSpaceRepository();
        const space = await repository.get(model.id);
        if (!space) {
            throw new AppException("SPACE_DOES_NOT_EXIST");
        }
        const caller = await this.access(executor, space, "context/spaceGetKeys");
        const last = Math.min(model.toKeyVersion ?? space.keyVersion, space.keyVersion);
        const upTo = Math.min(last, model.fromKeyVersion + (model.limit ?? SpaceService.KEY_PAGE) - 1);
        const keys = caller && model.fromKeyVersion <= upTo
            ? await repository.getKeyRange(space.id, caller.userId, caller.ownGroupIds, model.fromKeyVersion, upTo)
            : [];
        return {space, keys, nextKeyVersion: upTo < last ? upTo + 1 : undefined};
    }
    
    async getStatements(executor: Executor, model: SpaceGetStatementsModel) {
        const repository = this.repositoryFactory.createSpaceRepository();
        const space = await repository.get(model.id);
        if (!space) {
            throw new AppException("SPACE_DOES_NOT_EXIST");
        }
        await this.access(executor, space, "context/spaceGetStatements");
        return {space, statements: await repository.getStatements(model.id, model.fromSeq, model.limit)};
    }
    
    async listSpaces(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.space.Space) {
        let caller: {userId: types.cloud.UserId, ownGroupIds: types.group.GroupId[]}|undefined;
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, context, async user => {
            this.cloudAclChecker.verifyAccess(user.acl, "context/spaceList", []);
            caller = {userId: user.userId, ownGroupIds: await this.getCallerGroupIds(contextId, user.userId)};
        });
        const page = await this.repositoryFactory.createSpaceRepository().getPage(contextId, listParams, sortBy,
            caller && {userId: caller.userId, groupIds: caller.ownGroupIds});
        return {list: await this.views(page.list, caller, true), count: page.count};
    }
    
    async createSpace(cloudUser: CloudUser, model: SpaceCreateModel) {
        const {user} = await this.cloudAccessValidator.getUserFromContext(cloudUser, model.contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "context/spaceCreate", []);
        const {groups, users, groupEpochs} = await this.resolveRecipients(model.contextId, model.recipients);
        const ownGroupIds = await this.getCallerGroupIds(model.contextId, user.userId);
        if (SpaceService.roleOf({groups, users}, user.userId, ownGroupIds) !== "manager") {
            throw new AppException("ACCESS_DENIED", "the creator has to be a manager of the space");
        }
        SpaceService.assertKeysCover(model.keys, model.recipients, [1], 1, groupEpochs);
        const id = SpaceService.spaceId(model.contextId, model.resourceId);
        SpaceService.assertStatement(model.statement, {
            spaceId: id, contextId: model.contextId, op: "create", keyVersion: 1, after: {groups, users},
            caller: {userId: user.userId, pubKey: user.userPubKey, ownGroupIds}, managerOnly: true,
        });
        const now = DateUtils.now();
        const space: db.space.Space = {
            id: id,
            clientResourceId: model.resourceId,
            contextId: model.contextId,
            creator: user.userId,
            createDate: now,
            lastModifier: user.userId,
            lastModificationDate: now,
            groups: groups,
            users: users,
            keyId: model.keyId,
            keyVersion: 1,
            seq: 1,
            statement: model.statement,
            publicMeta: model.publicMeta,
            privateMeta: model.privateMeta,
            publicMetaVersion: 1,
            privateMetaVersion: 1,
            version: 1,
        };
        try {
            await this.repositoryFactory.withTransaction(async session => {
                await SpaceService.assertGroupFloors(this.repositoryFactory.createGroupRepository(session), space.groups);
                await this.repositoryFactory.createSpaceRepository(session).insert(space, model.keys);
            });
        }
        catch (err) {
            if (err instanceof DbDuplicateError) {
                throw new AppException("DUPLICATE_RESOURCE_ID");
            }
            throw err;
        }
        this.spaceNotificationService.sendCreatedSpace(space);
        return space;
    }
    
    async addRecipients(cloudUser: CloudUser, model: SpaceAddRecipientsModel) {
        const {space, user} = await this.getForChange(cloudUser, model.id, "context/spaceAddRecipients", true);
        const {groups, users, groupEpochs} = await this.resolveRecipients(space.contextId, model.recipients);
        if (groups.some(g => space.groups.some(x => x.groupId === g.groupId)) || users.some(u => space.users.some(x => x.userId === u.userId))) {
            throw new AppException("INVALID_PARAMS", "a recipient is already in the space");
        }
        if (space.groups.length + space.users.length + model.recipients.length > SpaceService.MAX_RECIPIENTS) {
            throw new AppException("INVALID_PARAMS", `a space takes at most ${SpaceService.MAX_RECIPIENTS} recipients`);
        }
        const versions = Array.from({length: space.keyVersion}, (_, i) => i + 1);
        SpaceService.assertKeysCover(model.keys, model.recipients, versions, space.keyVersion, groupEpochs);
        const after = {groups: [...space.groups, ...groups], users: [...space.users, ...users]};
        SpaceService.assertStatement(model.statement, {
            spaceId: space.id, contextId: space.contextId, prior: space, op: "add", keyVersion: space.keyVersion, after, caller: user, managerOnly: true,
        });
        const changed = await this.write(space, user.userId, after, repository => repository.insertKeys(space.id, model.keys), model.statement);
        this.spaceNotificationService.sendUpdatedSpace(changed, "recipientsAdded");
        return changed;
    }
    
    /** Moves the space to a new key, leaving `model.groups` and `model.users` out of it. Leaving nobody out is a rotation. */
    async rotateKey(cloudUser: CloudUser, model: SpaceRemoveRecipientsModel, acl: "context/spaceRotateKey"|"context/spaceRemoveRecipients") {
        const removedGroups = model.groups || [];
        const removedUsers = model.users || [];
        const removing = acl === "context/spaceRemoveRecipients";
        const {space, user} = await this.getForChange(cloudUser, model.id, acl, removing);
        if (removing && removedGroups.length + removedUsers.length === 0) {
            throw new AppException("INVALID_PARAMS", "nobody to remove");
        }
        if (removedGroups.some(id => !space.groups.some(g => g.groupId === id)) || removedUsers.some(id => !space.users.some(u => u.userId === id))) {
            throw new AppException("INVALID_PARAMS", "not a recipient of the space");
        }
        if (model.expectedKeyVersion !== space.keyVersion) {
            throw new AppException("SPACE_VERSION_MISMATCH");
        }
        const users = space.users.filter(u => !removedUsers.includes(u.userId));
        const staying = space.groups.filter(g => !removedGroups.includes(g.groupId));
        if (![...users, ...staying].some(r => r.role === "manager")) {
            throw new AppException("SPACE_LAST_MANAGER");
        }
        const heads = await this.repositoryFactory.createGroupRepository().getKeyHeads(space.contextId, staying.map(g => g.groupId));
        const groupEpochs: GroupEpochs = new Map([...heads].map(([id, head]) => [id, head.keyVersion]));
        const keyVersion = space.keyVersion + 1;
        SpaceService.assertKeysCover(model.keys, [...staying, ...users], [keyVersion], keyVersion, groupEpochs);
        // The new key is wrapped to each group's current epoch: `assertKeysCover` just held the entries to that.
        const groups = staying.map(g => ({...g, groupKeyVersion: heads.get(g.groupId)!.keyVersion, groupPubKey: heads.get(g.groupId)!.groupPubKey}));
        SpaceService.assertStatement(model.statement, {
            spaceId: space.id, contextId: space.contextId, prior: space, op: removing ? "remove" : "rotate", keyVersion, after: {groups, users},
            caller: user, managerOnly: removing,
        });
        // Every rotation adds a key version every later recipient needs a wrap of, so it is rate-limited
        // (`rotationBudget` says which budget, if any, this one spends).
        const held = await this.reserveRotation(space.id, user.userId, SpaceService.rotationBudget(removing, staying, groupEpochs));
        let changed: db.space.Space;
        try {
            changed = await this.write(space, user.userId, {groups, users, keyId: model.keyId, keyVersion}, async repository => {
                if (removing) {
                    await repository.deleteKeysOf(space.id, removedGroups, removedUsers);
                }
                await repository.insertKeys(space.id, model.keys);
            }, model.statement);
        }
        catch (e) {
            // Only a rotation that landed is charged.
            for (const key of held) {
                await this.rotationRateLimiter.release({key});
            }
            throw e;
        }
        this.spaceNotificationService.sendUpdatedSpace(changed, removing ? "recipientsRemoved" : "keyRotated", removedUsers, removedGroups);
        return changed;
    }
    
    async updateMeta(cloudUser: CloudUser, model: SpaceUpdateMetaModel, plane: "publicMeta"|"privateMeta") {
        const {space, user} = await this.getForChange(cloudUser, model.id, plane === "publicMeta" ? "context/spaceUpdatePublicMeta" : "context/spaceUpdatePrivateMeta", true);
        const counter = plane === "publicMeta" ? "publicMetaVersion" : "privateMetaVersion";
        if (model.version !== space[counter]) {
            throw new AppException("SPACE_VERSION_MISMATCH");
        }
        const changed = await this.write(space, user.userId, {[plane]: model.meta, [counter]: space[counter] + 1});
        this.spaceNotificationService.sendUpdatedSpace(changed, "metaUpdated");
        return changed;
    }
    
    async deleteSpace(executor: Executor, id: types.space.SpaceId) {
        const repository = this.repositoryFactory.createSpaceRepository();
        const space = await repository.get(id);
        if (!space) {
            throw new AppException("SPACE_DOES_NOT_EXIST");
        }
        const caller = await this.access(executor, space, "context/spaceDelete");
        if (caller && caller.role !== "manager") {
            throw new AppException("ACCESS_DENIED");
        }
        await this.repositoryFactory.withTransaction(session => this.repositoryFactory.createSpaceRepository(session).delete(space));
        this.spaceNotificationService.sendDeletedSpace(space);
        return space;
    }
    
    /** The context is gone by now, so the backend is told under the solution it had. */
    async deleteSpacesByContext(contextId: types.context.ContextId, solution: types.cloud.SolutionId) {
        const repository = this.repositoryFactory.createSpaceRepository();
        for (const space of await repository.getByContext(contextId)) {
            await repository.delete(space);
            this.spaceNotificationService.sendDeletedSpace(space, solution);
        }
        // The tombstones just written and those of spaces deleted earlier one by one.
        await repository.deleteTombstonesOfContext(contextId);
    }
    
    private async getForChange(cloudUser: CloudUser, id: types.space.SpaceId, acl: SpaceAcl, managerOnly: boolean) {
        const space = await this.repositoryFactory.createSpaceRepository().get(id);
        if (!space) {
            throw new AppException("SPACE_DOES_NOT_EXIST");
        }
        const caller = await this.access(cloudUser, space, acl);
        if (!caller || (managerOnly && caller.role !== "manager")) {
            throw new AppException("ACCESS_DENIED");
        }
        return {space, user: caller};
    }
    
    /** The document and its keys in one transaction, behind the compare-and-swap on the document's version. */
    private async write(
        space: db.space.Space, modifier: types.cloud.UserId, changes: Partial<db.space.Space>,
        keys?: (repository: ReturnType<RepositoryFactory["createSpaceRepository"]>) => Promise<void>, statement?: types.cloud.SpaceStatement,
    ) {
        const all = {...changes, ...(statement ? {seq: statement.seq, statement} : {}), lastModifier: modifier, lastModificationDate: DateUtils.now()};
        await this.repositoryFactory.withTransaction(async session => {
            const repository = this.repositoryFactory.createSpaceRepository(session);
            if (!await repository.update(space, all)) {
                throw new AppException("SPACE_VERSION_MISMATCH");
            }
            if (changes.groups) {
                await SpaceService.assertGroupFloors(this.repositoryFactory.createGroupRepository(session), changes.groups);
            }
            await keys?.(repository);
            if (statement) {
                await repository.insertStatement(statement);
            }
        });
        return {...space, ...all, version: space.version + 1};
    }
    
    /**
     * Reserves one unit of each of the caller's budgets of `kind` for the space — `maxSpaceRotationsPerMinute` a
     * minute and `maxSpaceRotationsPerHour` an hour, removals and rotations each their own, a stale re-key only the
     * per-minute one — or hands back what it took and refuses.
     */
    private async reserveRotation(spaceId: types.space.SpaceId, userId: types.cloud.UserId, kind: "rotate"|"remove"|"stale"): Promise<string[]> {
        const prefix = kind === "remove" ? "spaceRemove" : kind === "stale" ? "spaceRotateStale" : "spaceRotate";
        const budgets = [
            {key: `${prefix}Burst|${spaceId}|${userId}`, limit: this.config.maxSpaceRotationsPerMinute, windowMs: DateUtils.minutes(1)},
            ...(kind === "stale" ? [] : [{key: `${prefix}|${spaceId}|${userId}`, limit: this.config.maxSpaceRotationsPerHour}]),
        ];
        const held: string[] = [];
        for (const budget of budgets) {
            const {allowed, retryAt} = await this.rotationRateLimiter.reserve(budget);
            if (!allowed) {
                for (const key of held) {
                    await this.rotationRateLimiter.release({key});
                }
                throw new AppException("SPACE_ROTATION_RATE_LIMIT", {retryAt});
            }
            held.push(budget.key);
        }
        return held;
    }
    
    /** Splits recipients into groups and users, after checking each exists in the context under the key given. */
    private async resolveRecipients(contextId: types.context.ContextId, recipients: types.cloud.SpaceRecipient[]) {
        if (recipients.length > SpaceService.MAX_RECIPIENTS) {
            throw new AppException("INVALID_PARAMS", `a space takes at most ${SpaceService.MAX_RECIPIENTS} recipients`);
        }
        if (new Set(recipients.map(r => SpaceService.recipientKey(r))).size !== recipients.length) {
            throw new AppException("INVALID_PARAMS", "a recipient is given twice");
        }
        const users = recipients.flatMap(r => "userId" in r ? [{userId: r.userId, pubKey: r.pubKey, role: r.role}] : []);
        const groupIds = recipients.flatMap(r => "groupId" in r ? [r.groupId] : []);
        const contextUsers = await this.repositoryFactory.createContextUserRepository().getUsers(contextId, users.map(u => u.userId));
        if (users.some(u => !contextUsers.some(c => c.userId === u.userId && c.userPubKey === u.pubKey))) {
            throw new AppException("USER_DOESNT_EXIST", "a recipient is not a user of the context under the given key");
        }
        const groupRepository = this.repositoryFactory.createGroupRepository();
        await groupRepository.checkGroupsExistence(contextId, groupIds);
        const heads = await groupRepository.getKeyHeads(contextId, groupIds);
        const groupEpochs: GroupEpochs = new Map([...heads].map(([id, head]) => [id, head.keyVersion]));
        const groups = recipients.flatMap(r => "groupId" in r ? [{groupId: r.groupId, role: r.role, groupKeyVersion: heads.get(r.groupId)!.keyVersion, groupPubKey: heads.get(r.groupId)!.groupPubKey}] : []);
        return {groups, users, groupEpochs};
    }
}
