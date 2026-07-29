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
import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";

export class FileMetaDataRepository {
    
    static readonly COLLECTION_NAME = "fileMetaData";
    static readonly COLLECTION_ID_PROP = "_id";
    
    constructor(
        private repository: MongoObjectRepository<types.request.FileId, db.MongoFileStorage.FileMetaData>,
    ) {
    }
    
    async createNewFile(tmpFileId: types.request.FileId, chunks: number) {
        await this.repository.insert({
            _id: tmpFileId,
            chunks: chunks,
            lastChunkSize: 0,
            seq: 0,
            isTemporary: true,
            checksumChunks: 0,
            checksumSize: 0,
        });
    }
    
    async createCopy(fileMetaData: db.MongoFileStorage.FileMetaData, dstId: types.request.FileId) {
        await this.repository.insert({
            ...fileMetaData,
            _id: dstId,
        });
    }
    
    async getAll() {
        return this.repository.col().find({}).toArray();
    }
    
    async get(id: types.request.FileId) {
        return this.repository.col<db.MongoFileStorage.FileMetaData>().findOne({
            _id: id,
        });
    }
    
    async getTemporaryFile(id: types.request.FileId) {
        return this.repository.col<db.MongoFileStorage.FileMetaData>().findOne({
            _id: id,
            isTemporary: true,
        });
    }
    
    async getCommitedFile(id: types.request.FileId) {
        return this.repository.col<db.MongoFileStorage.FileMetaData>().findOne({
            _id: id,
            isTemporary: false,
        });
    }
    
    async update(fileMeta: db.MongoFileStorage.FileMetaData) {
        await this.repository.update(fileMeta);
    }
    
    async delete(fileMetaDataId: types.request.FileId) {
        await this.repository.delete(fileMetaDataId);
    }
    
    async deleteAll() {
        await this.repository.col().deleteMany({});
    }
}
