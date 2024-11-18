/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import { CloudUser, Executor } from "../../CommonTypes";
import * as types from "../../types";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { CloudKeyService } from "./CloudKeyService";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { StreamNotificationService } from "./StreamNotificationService";
import { CloudAclChecker } from "./CloudAclChecker";
import { PolicyService } from "./PolicyService";
import { BasePolicy } from "./BasePolicy";
import { CloudAccessValidator } from "./CloudAccessValidator";

export class StreamService {
    
    private policy: StreamRoomPolicy;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private cloudKeyService: CloudKeyService,
        private streamNotificationService: StreamNotificationService,
        private cloudAclChecker: CloudAclChecker,
        private policyService: PolicyService,
        private cloudAccessValidator: CloudAccessValidator,
    ) {
        this.policy = new StreamRoomPolicy(this.policyService);
    }
    
    async createStreamRoom(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.stream.StreamRoomType|undefined, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.stream.StreamRoomData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], policy: types.cloud.ContainerWithoutItemPolicy) {
        this.policyService.validateContainerPolicyForContainer("policy", policy);
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomCreate", []);
        this.policy.makeCreateContainerCheck(user, context, managers, policy);
        const newKeys = await this.cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers);
        const streamRoom = await this.repositoryFactory.createStreamRoomRepository().createStreamRoom(contextId, type, user.userId, managers, users, data, keyId, newKeys, policy);
        this.streamNotificationService.sendStreamRoomCreated(streamRoom, context.solution);
        return streamRoom;
    }
    
    async updateStreamRoom(cloudUser: CloudUser, id: types.stream.StreamRoomId, users: types.cloud.UserId[], managers: types.cloud.UserId[], data: types.stream.StreamRoomData, keyId: types.core.KeyId, keys: types.cloud.KeyEntrySet[], version: types.stream.StreamRoomVersion, force: boolean, policy: types.cloud.ContainerWithoutItemPolicy|undefined) {
        if (policy) {
            this.policyService.validateContainerPolicyForContainer("policy", policy);
        }
        const {streamRoom: rStreamRoom, context: usedContext} = await this.repositoryFactory.withTransaction(async session => {
            const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository(session);
            const oldStreaRoom = await streamRoomRepository.get(id);
            if (!oldStreaRoom) {
                throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
            }
            const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, oldStreaRoom.contextId);
            this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomUpdate", ["streamRoomId=" + id]);
            this.policy.makeUpdateContainerCheck(user, context, oldStreaRoom, managers, policy);
            const currentVersion = <types.stream.StreamRoomVersion>oldStreaRoom.history.length;
            if (currentVersion !== version && !force) {
                throw new AppException("ACCESS_DENIED", "version does not match");
            }
            const newKeys = await this.cloudKeyService.checkKeysAndClients(oldStreaRoom.contextId, [...oldStreaRoom.history.map(x => x.keyId), keyId], oldStreaRoom.keys, keys, keyId, users, managers);
            const streamRoom = await streamRoomRepository.updateStreamRoom(oldStreaRoom, user.userId, managers, users, data, keyId, newKeys, policy);
            return {streamRoom, context};
        });
        this.streamNotificationService.sendStreamRoomUpdated(rStreamRoom, usedContext.solution);
        return rStreamRoom;
    }
    
    async deleteStreamRoom(executor: Executor, id: types.stream.StreamRoomId) {
        const result = await this.repositoryFactory.withTransaction(async session => {
            const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository(session);
            const streamRoom = await streamRoomRepository.get(id);
            if (!streamRoom) {
                throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
            }
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, streamRoom.contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomDelete", ["streamRoomId=" + id]);
                if (!this.policy.canDeleteContainer(user, context, streamRoom)) {
                    throw new AppException("ACCESS_DENIED");
                }
            });
            await streamRoomRepository.deleteStreamRoom(streamRoom.id);
            return {streamRoom, usedContext};
        });
        this.streamNotificationService.sendStreamRoomDeleted(result.streamRoom, result.usedContext.solution);
        return result.streamRoom;
    }
    
    async deleteManyStreamRooms(executor: Executor, streamRoomIds: types.stream.StreamRoomId[]) {
        const resultMap: Map<types.stream.StreamRoomId, "OK" | "STREAM_ROOM_DOES_NOT_EXIST" | "ACCESS_DENIED"> = new Map();
        for (const id of streamRoomIds) {
            resultMap.set(id, "STREAM_ROOM_DOES_NOT_EXIST");
        }
        
        const result = await this.repositoryFactory.withTransaction(async session => {
            const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository(session);
            const streamRooms = await streamRoomRepository.getMany(streamRoomIds);
            if (streamRooms.length === 0) {
                return {context: null, toNotify: []};
            }
            const contextId = streamRooms[0].contextId;
            let additionalAccessCheck: ((streamRoom: db.stream.StreamRoom) => boolean) = () => true;
            const usedContext = await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, contextId, (user, context) => {
                this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomDeleteMany", []);
                additionalAccessCheck = streamRoom => this.policy.canDeleteContainer(user, context, streamRoom);
            });
            const toDelete: types.stream.StreamRoomId[] = [];
            const toNotify: db.stream.StreamRoom[] = [];
            for (const streamRoom of streamRooms) {
                if(streamRoom.contextId !== contextId) {
                    throw new AppException("RESOURCES_HAVE_DIFFERENT_CONTEXTS");
                }
                if (!additionalAccessCheck(streamRoom)) {
                    resultMap.set(streamRoom.id, "ACCESS_DENIED");
                }
                else {
                    resultMap.set(streamRoom.id, "OK");
                    toDelete.push(streamRoom.id);
                    toNotify.push(streamRoom);
                }
            }
            await streamRoomRepository.deleteManyStreamRooms(toDelete);
            return {context: usedContext, toNotify};
        });
        if (result.context) {
            for (const deletedInbox of result.toNotify) {
                this.streamNotificationService.sendStreamRoomDeleted(deletedInbox, result.context.solution);
            }
        }
        
        const resultArray: types.stream.StreamRoomDeleteStatus[] = [];
        for (const [id, status] of resultMap) {
            resultArray.push({id, status});
        }
        
        return {contextId: result.context ? result.context.id : null, results: resultArray};
    }
    
    async deleteStreamRoomsByContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const streamRoomRepository = this.repositoryFactory.createStreamRoomRepository();
        
        await streamRoomRepository.deleteOneByOneByContext(contextId, async streamRoom => {
            this.streamNotificationService.sendStreamRoomDeleted(streamRoom, solutionId);
        });
    }
    
    async getStreamRoom(executor: Executor, streamRoomId: types.stream.StreamRoomId, type: types.stream.StreamRoomType|undefined) {
        const streamRoom = await this.repositoryFactory.createStreamRoomRepository().get(streamRoomId);
        if (!streamRoom) {
            throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, streamRoom.contextId, (user, context) => {
            if (!this.policy.canReadContainer(user, context, streamRoom)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomGet", ["streamRoomId=" + streamRoomId]);
        });
        if (type && streamRoom.type !== type) {
            throw new AppException("STREAM_ROOM_DOES_NOT_EXIST");
        }
        return streamRoom;
    }
    
    async getAllStreamRooms(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.stream.StreamRoomType|undefined, listParams: types.core.ListModel, sortBy: keyof db.stream.StreamRoom) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomListAll", []);
        if (!this.policy.canListAllContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const streamRooms = await this.repositoryFactory.createStreamRoomRepository().getAllStreams(contextId, type, listParams, sortBy);
        return {user, streamRooms};
    }
    
    async getMyStreamRooms(cloudUser: CloudUser, contextId: types.context.ContextId, type: types.stream.StreamRoomType|undefined, listParams: types.core.ListModel, sortBy: keyof db.stream.StreamRoom) {
        const {user, context} = await this.cloudAccessValidator.getUserFromContext(cloudUser, contextId);
        this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomList", []);
        if (!this.policy.canListMyContainers(user, context)) {
            throw new AppException("ACCESS_DENIED");
        }
        const streamRooms = await this.repositoryFactory.createStreamRoomRepository().getPageByContextAndUser(contextId, type, user.userId, cloudUser.solutionId, listParams, sortBy);
        return {user, streamRooms};
    }
    
    async getStreamRoomsByContext(executor: Executor, contextId: types.context.ContextId, listParams: types.core.ListModel2<types.stream.StreamRoomId>) {
        const ctx = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!ctx) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.cloudAccessValidator.checkIfCanExecuteInContext(executor, ctx, (user, context) => {
            if (!this.policy.canListAllContainers(user, context)) {
                throw new AppException("ACCESS_DENIED");
            }
            this.cloudAclChecker.verifyAccess(user.acl, "stream/streamRoomList", []);
        });
        const streamRooms = await this.repositoryFactory.createStreamRoomRepository().getPageByContext(contextId, listParams);
        return {streamRooms};
    }
}

class StreamRoomPolicy extends BasePolicy<db.stream.StreamRoom, unknown> {
    
    protected isItemCreator() {
        return false;
    }
    
    protected extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.stream || {};
    }
}
