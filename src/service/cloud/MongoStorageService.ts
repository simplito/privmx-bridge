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
import { ChunkRepository } from "./ChunkRepository";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { FileId, IStorageService, RandomWriteStorageContext, TmpFileId } from "../misc/StorageService";
import { DbInconsistencyError } from "../../error/DbInconsistencyError";
import type * as mongodb from "mongodb";

export type ChunkCache = Map<db.MongoFileStorage.ChunkId, ChunkModel>;
export interface ChunkModel {
    chunkId: db.MongoFileStorage.ChunkId,
    fileId: types.request.FileId,
    chunkIndex: number,
    buf: Buffer,
}

export interface MongoRandomWriteStorageContext extends RandomWriteStorageContext {
    chunksToUpsert: ChunkModel[];
    chunksToDelete: db.MongoFileStorage.ChunkId[];
    fileMetaData: db.MongoFileStorage.FileMetaData;
}
export class MongoStorageService implements IStorageService {
    
    static readonly MAX_CHUNK_SIZE = 255 * 1024;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    async read(id: types.request.FileId, range: types.store.BufferReadRange): Promise<Buffer> {
        const fileMetaData = await this.getCommitedFile(id);
        
        const chunkIds = (() => {
            if (range.type === "all") {
                return this.getFileChunksIds(fileMetaData);
            }
            if (range.type === "slice") {
                return this.getFileChunksIdsInRange(fileMetaData, range.from, range.to);
            }
            if (range.type === "checksum") {
                return this.getChecksumFileChunksIds(fileMetaData);
            }
            throw new Error("UNSUPPORTED_RANGE_TYPE");
        })();
        
        const chunks = await this.repositoryFactory.createChunkRepository().getMany(chunkIds);
        const sortedChunks = chunks.sort((a, b) => a.index - b.index);
        const totalBuffer = Buffer.concat(sortedChunks.map(chunk => chunk.binary.buffer));
        
        if (range.type === "slice") {
            const leftOffset = (sortedChunks[0].index - 1) * MongoStorageService.MAX_CHUNK_SIZE;
            return totalBuffer.subarray(range.from - leftOffset, range.to - leftOffset);
        }
        
        return totalBuffer;
    }
    
    async copy(src: types.request.FileId, dst: types.request.FileId): Promise<void> {
        const fileMetaData = await this.getCommitedFile(src);
        
        const chunkIds = this.getFileChunksIds(fileMetaData);
        const chunks = await this.repositoryFactory.createChunkRepository().getMany(chunkIds);
        const dstFileChunks = chunks.map(chunk => ({
            chunkIndex: chunk.index,
            buf: Buffer.from(chunk.binary.buffer),
        }));
        await this.repositoryFactory.createChunkRepository().createManyChunks(dst, dstFileChunks);
        const checksumChunkIds = this.getChecksumFileChunksIds(fileMetaData);
        const checksumChunks = await this.repositoryFactory.createChunkRepository().getMany(checksumChunkIds);
        const dstChecksumChunks = checksumChunks.map(chunk => ({
            chunkIndex: chunk.index,
            buf: Buffer.from(chunk.binary.buffer),
        }));
        await this.repositoryFactory.createChunkRepository().createManyChunks(`${dst}-checksum` as types.request.FileId, dstChecksumChunks);
        await this.repositoryFactory.createFileMetaDataRepository().createCopy(fileMetaData, dst);
    }
    
    async delete(id: types.request.FileId): Promise<void> {
        await this.getCommitedFile(id);
        await this.repositoryFactory.createChunkRepository().deleteByFileMetaDataId(id);
        await this.repositoryFactory.createFileMetaDataRepository().delete(id);
    }
    
    async create(id: TmpFileId): Promise<void> {
        await this.repositoryFactory.createFileMetaDataRepository().createNewFile(id, 1);
        await this.repositoryFactory.createChunkRepository().createChunk(id, 1, Buffer.alloc(0));
    }
    
    async append(id: TmpFileId, buffer: Buffer, seq: number): Promise<void> {
        const fileMetaData = await this.getTemporaryFile(id);
        
        if (fileMetaData.seq !== seq) {
            throw new Error("INVALID_SEQ");
        }
        
        const fileMetaDataToUpdate = {
            chunks: fileMetaData.chunks,
            lastChunkSize: fileMetaData.lastChunkSize,
            seq: fileMetaData.seq + 1,
        };
        const lastChunkSpaceOffset = Math.min(MongoStorageService.MAX_CHUNK_SIZE - fileMetaData.lastChunkSize, buffer.length);
        if (lastChunkSpaceOffset !== 0) {
            await this.appendBufferToChunk(fileMetaData._id, fileMetaData.chunks, buffer.subarray(0, lastChunkSpaceOffset));
            fileMetaDataToUpdate.lastChunkSize = fileMetaData.lastChunkSize + lastChunkSpaceOffset;
        }
        const numOfChunks = Math.ceil((buffer.length - lastChunkSpaceOffset) / MongoStorageService.MAX_CHUNK_SIZE);
        const chunks = this.prepareChunksFromBuffer(buffer, numOfChunks, lastChunkSpaceOffset, fileMetaData.chunks);
        fileMetaDataToUpdate.chunks += numOfChunks;
        if (chunks.length !== 0) {
            fileMetaDataToUpdate.lastChunkSize = chunks[chunks.length - 1].buf.length;
            await this.repositoryFactory.createChunkRepository().createManyChunks(fileMetaData._id, chunks);
        }
        await this.repositoryFactory.createFileMetaDataRepository().update({
            ...fileMetaData,
            ...fileMetaDataToUpdate,
        });
    }
    
    async setChecksumAndClose(id: TmpFileId, checksum: Buffer, seqs: number): Promise<void> {
        const fileMetaData = await this.getTemporaryFile(id);
        
        if (fileMetaData.seq !== seqs) {
            throw new Error("INVALID_SEQ");
        }
        
        const checksumId = `${fileMetaData._id}-checksum` as types.request.FileId;
        const numOfChunks = Math.ceil(checksum.length / MongoStorageService.MAX_CHUNK_SIZE);
        const chunks = this.prepareChunksFromBuffer(checksum, numOfChunks, 0, 0);
        
        if (chunks.length === 0) {
            await this.repositoryFactory.createChunkRepository().createChunk(checksumId, 0, Buffer.alloc(0));
        }
        else {
            await this.repositoryFactory.createChunkRepository().createManyChunks(checksumId, chunks);
        }
        await this.repositoryFactory.createFileMetaDataRepository().update({
            ...fileMetaData,
            checksumSize: checksum.byteLength,
            checksumChunks: chunks.length || 1,
        });
    }
    
    async commit(id: TmpFileId): Promise<void> {
        const fileMetaData = await this.getTemporaryFile(id);
        
        await this.repositoryFactory.createFileMetaDataRepository().update({...fileMetaData, isTemporary: false});
    }
    
    async reject(id: TmpFileId, seqs: number): Promise<void> {
        const fileMetaData = await this.getTemporaryFile(id);
        
        if (fileMetaData.seq !== seqs) {
            throw new Error("INVALID_SEQ");
        }
        
        await this.repositoryFactory.createChunkRepository().deleteByFileMetaDataId(id);
        await this.repositoryFactory.createFileMetaDataRepository().delete(id);
    }
    
    async list(): Promise<types.request.FileId[]> {
        const filesMeta = await this.repositoryFactory.createFileMetaDataRepository().getAll();
        return filesMeta.map(fileMeta => fileMeta._id as unknown as types.request.FileId);
    }
    
    async clearStorage() {
        await this.repositoryFactory.createChunkRepository().deleteAll();
        await this.repositoryFactory.createFileMetaDataRepository().deleteAll();
    }
    
    async switchToFreshStorage() {
        throw new Error("Opperation not supported");
    }
    
    async randomWritePrepare(fileId: FileId, operations: types.store.StoreFileRandomWriteOperation[]): Promise<RandomWriteStorageContext> {
        const fileMetaData = await this.getCommitedFile(fileId);
        const cachedChunks = new Map<db.MongoFileStorage.ChunkId, ChunkModel>();
        const chunksToDelete = new Set<db.MongoFileStorage.ChunkId>();
        for (const operation of operations) {
            const {fId, chunksIds, position, firstChunkLeftOffset, firstChunkPartSize} = this.prepareOperationContext(fileMetaData, operation, fileId);
            if (chunksIds.length === 0) {
                throw new Error(`Invalid chunkIds ${fId}`);
            }
            const [firstChunkId, lastChunkId] = [chunksIds[0], chunksIds[chunksIds.length - 1]];
            const result = await this.getChunksViaCache([firstChunkId, lastChunkId], cachedChunks, chunksToDelete);
            if (result.length === 0 || result.length > 2) {
                throw new DbInconsistencyError(`Cannot find ${fId} chunks described by fileMetaData or received too many chunks (expected: 1 or 2, got: ${result.length})`);
            }
            const {lastChunkModel, chunksToUpdate} = (() => {
                if (result.length === 2 && firstChunkId !== lastChunkId) {
                    const endPos = position + operation.data.length;
                    const lastChunkRightOffset = MongoStorageService.MAX_CHUNK_SIZE - (endPos % MongoStorageService.MAX_CHUNK_SIZE);
                    const lastChunkPartSize = MongoStorageService.MAX_CHUNK_SIZE - lastChunkRightOffset;
                    const [firstChunk, lastChunk] = [...result.sort((a, b) => a.chunkIndex - b.chunkIndex)];
                    return this.prepareChunksToUpdateFromFirstAndLastChunk(firstChunk, lastChunk, operation.data, firstChunkPartSize, firstChunkLeftOffset, lastChunkPartSize, operation.truncate, fId);
                }
                else {
                    return this.prepareChunksToUpdateFromStartingChunk(result[0], operation.data, firstChunkPartSize, firstChunkLeftOffset, operation.truncate, fId);
                }
            })();
            for (const chunk of chunksToUpdate) {
                const chunkId = ChunkRepository.getChunkId(fId, chunk.chunkIndex);
                cachedChunks.set(chunkId, chunk);
                chunksToDelete.delete(chunkId);
            }
            this.prepareUpdatedFileMetaData(fileMetaData, operation.type, lastChunkModel.chunkIndex, lastChunkModel.buf.length, operation.truncate);
            const localChunkToDelete = operation.type === "file" && operation.truncate ?
                this.getChunksIdsToDelete(fileId, fileMetaData.chunks, lastChunkModel.chunkIndex, "file") :
                this.getChunksIdsToDelete(fileId, fileMetaData.checksumChunks, lastChunkModel.chunkIndex, "checksum");
            
            localChunkToDelete.forEach(chunk => chunksToDelete.add(chunk));
        }
        const randomWriteCtx: MongoRandomWriteStorageContext = {
            fileMetaData,
            chunksToUpsert: Array.from(cachedChunks.values()),
            chunksToDelete: [...chunksToDelete],
        };
        return randomWriteCtx;
    }
    
    async randomWriteCommit(randomWriteCtx: MongoRandomWriteStorageContext, session: mongodb.ClientSession): Promise<{ newFileSize: number; newChecksumSize: number; }> {
        await this.repositoryFactory.createFileMetaDataRepository(session).update(randomWriteCtx.fileMetaData);
        await this.repositoryFactory.createChunkRepository(session).upsertManyChunks(randomWriteCtx.chunksToUpsert, session);
        if (randomWriteCtx.chunksToDelete.length !== 0) {
            await this.repositoryFactory.createChunkRepository(session).deleteMany(randomWriteCtx.chunksToDelete);
        }
        return { newFileSize: randomWriteCtx.fileMetaData.chunks * MongoStorageService.MAX_CHUNK_SIZE, newChecksumSize: randomWriteCtx.fileMetaData.checksumSize};
    }
    
    private async getChunksViaCache(chunkIds: db.MongoFileStorage.ChunkId[], cache: ChunkCache, deletedCache: Set<db.MongoFileStorage.ChunkId>) {
        const results: ChunkModel[] = [];
        for (const chunkId of chunkIds) {
            if (deletedCache.has(chunkId)) {
                continue;
            }
            const entry = cache.get(chunkId);
            if (!entry) {
                const chunk = await this.repositoryFactory.createChunkRepository().getByChunkId(chunkId);
                if (!chunk) {
                    continue;
                }
                const chunkModel: ChunkModel = {
                    chunkIndex: chunk.index,
                    buf: chunk.binary.buffer as Buffer,
                    fileId: chunk.fileMetaData,
                    chunkId,
                };
                results.push(chunkModel);
            }
            else {
                results.push(entry);
            }
        }
        return results;
    }
    
    private getChunksIdsToDelete(fileId: types.request.FileId, oldChunksCount: number, newChunksCount: number, type: "checksum"|"file") {
        const chunksToDelete = [];
        if (oldChunksCount > newChunksCount) {
            for (let fileIndex = newChunksCount; fileIndex <= oldChunksCount; fileIndex++ ) {
                chunksToDelete.push(type === "file" ? ChunkRepository.getChunkId(fileId, fileIndex) : ChunkRepository.getChecksumChunkId(fileId, fileIndex));
            }
        }
        return chunksToDelete;
    }
    
    private prepareChunksToUpdateFromStartingChunk(firstChunkModel: ChunkModel, data: Buffer, firstChunkPartSize: number, firstChunkLeftOffset: number, truncate: boolean, fileId: types.request.FileId) {
        firstChunkModel.buf = this.updateBuffer(firstChunkModel.buf, data.subarray(0, firstChunkPartSize), firstChunkLeftOffset, (firstChunkPartSize !== MongoStorageService.MAX_CHUNK_SIZE && truncate));
        const middleChunks = this.prepareChunksFromBufferWithOffset(data, firstChunkPartSize, 0, firstChunkModel.chunkIndex, fileId);
        const chunksToUpdate = [firstChunkModel, ...middleChunks];
        const lastChunkModel = chunksToUpdate[chunksToUpdate.length - 1];
        return {chunksToUpdate, lastChunkModel};
    }
    
    private prepareChunksToUpdateFromFirstAndLastChunk(firstChunkModel: ChunkModel, lastChunkModel: ChunkModel, data: Buffer, firstChunkPartSize: number, firstChunkLeftOffset: number, lastChunkPartSize: number, truncate: boolean, fileId: types.request.FileId) {
        firstChunkModel.buf = this.updateBuffer(firstChunkModel.buf, data.subarray(0, firstChunkPartSize), firstChunkLeftOffset, false);
        lastChunkModel.buf = this.updateBuffer(lastChunkModel.buf, data.subarray(data.length - lastChunkPartSize, data.length), 0, truncate);
        const middleChunks = this.prepareChunksFromBufferWithOffset(data, firstChunkPartSize, lastChunkPartSize, firstChunkModel.chunkIndex, fileId);
        const chunksToUpdate = [firstChunkModel, ...middleChunks, lastChunkModel];
        return {chunksToUpdate, lastChunkModel};
    }
    
    private async appendBufferToChunk(fileId: types.request.FileId, chunkIndex: number, buffer: Buffer) {
        const lastChunk = await this.repositoryFactory.createChunkRepository().get(fileId, chunkIndex);
        if (!lastChunk) {
            throw new Error("Inconsistent db");
        }
        const newBuffer = Buffer.concat([lastChunk.binary.buffer, buffer]);
        await this.repositoryFactory.createChunkRepository().update(fileId, chunkIndex, newBuffer);
    }
    
    private prepareChunksFromBuffer(buffer: Buffer, numberOfChunks: number, startOffset: number, lastChunkIndex: number) {
        const chunks: {
            chunkIndex: number,
            buf: Buffer,
        }[] = [];
        
        const bufferLength = buffer.length;
        
        for (let chunkIndex = 0; chunkIndex < numberOfChunks; chunkIndex++) {
            const chunkStart = startOffset + chunkIndex * MongoStorageService.MAX_CHUNK_SIZE;
            if (chunkStart >= bufferLength) {
                break;
            }
            const chunkEnd = Math.min(chunkStart + MongoStorageService.MAX_CHUNK_SIZE, bufferLength);
            const buf = buffer.subarray(chunkStart, chunkEnd);
            chunks.push({chunkIndex: chunkIndex + lastChunkIndex + 1, buf});
        }
        
        return chunks;
    }
    
    private getFileChunksIds(fileMetaData: db.MongoFileStorage.FileMetaData) {
        const ids: db.MongoFileStorage.ChunkId[] = [];
        for (let index = 1; index <= fileMetaData.chunks; index++) {
            ids.push(ChunkRepository.getChunkId(fileMetaData._id, index));
        }
        return ids;
    }
    
    private getFileChunksIdsInRange(fileMetaData:db.MongoFileStorage.FileMetaData, from: number, to: number) {
        const chunkIds: db.MongoFileStorage.ChunkId[] = [];
        const startChunkIndex = Math.floor((from / MongoStorageService.MAX_CHUNK_SIZE)) + 1;
        const endChunkIndex = Math.ceil(to / MongoStorageService.MAX_CHUNK_SIZE);
        for (let index = startChunkIndex; index <= endChunkIndex; index++) {
            chunkIds.push(ChunkRepository.getChunkId(fileMetaData._id, index));
        }
        return chunkIds;
    }
    
    private getChecksumFileChunksIds(fileMetaData: db.MongoFileStorage.FileMetaData) {
        const ids: db.MongoFileStorage.ChunkId[] = [];
        for (let index = 1; index <= fileMetaData.checksumChunks; index++) {
            ids.push(ChunkRepository.getChecksumChunkId(fileMetaData._id, index));
        }
        return ids;
    }
    
    private getChecksumFileChunksIdsInRange(fileMetaData:db.MongoFileStorage.FileMetaData, from: number, to: number) {
        const chunkIds: db.MongoFileStorage.ChunkId[] = [];
        const startChunkIndex = Math.floor((from / MongoStorageService.MAX_CHUNK_SIZE)) + 1;
        const endChunkIndex = Math.ceil(to / MongoStorageService.MAX_CHUNK_SIZE);
        for (let index = startChunkIndex; index <= endChunkIndex; index++) {
            chunkIds.push(ChunkRepository.getChecksumChunkId(fileMetaData._id, index));
        }
        return chunkIds;
    }
    
    private async getCommitedFile(id: types.request.FileId, session?: mongodb.ClientSession) {
        const fileMetaData = await this.repositoryFactory.createFileMetaDataRepository(session).getCommitedFile(id);
        if (!fileMetaData) {
            throw new Error("FILE_DOES_NOT_EXIST");
        }
        return fileMetaData;
    }
    
    private async getTemporaryFile(id: types.request.FileId) {
        const fileMetaData = await this.repositoryFactory.createFileMetaDataRepository().getTemporaryFile(id);
        if (!fileMetaData) {
            throw new Error("FILE_DOES_NOT_EXIST");
        }
        return fileMetaData;
    }
    
    private updateBuffer(buffer: Buffer, data: Buffer, pos: number, truncate: boolean): Buffer {
        const end = pos + data.length;
        if (end > buffer.length) {
            const newBuffer = Buffer.alloc(end);
            newBuffer.set(buffer, 0);
            newBuffer.set(data, pos);
            return newBuffer;
        }
        else if (truncate) {
            const newBuffer = Buffer.alloc(end);
            newBuffer.set(buffer.subarray(0, pos), 0);
            newBuffer.set(data, pos);
            return newBuffer;
        }
        else {
            buffer.set(data, pos);
            return buffer;
        }
    }
    
    private prepareChunksFromBufferWithOffset(data: Buffer, leftOffset: number, rightOffset: number, fromIndex: number, fileId: types.request.FileId) {
        const middleBuffer = data.subarray(leftOffset, data.length - rightOffset);
        const middleBufferChunksNumber = middleBuffer.length / MongoStorageService.MAX_CHUNK_SIZE;
        const chunks = this.prepareChunksFromBuffer(middleBuffer, middleBufferChunksNumber, 0, fromIndex);
        return chunks.map(chunk => {
            const chunkModel: ChunkModel = {
                chunkId: ChunkRepository.getChunkId(fileId, chunk.chunkIndex),
                chunkIndex: chunk.chunkIndex,
                buf: chunk.buf,
                fileId: fileId,
            };
            return chunkModel;
        });
    }
    
    private prepareUpdatedFileMetaData(fileMetaData: db.MongoFileStorage.FileMetaData, type: "checksum"|"file", lastModifiedChunkIndex: number, lastModifiedChunkSize: number, truncate: boolean) {
        if (type === "checksum") {
            fileMetaData.checksumChunks = truncate ? Math.min(lastModifiedChunkIndex, fileMetaData.checksumChunks) : Math.max(lastModifiedChunkIndex, fileMetaData.checksumChunks);
            if (!truncate && lastModifiedChunkIndex < fileMetaData.checksumChunks) {
                return;
            }
            fileMetaData.checksumSize = (fileMetaData.checksumChunks - 1) * MongoStorageService.MAX_CHUNK_SIZE + lastModifiedChunkSize;
        }
        else {
            fileMetaData.chunks = truncate ? Math.min(lastModifiedChunkIndex, fileMetaData.chunks) : Math.max(lastModifiedChunkIndex, fileMetaData.chunks);
            if (!truncate && lastModifiedChunkIndex < fileMetaData.checksumChunks) {
                return;
            }
            fileMetaData.lastChunkSize = lastModifiedChunkSize;
        }
    }
    
    private prepareOperationContext(fileMetaData: db.MongoFileStorage.FileMetaData, operation: types.store.StoreFileRandomWriteOperation, fileId: types.request.FileId) {
        const checksumId = `${fileMetaData._id}-checksum` as types.request.FileId;
        const fId = operation.type === "file" ? fileId : checksumId;
        const fSize = operation.type === "file" ? (fileMetaData.chunks - 1) * MongoStorageService.MAX_CHUNK_SIZE + fileMetaData.lastChunkSize : fileMetaData.checksumSize ;
        const position = operation.pos === -1 || operation.pos > fSize ? fSize : operation.pos;
        const chunksIds =  operation.type === "file" ? this.getFileChunksIdsInRange(fileMetaData, position, position + operation.data.length) : this.getChecksumFileChunksIdsInRange(fileMetaData, position, position + operation.data.length);
        const firstChunkLeftOffset = position % MongoStorageService.MAX_CHUNK_SIZE;
        const firstChunkPartSize = MongoStorageService.MAX_CHUNK_SIZE - firstChunkLeftOffset;
        return {fId, fSize, chunksIds, position, firstChunkLeftOffset, firstChunkPartSize};
    }
}
