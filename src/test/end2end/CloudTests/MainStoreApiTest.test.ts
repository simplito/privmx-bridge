/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode2, Test } from "../BaseTestSet";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";
import * as assert from "assert";

export class MainStoreApiTests extends BaseTestSet {
    
    private fileId?: types.store.StoreFileId;
    private storeId?: types.store.StoreId;
    private resourceId?: types.core.ClientResourceId;
    
    @Test({
        config: {
            db: {
                storageProviderName: "fs",
            },
        },
    })
    async fileCreateAndRetrieveTestFS() {
        await this.createNewStore();
        await this.createNewFile();
        await this.getFileAndCheck();
    }
    
    @Test({
        config: {
            db: {
                storageProviderName: "mongo",
            },
        },
    })
    async fileCreateAndRetrieveTestMongo() {
        await this.createNewStore();
        await this.createNewFile();
        await this.getFileAndCheck();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "fs",
            },
        },
    })
    async randomWriteTestFS() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOnFile();
        await this.validateFileContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteTestMongo() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOnFile();
        await this.validateFileContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteTestMongoWithManyChunks() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeOnFileWithManyChunks();
        await this.validateFileWithManyChunksContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteTestMongoWithManyChunks2() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeOnFileWithManyChunks2();
        await this.validateFileWithManyChunksContent2();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteAppendTestMongoWithManyChunks() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeOnFileWithAppendWithManyChunks();
        await this.validateAppendedFileWithManyChunksContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteAppendTestMongoWithManyChunksChecksum() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunksChecksum();
        await this.writeOnFileWithAppendWithManyChunksChecksum();
        await this.validateAppendedFileWithManyChunksChecksumContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "fs",
            },
        },
    })
    async truncateTestFs() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOnFileWithTruncate();
        await this.validateTruncatedFileContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async truncateTestMongoWithManyChunks() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeOnFileWithManyChunksWithTruncate();
        await this.validateTruncatedFileWithManyChunksContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async truncateTestMongo() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOnFileWithTruncate();
        await this.validateTruncatedFileContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "fs",
            },
        },
    })
    async randomWriteAppendTestFs() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOnFileWithAppend();
        await this.validateAppendedFileContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteAppendTestMongo() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOnFileWithAppend();
        await this.validateAppendedFileContent();
    }
    
    @Test()
    async shouldUpdateTwoStoresWithoutResourceIdAndThenMigrateThem() {
        await this.createNewStoreWithoutResourceId();
        await this.updateNewStoreWithoutResourceId();
        await this.updateExistingStoreWithoutResourceId();
        await this.addResourceIdToExistingStore();
        await this.tryAddDuplicatedResourceIdWithUpdateAndFail();
        await this.addResourceIdToNewStore();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteMultipleOperationsTestMongo() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.performMultipleRandomWriteOperationsOnFile();
        await this.validateFileContentAfterMutipleRandomWriteOperations();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "fs",
            },
        },
    })
    async randomWriteMultipleOperationsTestFS() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.performMultipleRandomWriteOperationsOnFile();
        await this.validateFileContentAfterMutipleRandomWriteOperations();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteMultipleOperationsTestMongo2() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.performMultipleRandomWriteOperationsOnFile2();
        await this.performMultipleRandomWriteOperationsOnFile2();
        await this.validateFileContentAfterMutipleRandomWriteOperations2();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "fs",
            },
        },
    })
    async randomWriteMultipleOperationsTestFS2() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.performMultipleRandomWriteOperationsOnFile2();
        await this.validateFileContentAfterMutipleRandomWriteOperations2();
    }
    
    private async createNewStore() {
        const newStore = await this.apis.storeApi.storeCreate({
            contextId: testData.contextId,
            resourceId: this.helpers.generateResourceId(),
            data: "",
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        
        this.storeId = newStore.storeId;
    }
    
    private async createNewStoreWithoutResourceId() {
        const newStore = await this.apis.storeApi.storeCreate({
            contextId: testData.contextId,
            data: "",
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        
        this.storeId = newStore.storeId;
    }
    
    private async updateNewStoreWithoutResourceId() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        const res = await this.apis.storeApi.storeUpdate({
            id: this.storeId,
            data: "",
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.store.StoreVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async updateExistingStoreWithoutResourceId() {
        const res = await this.apis.storeApi.storeUpdate({
            id: testData.storeId,
            data: "",
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.store.StoreVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async addResourceIdToExistingStore() {
        this.resourceId = this.helpers.generateResourceId();
        const res = await this.apis.storeApi.storeUpdate({
            id: testData.storeId,
            resourceId: this.resourceId,
            data: "",
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.store.StoreVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async addResourceIdToNewStore() {
        if (!this.storeId) {
            throw new Error("threadId not set or initialized yet");
        }
        const res = await this.apis.storeApi.storeUpdate({
            id: this.storeId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.store.StoreVersion,
            force: true,
        });
        assert(res === "OK", "Invalid response");
    }
    
    private async tryAddDuplicatedResourceIdWithUpdateAndFail() {
        if (!this.storeId || !this.resourceId) {
            throw new Error("threadId or resourceId not set or initialized yet");
        }
        const storeId = this.storeId;
        const resourceId = this.resourceId;
        await shouldThrowErrorWithCode2(() => this.apis.storeApi.storeUpdate({
            id: storeId,
            resourceId: resourceId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 0 as types.store.StoreVersion,
            force: true,
        }), "DUPLICATE_RESOURCE_ID");
    }
    
    private async createNewRandomModeFile() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        
        const request = await this.apis.requestApi.createRequest({files: [{size: 512, checksumSize: 64, randomWrite: true}]});
        
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(512, "A")});
        await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 1, checksum: Buffer.alloc(64)});
        
        const newFile = await this.apis.storeApi.storeFileCreate({
            storeId: this.storeId,
            resourceId: this.helpers.generateResourceId(),
            requestId: request.id,
            fileIndex: 0,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
        });
        
        this.fileId = newFile.fileId;
    }
    
    private async createNewRandomModeFileWithManyChunks() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        
        const request = await this.apis.requestApi.createRequest({files: [{size: 255 * 1024 * 3, checksumSize: 64, randomWrite: true}]});
        
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(255 * 1024, "A")});
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 1, data: Buffer.alloc(255 * 1024, "B")});
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 2, data: Buffer.alloc(255 * 1024, "C")});
        await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 3, checksum: Buffer.alloc(64)});
        
        const newFile = await this.apis.storeApi.storeFileCreate({
            storeId: this.storeId,
            resourceId: this.helpers.generateResourceId(),
            requestId: request.id,
            fileIndex: 0,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
        });
        this.fileId = newFile.fileId;
    }
    
    private async createNewRandomModeFileWithManyChunksChecksum() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        
        const request = await this.apis.requestApi.createRequest({files: [{size: 255 * 1024, checksumSize: 255 * 1024 * 3, randomWrite: true}]});
        
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(255 * 1024, "A")});
        await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 1, checksum: Buffer.alloc(255 * 1024 * 3, "A")});
        
        const newFile = await this.apis.storeApi.storeFileCreate({
            storeId: this.storeId,
            resourceId: this.helpers.generateResourceId(),
            requestId: request.id,
            fileIndex: 0,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
        });
        this.fileId = newFile.fileId;
    }
    
    private async createNewFile() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        
        const request = await this.apis.requestApi.createRequest({files: [{size: 512, checksumSize: 64}]});
        
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(512, "A")});
        await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 1, checksum: Buffer.alloc(64)});
        
        const newFile = await this.apis.storeApi.storeFileCreate({
            storeId: this.storeId,
            requestId: request.id,
            fileIndex: 0,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
        });
        
        this.fileId = newFile.fileId;
    }
    
    private async getFileAndCheck() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 512 && buf.toString().match(/^A*$/), "Invalid file content");
    }
    
    private async writeOnFile() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.from("BBBB"),
                    pos: 0,
                    truncate: false,
                },
                {
                    type: "checksum",
                    data: Buffer.from("CCCC"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeOnFileWithManyChunks() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(2 * 1024, "F"),
                    pos: (1024 * 255) - 1024,
                    truncate: false,
                },
                {
                    type: "checksum",
                    data: Buffer.from("CCCC"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeOnFileWithManyChunks2() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(257 * 1024, "F"),
                    pos: (1024 * 255) - 1024,
                    truncate: false,
                },
                {
                    type: "checksum",
                    data: Buffer.from("CCCC"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeOnFileWithTruncate() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.from("BBBB"),
                    pos: 4,
                    truncate: true,
                },
                {
                    type: "checksum",
                    data: Buffer.from("CCCC"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeOnFileWithManyChunksWithTruncate() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(257 * 1024, "F"),
                    pos: (1024 * 255) - 1024,
                    truncate: true,
                },
                {
                    type: "checksum",
                    data: Buffer.from("CCCC"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateTruncatedFileContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 8 && buf.toString() === "AAAABBBB", "Invalid file content");
    }
    
    private async validateFileContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 512 && buf.toString().startsWith("BBBB"), "Invalid file content");
    }
    
    private async validateFileWithManyChunksContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: (1024 * 255) - 2048, to: (1024 * 255) + 2048},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 4096 && buf.toString().startsWith("A".repeat(1024)) && buf.toString().endsWith("B".repeat(1024)) && buf.subarray(1024, 3072).toString().match(/^F*$/), "Invalid file content");
    }
    
    private async validateFileWithManyChunksContent2() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: (1024 * 255) - 2048, to: (1024 * 510) + 2048},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 259 * 1024 && buf.toString().startsWith("A".repeat(1024)) && buf.toString().endsWith("C".repeat(1024)) && buf.subarray(2048, 256 * 1024).toString().match(/^F*$/), "Invalid file content");
    }
    
    private async validateTruncatedFileWithManyChunksContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: (1024 * 255) - 2048, to: (1024 * 510) + 2048},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 258 * 1024 && buf.toString().startsWith("A".repeat(1024)) && buf.toString().endsWith("F") && buf.subarray(2048, 256 * 1024).toString().match(/^F*$/), "Invalid file content");
    }
    
    private async writeOnFileWithAppend() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.from("BBBB"),
                    pos: -1,
                    truncate: false,
                },
                {
                    type: "checksum",
                    data: Buffer.from("CCCC"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async performMultipleRandomWriteOperationsOnFile() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(16, "B"),
                    pos: -1,
                    truncate: false,
                },
                {
                    type: "file",
                    data: Buffer.alloc(4, "C"),
                    pos: 512 + 8, // Orginal size + half of appended buffer from operation above
                    truncate: true,
                },
                {
                    type: "file",
                    data: Buffer.alloc(16, "F"),
                    pos: -1,
                    truncate: false,
                },
            ],
        });
    }
    
    private async performMultipleRandomWriteOperationsOnFile2() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true, // TODO CHANGE
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(257 * 1024, "B"),
                    pos: 254 * 1024,
                    truncate: false,
                },
                {
                    type: "file",
                    data: Buffer.alloc(255, "C"),
                    pos: 256 * 1024,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeOnFileWithAppendWithManyChunks() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(511 * 1024, "F"),
                    pos: (1024 * 255 * 2) - 1024,
                    truncate: false,
                },
                {
                    type: "checksum",
                    data: Buffer.from("CCCC"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeOnFileWithAppendWithManyChunksChecksum() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: false,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.alloc(511 * 1024, "F"),
                    pos: (1024 * 255 * 2) - 1024,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateAppendedFileContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 516 && buf.toString().endsWith("BBBB"), "Invalid file content");
    }
    
    private async validateFileContentAfterMutipleRandomWriteOperations() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 540 && buf.toString().endsWith("AAAABBBBBBBBCCCCFFFFFFFFFFFFFFFF"), "Invalid file content " + buf.toString());
    }
    
    private async validateFileContentAfterMutipleRandomWriteOperations2() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: 254 * 1024, to: 511 * 1024},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 257 * 1024 && buf.toString().substring(2048, 2048 + 255).toString().match(/^C*$/) && buf.toString().startsWith("BBBB") && buf.toString().endsWith("BBBB"), "Invalid file content");
    }
    
    private async validateAppendedFileWithManyChunksContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 255 * 1024 * 4 && buf.subarray((1024 * 255 * 2) - 1024, buf.length).toString().match(/^F*$/), "Invalid file content");
    }
    
    private async validateAppendedFileWithManyChunksChecksumContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 255 * 1024 * 4 && buf.subarray((1024 * 255 * 2) - 1024, buf.length).toString().match(/^F*$/), "Invalid file content");
    }
}
