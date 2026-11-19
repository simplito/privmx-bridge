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
import type { SpaceAddRecipientsModel, SpaceCreateModel, SpaceRemoveRecipientsModel, SpaceUpdateMetaModel } from "../../api/main/context/ContextApiTypes";

type SpaceAcl = "context/spaceGet"|"context/spaceList"|"context/spaceCreate"|"context/spaceDelete"|"context/spaceAddRecipients"
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
    
    constructor(
        repositoryFactory: RepositoryFactory,
        activeUsersMap: ActiveUsersMap,
        host: types.core.Host,
        private cloudAclChecker: CloudAclChecker,
        private cloudAccessValidator: CloudAccessValidator,
        private spaceNotificationService: SpaceNotificationService,
    ) {
        super(repositoryFactory, activeUsersMap, host);
    }
    
    /** Derived as a group's id is: lowercase hex of `H("pmx-space-id\0" || lp(contextId) || lp(resourceId))`. */
    static spaceId(contextId: types.context.ContextId, resourceId: types.core.ClientResourceId): types.space.SpaceId {
        return Crypto.sha256(new ByteWriter().tag("pmx-space-id").lp(contextId).lp(resourceId).bytes()).toString("hex") as types.space.SpaceId;
    }
    
    /** The caller's role in the space: the highest of its own and of the groups it belongs to. */
    static roleOf(space: Pick<db.space.Space, "groups"|"users">, userId: types.cloud.UserId, ownGroupIds: types.group.GroupId[]): types.cloud.ContainerRole|undefined {
        const roles = [
            ...space.users.filter(u => u.userId === userId).map(u => u.role),
            ...space.groups.filter(g => ownGroupIds.includes(g.groupId)).map(g => g.role),
        ];
        return roles.includes("manager") ? "manager" : roles[0];
    }
    
    /** True when a recipient group is past the epoch the current key was wrapped to, or cannot be found. */
    static isStale(space: Pick<db.space.Space, "groups">, groupEpochs: GroupEpochs): boolean {
        return space.groups.some(g => {
            const epoch = groupEpochs.get(g.groupId);
            return epoch === undefined || epoch > g.groupKeyVersion;
        });
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
        let caller: {userId: types.cloud.UserId, ownGroupIds: types.group.GroupId[], role: types.cloud.ContainerRole}|undefined;
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, space.contextId, async user => {
            this.cloudAclChecker.verifyAccess(user.acl, acl, ["spaceId=" + space.id]);
            const ownGroupIds = await this.getCallerGroupIds(space.contextId, user.userId);
            const role = SpaceService.roleOf(space, user.userId, ownGroupIds);
            if (!role) {
                throw new AppException("ACCESS_DENIED");
            }
            caller = {userId: user.userId, ownGroupIds, role};
        });
        return caller;
    }
    
    async getSpace(executor: Executor, id: types.space.SpaceId): Promise<SpaceView> {
        const space = await this.repositoryFactory.createSpaceRepository().get(id);
        if (!space) {
            throw new AppException("SPACE_DOES_NOT_EXIST");
        }
        return this.view(space, await this.access(executor, space, "context/spaceGet"), false);
    }
    
    async listSpaces(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel, sortBy: keyof db.space.Space) {
        let caller: {userId: types.cloud.UserId, ownGroupIds: types.group.GroupId[]}|undefined;
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, async user => {
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
        if (SpaceService.roleOf({groups, users}, user.userId, await this.getCallerGroupIds(model.contextId, user.userId)) !== "manager") {
            throw new AppException("ACCESS_DENIED", "the creator has to be a manager of the space");
        }
        SpaceService.assertKeysCover(model.keys, model.recipients, [1], 1, groupEpochs);
        const now = DateUtils.now();
        const space: db.space.Space = {
            id: SpaceService.spaceId(model.contextId, model.resourceId),
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
            publicMeta: model.publicMeta,
            privateMeta: model.privateMeta,
            publicMetaVersion: 1,
            privateMetaVersion: 1,
            version: 1,
        };
        try {
            await this.repositoryFactory.withTransaction(session => this.repositoryFactory.createSpaceRepository(session).insert(space, model.keys));
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
        const changed = await this.write(space, user.userId, {groups: [...space.groups, ...groups], users: [...space.users, ...users]},
            repository => repository.insertKeys(space.id, model.keys));
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
        const groupEpochs = await this.getGroupEpochs(space.contextId, [{groups: staying}]);
        const keyVersion = space.keyVersion + 1;
        SpaceService.assertKeysCover(model.keys, [...staying, ...users], [keyVersion], keyVersion, groupEpochs);
        // The new key is wrapped to each group's current epoch: `assertKeysCover` just held the entries to that.
        const groups = staying.map(g => ({...g, groupKeyVersion: groupEpochs.get(g.groupId)!}));
        const changed = await this.write(space, user.userId, {groups, users, keyId: model.keyId, keyVersion}, async repository => {
            if (removing) {
                await repository.deleteKeysOf(space.id, removedGroups, removedUsers);
            }
            await repository.insertKeys(space.id, model.keys);
        });
        this.spaceNotificationService.sendUpdatedSpace(changed, removing ? "recipientsRemoved" : "keyRotated", removedUsers);
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
        await this.repositoryFactory.withTransaction(session => this.repositoryFactory.createSpaceRepository(session).delete(id));
        this.spaceNotificationService.sendDeletedSpace(space);
        return space;
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
    private async write(space: db.space.Space, modifier: types.cloud.UserId, changes: Partial<db.space.Space>, keys?: (repository: ReturnType<RepositoryFactory["createSpaceRepository"]>) => Promise<void>) {
        const all = {...changes, lastModifier: modifier, lastModificationDate: DateUtils.now()};
        await this.repositoryFactory.withTransaction(async session => {
            const repository = this.repositoryFactory.createSpaceRepository(session);
            if (!await repository.update(space, all)) {
                throw new AppException("SPACE_VERSION_MISMATCH");
            }
            await keys?.(repository);
        });
        return {...space, ...all, version: space.version + 1};
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
        const groupEpochs = await groupRepository.getKeyVersions(contextId, groupIds);
        const groups = recipients.flatMap(r => "groupId" in r ? [{groupId: r.groupId, role: r.role, groupKeyVersion: groupEpochs.get(r.groupId)!}] : []);
        return {groups, users, groupEpochs};
    }
}
