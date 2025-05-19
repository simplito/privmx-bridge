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
import { Binary } from "mongodb";
import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import { mongodb } from "../../CommonTypes";

export class ChunkRepository {
    
    static readonly COLLECTION_NAME = "chunk";
    static readonly COLLECTION_ID_PROP = "_id";
    
    constructor(
        private repository: MongoObjectRepository<db.MongoFileStorage.ChunkId, db.MongoFileStorage.Chunk>,
    ) {
    }
    
    async createChunk(fileId: types.request.FileId, chunkIndex: number, buf: Buffer) {
        const id = ChunkRepository.getChunkId(fileId, chunkIndex);
        await this.repository.insert({
            _id: id,
            fileMetaData: fileId,
            binary: new Binary(buf),
            index: chunkIndex,
        });
    }
    
    async createManyChunks(fileId: types.request.FileId, chunks: {chunkIndex: number, buf: Buffer}[], session?: mongodb.ClientSession) {
        const chunkDocuments: db.MongoFileStorage.Chunk[] = chunks.map(chunk => ({
            _id: ChunkRepository.getChunkId(fileId, chunk.chunkIndex),
            fileMetaData: fileId,
            binary: new Binary(chunk.buf),
            index: chunk.chunkIndex,
        }));
        await this.repository.col<db.MongoFileStorage.Chunk>().insertMany(chunkDocuments, {session});
    }
    
    async upsertManyChunks(chunks: {chunkId: db.MongoFileStorage.ChunkId, chunkIndex: number, buf: Buffer, fileId: types.request.FileId}[], session?: mongodb.ClientSession) {
        const operations = chunks.map(chunk => ({
            updateOne: {
                filter: {
                    _id: chunk.chunkId,
                },
                update: {
                    $set: {
                        fileMetaData: chunk.fileId,
                        binary: new Binary(chunk.buf),
                        index: chunk.chunkIndex,
                    },
                },
                upsert: true,
            },
        }));
        await this.repository.col<db.MongoFileStorage.Chunk>().bulkWrite(operations, {session: session});
    }
    
    async get(fileId: types.request.FileId, chunkIndex: number) {
        const id = ChunkRepository.getChunkId(fileId, chunkIndex);
        return this.repository.get(id);
    }
    
    async getByChunkId(chunkId: db.MongoFileStorage.ChunkId) {
        return this.repository.get(chunkId);
    }
    
    async getMany(chunkIds: db.MongoFileStorage.ChunkId[]) {
        return this.repository.col<db.MongoFileStorage.Chunk>().find({
            _id: {
                $in: chunkIds,
            },
        }).toArray();
    }
    
    async update(fileId: types.request.FileId, chunkIndex: number, buf: Buffer) {
        const id = ChunkRepository.getChunkId(fileId, chunkIndex);
        await this.repository.update({
            _id: id,
            binary: new Binary(buf),
            fileMetaData: fileId,
            index: chunkIndex,
        });
    }
    
    async updateChunk(chunk: db.MongoFileStorage.Chunk) {
        await this.repository.update(chunk);
    }
    
    async deleteByFileMetaDataId(fileId: types.request.FileId) {
        await this.repository.deleteMany(q => q.eq("fileMetaData", fileId));
    }
    
    async deleteMany(chunkIds: db.MongoFileStorage.ChunkId[]) {
        await this.repository.deleteMany(q => q.in("_id", chunkIds));
    }
    
    async deleteAll() {
        await this.repository.col().deleteMany({});
    }
    
    static getChunkId(fileId: types.request.FileId, chunkIndex: number) {
        return `${fileId}-${chunkIndex}` as db.MongoFileStorage.ChunkId;
    }
    
    static getChecksumChunkId(fileId: types.request.FileId, chunkIndex: number) {
        return `${fileId}-checksum-${chunkIndex}` as db.MongoFileStorage.ChunkId;
    }
}
