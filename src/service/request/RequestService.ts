/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as requestApi from "../../api/main/request/RequestApiTypes";
import * as db from "../../db/Model";
import { AppException } from "../../api/AppException";
import { ConfigService } from "../config/ConfigService";
import { ObjectRepository } from "../../db/ObjectRepository";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import * as mongodb from "mongodb";
import { Logger } from "../log/Logger";
import { StorageServiceProvider } from "../cloud/StorageServiceProvider";

export interface RequestX {
    request: db.request.Request;
    moved: types.request.FileId[];
}

export class RequestService {
    
    constructor(
        private configService: ConfigService,
        private storageService: StorageServiceProvider,
        private repositoryFactory: RepositoryFactory,
        private logger: Logger,
    ) {
    }
    
    async getConfig() {
        const config: types.request.RequestConfig = {
            maxFilesCount: this.configService.values.request.maxFilesCount,
            maxRequestSize: this.configService.values.request.maxRequestSize,
            maxFileSize: this.configService.values.request.maxFileSize,
            chunkSize: this.configService.values.request.chunkSize,
        };
        return config;
    }
    
    async createRequest(user: types.core.Username, model: requestApi.CreateRequestModel) {
        return this.repositoryFactory.withTransaction(async session => {
            const requestRepository = this.repositoryFactory.createRequestRepository(session);
            if (model.files.length > this.configService.values.request.maxFilesCount) {
                throw new AppException("TOO_MANY_FILES_IN_REQUEST", {given: model.files.length, maxCount: this.configService.values.request.maxFilesCount});
            }
            for (const [i, file] of model.files.entries()) {
                if (file.size > this.configService.values.request.maxFileSize) {
                    throw new AppException("REQUEST_FILE_SIZE_EXCEEDED", {index: i, size: file.size, max: this.configService.values.request.maxFileSize});
                }
                if (file.checksumSize > this.configService.values.request.maxFileSize) {
                    throw new AppException("REQUEST_FILE_SIZE_EXCEEDED", {index: i, size: file.checksumSize, max: this.configService.values.request.maxFileSize});
                }
            }
            const fullSize = model.files.reduce((value, x) => value + x.size + x.checksumSize, 0);
            if (fullSize > this.configService.values.request.maxRequestSize) {
                throw new AppException("REQUEST_SIZE_EXCEEDED", {size: fullSize, max: this.configService.values.request.maxRequestSize});
            }
            const req = await requestRepository.create(user, model.files);
            return req;
        });
    }
    
    async destroyRequest(user: types.core.Username, id: types.request.RequestId) {
        return this.repositoryFactory.withTransaction(async session => {
            const requestRepository = this.repositoryFactory.createRequestRepository(session);
            await requestRepository.deleteWithAccessCheck(user, id);
        });
    }
    
    async sendChunk(user: types.core.Username, model: requestApi.ChunkModel) {
        const verify = async (session?: mongodb.ClientSession) => {
            const requestRepository = this.repositoryFactory.createRequestRepository(session);
            const oldReq = await requestRepository.getWithAccessCheck(user, model.requestId);
            if (model.fileIndex >= oldReq.files.length) {
                throw new AppException("REQUEST_FILE_DOES_NOT_EXIST", {files: oldReq.files.length, givenIndex: model.fileIndex});
            }
            const file = oldReq.files[model.fileIndex];
            if (file.closed) {
                throw new AppException("REQUEST_FILE_ALREADY_CLOSED", {fileIndex: model.fileIndex});
            }
            if (file.sent + model.data.length > file.size) {
                throw new AppException("REQUEST_FILE_SIZE_EXCEEDED", {fileIndex: model.fileIndex, size: file.size, sent: file.sent + model.data.length});
            }
            if (file.seq !== model.seq) {
                throw new AppException("REQUEST_FILE_DESYNCHRONIZED", {fileIndex: model.fileIndex, seq: file.seq, given: model.seq});
            }
            const fixedChunkSize = 128 * 1024;
            if (model.data.length < fixedChunkSize) {
                if (file.sent + model.data.length < file.size) { // It is not the last part
                    this.logger.warning({requestId: model.requestId, fileIndex: model.fileIndex, seq: file.seq, expected: fixedChunkSize, given: model.data.length, fileSize: file.size}, "REQUEST_CHUNK_TOO_SMALL");
                    // throw new JsonRpcException("REQUEST_CHUNK_TOO_SMALL", {fileIndex: model.fileIndex, seq: file.seq, expected: fixedChunkSize, given: model.data.length, fileSize: file.size});
                }
            }
            return {requestRepository, oldReq, file};
        };
        const {file} = await verify();
        if (file.seq === 0) {
            await this.storageService.getStorageService(file.supportsRandomWrite ? "randomWrite" : "regular").create(file.id);
        }
        await this.storageService.getStorageService(file.supportsRandomWrite ? "randomWrite" : "regular").append(file.id, model.data, file.seq);
        return this.repositoryFactory.withTransaction(async session => {
            const {requestRepository, oldReq} = await verify(session);
            const newReq = await requestRepository.addChunk(oldReq, model.fileIndex, model.data.length);
            return newReq;
        });
    }
    
    async commitFile(user: types.core.Username, model: requestApi.CommitFileModel) {
        const verify = async (session?: mongodb.ClientSession) => {
            const requestRepository = this.repositoryFactory.createRequestRepository(session);
            const oldReq = await requestRepository.getWithAccessCheck(user, model.requestId);
            if (model.fileIndex >= oldReq.files.length) {
                throw new AppException("REQUEST_FILE_DOES_NOT_EXIST", {files: oldReq.files.length, givenIndex: model.fileIndex});
            }
            const file = oldReq.files[model.fileIndex];
            if (file.closed) {
                throw new AppException("REQUEST_FILE_ALREADY_CLOSED", {fileIndex: model.fileIndex});
            }
            if (model.checksum.length > file.checksumSize) {
                throw new AppException("REQUEST_FILE_SIZE_EXCEEDED", {fileIndex: model.fileIndex, checksumSize: file.checksumSize, sent: model.checksum.length});
            }
            if (file.seq !== model.seq) {
                throw new AppException("REQUEST_FILE_DESYNCHRONIZED", {fileIndex: model.fileIndex, seq: file.seq, given: model.seq});
            }
            return {requestRepository, oldReq, file};
        };
        const {file} = await verify();
        if (file.seq === 0) {
            await this.storageService.getStorageService(file.supportsRandomWrite ? "randomWrite" : "regular").create(file.id);
        }
        await this.storageService.getStorageService(file.supportsRandomWrite ? "randomWrite" : "regular").setChecksumAndClose(file.id, model.checksum, file.seq);
        return this.repositoryFactory.withTransaction(async session => {
            const {requestRepository, oldReq} = await verify(session);
            const newReq = await requestRepository.commitFile(oldReq, model.fileIndex, model.checksum.length);
            return newReq;
        });
    }
    
    async markRequestAsProcessing(requestId: types.request.RequestId) {
        return this.repositoryFactory.withTransaction(async session => {
            const requestRepository = this.repositoryFactory.createRequestRepository(session);
            const newReq = await requestRepository.markRequestAsProcessing(requestId);
            return newReq;
        });
    }
    
    createRequestX(request: db.request.Request) {
        if (!request) {
            return null;
        }
        const res: RequestX = {
            request,
            moved: [],
        };
        return res;
    }
    
    async finishRequest(repo: ObjectRepository<types.request.RequestId, db.request.Request>, request: RequestX) {
        await repo.delete(request.request.id);
        for (const file of request.request.files) {
            if (!request.moved.includes(file.id)) {
                await this.storageService.getStorageService(file.supportsRandomWrite ? "randomWrite" : "regular").reject(file.id, file.seq);
            }
        }
    }
    
    async clearExpired() {
        const expiredRequests = await this.repositoryFactory.withTransaction(async session => {
            const requestRepository = this.repositoryFactory.createRequestRepository(session);
            return requestRepository.clearExpired(this.configService.values.request.maxInactiveTime);
        });
        for (const request of expiredRequests) {
            for (const file of request.files) {
                await this.storageService.getStorageService(file.supportsRandomWrite ? "randomWrite" : "regular").reject(file.id, file.seq);
            }
        }
    }
}
