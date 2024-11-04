/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoDbManager } from "./mongo/MongoDbManager";
import * as mongodb from "mongodb";
import { MongoObjectRepository } from "./mongo/MongoObjectRepository";
import { ConfigService } from "../service/config/ConfigService";
import { RequestRepository } from "../service/request/RequestRepository";
import * as types from "../types";
import * as db from "../db/Model";
import { NonceRepository } from "../service/misc/NonceRepository";
import { SettingsRepository } from "../service/misc/SettingsRepository";
import { SessionRepository } from "../service/session/SessionRepository";
import { TicketDataRepository } from "../service/session/TicketDataRepository";
import { ServerStatsRepository } from "../service/misc/ServerStatsRepository";
import { ContextRepository } from "../service/cloud/ContextRepository";
import { ContextUserRepository } from "../service/cloud/ContextUserRepository";
import { ThreadRepository } from "../service/cloud/ThreadRepository";
import { ThreadMessageRepository } from "../service/cloud/ThreadMessageRepository";
import { StoreRepository } from "../service/cloud/StoreRepository";
import { StoreFileRepository } from "../service/cloud/StoreFileRepository";
import { ResourceRepository } from "../service/cloud/ResourceRepository";
import { ResourceCollectionName } from "../service/cloud/ResourceTypeProvider";
import { InboxRepository } from "../service/cloud/InboxRepository";
import { StreamRoomRepository } from "../service/cloud/StreamRoomRepository";
import { ApiKeyRepository } from "../service/auth/ApiKeyRepository";
import { ApiUserRepository } from "../service/auth/ApiUserRepository";
import { TokenSessionRepository } from "../service/auth/TokenSessionRepository";
import { TokenEncryptionKeyRepository } from "../service/auth/TokenEncryptionKeyRepository";
import { SolutionRepository } from "../service/cloud/SolutionRepository";

export class RepositoryFactory {
    
    constructor(
        private mongoDbManager: MongoDbManager,
        private configService: ConfigService,
    ) {
    }
    
    async withTransaction<T>(func: (session: mongodb.ClientSession) => Promise<T>): Promise<T> {
        return this.mongoDbManager.withTransaction(func);
    }
    
    async withLock<T>(lockId: string|string[], session: mongodb.ClientSession, func: () => Promise<T>) {
        return this.mongoDbManager.withLock(lockId, session, func);
    }
    
    async withTransactionAndLock<T>(lockId: string|string[], func: (session: mongodb.ClientSession) => Promise<T>): Promise<T> {
        return this.mongoDbManager.withTransactionAndLock(lockId, func);
    }
    
    generateId() {
        return this.mongoDbManager.generateId();
    }
    
    createObjectRepositoryFor<Id extends string|number, Type>(repositoryClass: {new(repo: MongoObjectRepository<Id, Type>, ...args: any[]): unknown, COLLECTION_NAME: string, COLLECTION_ID_PROP: keyof Type}, session?: mongodb.ClientSession) {
        return this.mongoDbManager.getRepository<Id, Type>(repositoryClass.COLLECTION_NAME, repositoryClass.COLLECTION_ID_PROP, session);
    }
    
    createObjectRepositoryForX<Id extends string|number, Type>(repositoryClass: {new(repo: MongoObjectRepository<Id, Type>, ...args: any[]): unknown, COLLECTION_NAME: string, COLLECTION_ID_PROP: keyof Type}, id: string, session?: mongodb.ClientSession) {
        return this.mongoDbManager.getRepository<Id, Type>(this.getCollectionName(repositoryClass, id), repositoryClass.COLLECTION_ID_PROP, session);
    }
    
    getCollectionName(repositoryClass: {COLLECTION_NAME: string}, id: string) {
        return `${repositoryClass.COLLECTION_NAME}-${id}`;
    }
    
    createRequestRepository(session?: mongodb.ClientSession) {
        return new RequestRepository(this.createObjectRepositoryFor(RequestRepository, session));
    }
    
    createNonceRepository(session?: mongodb.ClientSession) {
        return new NonceRepository(this.createObjectRepositoryFor(NonceRepository, session));
    }
    
    createSettingsRepository(session?: mongodb.ClientSession) {
        return new SettingsRepository(this.createObjectRepositoryFor(SettingsRepository, session));
    }
    
    createSessionRepository(session?: mongodb.ClientSession) {
        return new SessionRepository(this.createObjectRepositoryFor(SessionRepository, session), this.configService);
    }
    
    createTicketDataRepository(session?: mongodb.ClientSession) {
        return new TicketDataRepository(this.createObjectRepositoryFor(TicketDataRepository, session));
    }
    
    createServerStatsRepository(session?: mongodb.ClientSession) {
        return new ServerStatsRepository(this.createObjectRepositoryFor(ServerStatsRepository, session));
    }
    
    createContextRepository(session?: mongodb.ClientSession) {
        return new ContextRepository(this.createObjectRepositoryFor(ContextRepository, session));
    }
    
    createContextUserRepository(session?: mongodb.ClientSession) {
        return new ContextUserRepository(this.createObjectRepositoryFor(ContextUserRepository, session));
    }
    
    createThreadRepository(session?: mongodb.ClientSession) {
        return new ThreadRepository(this.createObjectRepositoryFor(ThreadRepository, session));
    }
    
    createThreadMessageRepository(session?: mongodb.ClientSession) {
        return new ThreadMessageRepository(this.createObjectRepositoryFor(ThreadMessageRepository, session));
    }
    
    createStoreRepository(session?: mongodb.ClientSession) {
        return new StoreRepository(this.createObjectRepositoryFor(StoreRepository, session));
    }
    
    createStoreFileRepository(session?: mongodb.ClientSession) {
        return new StoreFileRepository(this.createObjectRepositoryFor(StoreFileRepository, session));
    }
    
    createResourceRepository(resourceCollectioName: ResourceCollectionName, session?: mongodb.ClientSession) {
        const repo = this.mongoDbManager.getRepository<types.resource.ResourceId, db.resource.Resource>(resourceCollectioName, ResourceRepository.COLLECTION_ID_PROP, session);
        return new ResourceRepository(repo);
    }
    
    createInboxRepository(session?: mongodb.ClientSession) {
        return new InboxRepository(this.createObjectRepositoryFor(InboxRepository, session));
    }
    
    createStreamRoomRepository(session?: mongodb.ClientSession) {
        return new StreamRoomRepository(this.createObjectRepositoryFor(StreamRoomRepository, session));
    }
    
    createApiKeyRepository(session?: mongodb.ClientSession) {
        return new ApiKeyRepository(this.createObjectRepositoryFor(ApiKeyRepository, session));
    }
    
    createApiUserRepository(session?: mongodb.ClientSession) {
        return new ApiUserRepository(this.createObjectRepositoryFor(ApiUserRepository, session));
    }
    
    createTokenSessionRepository(session?: mongodb.ClientSession) {
        return new TokenSessionRepository(this.createObjectRepositoryFor(TokenSessionRepository, session));
    }
    
    createTokenEncryptionKeyRepository(session?: mongodb.ClientSession) {
        return new TokenEncryptionKeyRepository(this.createObjectRepositoryFor(TokenEncryptionKeyRepository, session));
    }
    
    createSolutionRepository(session?: mongodb.ClientSession) {
        return new SolutionRepository(this.createObjectRepositoryFor(SolutionRepository, session));
    }
}
