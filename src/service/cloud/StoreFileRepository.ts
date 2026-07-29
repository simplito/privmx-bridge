/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as types from "../../types";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";

export class StoreFileRepository {
    
    static readonly COLLECTION_NAME = "storeFile";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.store.StoreFileId, db.store.StoreFile>,
    ) {
    }
    
    async get(id: types.store.StoreFileId) {
        return this.repository.get(id);
    }
    
    async getMany(ids: types.store.StoreFileId[]) {
        return this.repository.getMulti(ids);
    }
    
    async getFilesOlderThan(id: types.store.StoreId, timestamp: types.core.Timestamp) {
        return this.repository.findAll(q => q.and(
            q.lt("createDate", timestamp),
            q.eq("storeId", id),
        ));
    }
    
    async getPageByStore(storeId: types.store.StoreId, listParams: types.core.ListModel, sortBy: keyof db.store.StoreFile) {
        return this.repository.matchWithUpdates({storeId: storeId}, listParams, sortBy, "meta");
    }
    
    async getPageByStoreAndUser(storeId: types.store.StoreId, userId: types.cloud.UserId, listParams: types.core.ListModel, sortBy: keyof db.store.StoreFile) {
        const match: Record<string, unknown> = {
            $and: [
                {
                    storeId: storeId,
                },
                {
                    author: userId,
                },
            ],
        };
        return this.repository.matchWithUpdates(match, listParams, sortBy, "meta");
    }
    
    async getPageByStore2(storeId: types.store.StoreId, listParams: types.core.ListModel2<types.store.StoreFileId>) {
        return this.repository.matchX2({storeId: storeId}, listParams);
    }
    
    async deleteFile(id: types.store.StoreFileId) {
        await this.repository.delete(id);
    }
    
    async deleteManyFiles(ids: types.store.StoreFileId[]) {
        await this.repository.deleteMany(q => q.in("id", ids));
    }
    
    async create(storeId: types.store.StoreId, resourceId: types.core.ClientResourceId|null, author: types.cloud.UserId, meta: types.store.StoreFileMeta, keyId: types.core.KeyId, file: db.request.FileDefinition, thumb: db.request.FileDefinition|undefined) {
        const nFile: db.store.StoreFile = {
            id: this.repository.generateId(),
            storeId: storeId,
            author: author,
            createDate: DateUtils.now(),
            meta: meta,
            keyId: keyId,
            fileId: file.id,
            size: file.sent as types.core.SizeInBytes,
            checksumSize: file.checksumSent as types.core.SizeInBytes,
            thumb: thumb ? {
                fileId: thumb.id,
                checksumSize: thumb.checksumSize as types.core.SizeInBytes,
                size: thumb.sent as types.core.SizeInBytes,
                supportsRandomWrite: thumb.supportsRandomWrite,
            } : undefined,
            supportsRandomWrite: file.supportsRandomWrite,
        };
        if (resourceId) {
            nFile.clientResourceId = resourceId;
        }
        await this.repository.insert(nFile);
        return nFile;
    }
    
    async update(oldFile: db.store.StoreFile, modifier: types.cloud.UserId, meta: types.store.StoreFileMeta, keyId: types.core.KeyId, file: db.request.FileDefinition, thumb: db.request.FileDefinition|undefined) {
        const updates = oldFile.updates || [];
        updates.push({
            createDate: DateUtils.now(),
            author: modifier,
        });
        const nFile: db.store.StoreFile = {
            ...oldFile,
            meta: meta,
            keyId: keyId,
            fileId: file.id,
            size: file.sent as types.core.SizeInBytes,
            checksumSize: file.checksumSent as types.core.SizeInBytes,
            thumb: thumb ? {
                fileId: thumb.id,
                checksumSize: thumb.checksumSize as types.core.SizeInBytes,
                size: thumb.sent as types.core.SizeInBytes,
                supportsRandomWrite: thumb.supportsRandomWrite,
            } : undefined,
            updates: updates,
            supportsRandomWrite: file.supportsRandomWrite,
        };
        await this.repository.update(nFile);
        return nFile;
    }
    
    async updateMeta(oldFile: db.store.StoreFile, modifier: types.cloud.UserId, meta: types.store.StoreFileMeta, keyId: types.core.KeyId, resourceId: types.core.ClientResourceId|null) {
        const updates = oldFile.updates || [];
        updates.push({
            createDate: DateUtils.now(),
            author: modifier,
        });
        const nFile: db.store.StoreFile = {
            ...oldFile,
            meta: meta,
            keyId: keyId,
            updates: updates,
        };
        if (resourceId && !oldFile.clientResourceId) {
            nFile.clientResourceId = resourceId;
        }
        else if (oldFile.clientResourceId) {
            nFile.clientResourceId = oldFile.clientResourceId;
        }
        await this.repository.update(nFile);
        return nFile;
    }
    
    async updateMetaWithSize(oldFile: db.store.StoreFile, modifier: types.cloud.UserId, meta: types.store.StoreFileMeta, keyId: types.core.KeyId, size: {
        newFileSize?: number,
        newChecksumSize?: number;
    }) {
        const updates = oldFile.updates || [];
        updates.push({
            createDate: DateUtils.now(),
            author: modifier,
        });
        const nFile: db.store.StoreFile = {
            ...oldFile,
            meta: meta,
            keyId: keyId,
            size: size.newFileSize as types.core.SizeInBytes,
            checksumSize: size.newChecksumSize as types.core.SizeInBytes,
            updates: updates,
        };
        await this.repository.update(nFile);
        return nFile;
    }
    
    async deleteAllFromStore(storeId: types.store.StoreId) {
        const files = await this.repository.findAll(q => q.eq("storeId", storeId));
        await this.repository.deleteMany(q => q.eq("storeId", storeId));
        return files;
    }
    
    async deleteAllFromStores(storeIds: types.store.StoreId[]) {
        const files = await this.repository.findAll(q => q.in("storeId", storeIds));
        await this.repository.deleteMany(q => q.in("storeId", storeIds));
        return files;
    }
}
