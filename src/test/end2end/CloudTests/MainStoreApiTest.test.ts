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
    async randomWriteTestChecksumMongo() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithLargeChecksum();
        await this.writeOnFileChecksum();
        await this.validateFileChecksum();
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
    
    @Test()
    async createFewFilesAndTestListMethods() {
        await this.createNewStore();
        await this.createNewFile();
        await this.createNewFile();
        await this.createNewFile();
        await this.createNewFile();
        await this.listFilesByCreateDateAsc();
        await this.listFilesByCreateDateDesc();
        await this.updateFile();
        await this.listFilesByUpdateDateAsc();
        await this.listFilesByUpdateDateDesc();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteTestMongoSmallFileSize() {
        await this.createNewStore();
        await this.createNewRandomModeFileSmall();
        await this.writeOnFileSmallWithTruncate();
        await this.validateSmallFileContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async truncateTestMongoAtChunkStart() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeOnFileAtStartWithTruncate();
        await this.validateTruncatedAtStartContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteTestMongoMiddleChunkPreservation() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeOnFileMiddleChunk();
        await this.validateLastChunkContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async truncateTestMongoZombieChunks() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeOnFileTruncateToSmall();
        await this.validateTruncatedToSmallContent();
        await this.writeOnFileExpandWithoutOverwritingOldTail();
        await this.validateZombieAreaIsClean();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async randomWriteTestMongoAppendToNewChunk() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOnFileToNewChunk();
        await this.validateNewChunkContent();
    }
    
    /**
     * Test massive sparse write (Gap Filling).
     * Writes way past the EOF. Expects the service to backfill ~1MB of zeros
     * and correctly place the new data at the high offset.
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async edgeCaseSparseWriteGapFilling() {
        await this.createNewStore();
        await this.createNewRandomModeFileSmall(); // 100 bytes
        await this.writeFarBeyondEOF();
        await this.validateGapFilling();
    }
    
    /**
     * Test writing a buffer that spans more than 2 chunks.
     * E.g. Write 600KB starting at offset 200KB.
     * This forces the service to handle Start Chunk + Middle Full Chunks + End Chunk.
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async edgeCaseWriteSpanningMultipleChunks() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks(); // ~765KB
        await this.writeSpanning3Chunks();
        await this.validateSpanningContent();
    }
    
    /**
     * Test Truncating exactly at a Chunk Boundary (255KB).
     * This checks for off-by-one errors in chunk deletion calculations.
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async edgeCaseTruncateToChunkBoundary() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.truncateExactlyAtBoundary();
        await this.validateBoundarySize();
    }
    
    /**
     * Test Truncating to Zero.
     * Should delete all file chunks but preserve the file metadata record.
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async edgeCaseTruncateToZero() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.truncateToZero();
        await this.validateZeroSize();
    }
    
    /**
     * Test Reading Logic Edge Cases:
     * 1. Reading partially past EOF (should be trimmed).
     * 2. Reading fully past EOF (should be empty).
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async edgeCaseReadBoundaryLogic() {
        await this.createNewStore();
        await this.createNewRandomModeFileSmall(); // 100 bytes
        await this.validateReadPastEOF();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestSandwichWrite() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeSandwichData();
        await this.validateSandwichContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestBoundaryStitching() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeBoundaryStitches();
        await this.validateBoundaryStitches();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestExactChunkReplacement() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeExactChunkReplacement();
        await this.validateExactChunkReplacement();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestOverlappingWritesInMemory() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeOverlappingOperations();
        await this.validateOverlappingContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestChecksumPartialUpdate() {
        await this.createNewStore();
        // Create a file with large checksum (3 chunks of checksum data)
        await this.createNewRandomModeFileWithManyChunksChecksum();
        await this.writeChecksumPartialUpdate();
        await this.validateChecksumPartialUpdate();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestChecksumAppendNewChunk() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunksChecksum();
        await this.writeChecksumAppendNewChunk();
        await this.validateChecksumAppendNewChunk();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestChecksumTruncation() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunksChecksum();
        await this.writeChecksumTruncate();
        await this.validateChecksumTruncate();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestMixedFileAndChecksumOperations() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.initializeLargeChecksumForMixedTest();
        await this.writeMixedFileAndChecksum();
        await this.validateMixedFileAndChecksum();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestSparseChecksumWrite() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeSparseChecksum();
        await this.validateSparseChecksum();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestSparseChecksumRead() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeChecksumWithLargeGap();
        await this.validateSparseChecksumRead();
    }
    
    /**
     * Test reading a specific slice of a sparse checksum that spans across
     * [Existing Chunk] -> [Missing/Gap Chunk] -> [Existing Chunk].
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestChecksumReadAcrossGap() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeChecksumWithThreeChunksAndGap();
        await this.validateChecksumSliceAcrossGap();
    }
    
    /**
     * Test ensuring that writing to a sparse checksum offset preserves the existing
     * non-zero data but still treats the unwritten gap as zeros.
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestChecksumWriteIntoGap() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeChecksumWithLargeGap();
        await this.writeIntoChecksumGap();
        await this.validateChecksumGapContent();
    }
    
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestInterleavedBlocksRead() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeInterleavedBlocks();
        await this.validateInterleavedChecksums();
    }
    
    /**
     * Test F: The "Split Checksum" Boundary
     * Deliberately places a small 32B checksum exactly crossing the 255KB chunk boundary.
     * E.g., 16 bytes in Chunk 1, 16 bytes in Chunk 2.
     * Then reads it back in a single 32B read.
     * If the logic for stitching chunks is wrong, you might get zeros or half-data.
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "mongo",
            },
        },
    })
    async stressTestSplitChecksumBoundary() {
        await this.createNewStore();
        await this.createNewRandomModeFileWithManyChunks();
        await this.writeSplitChecksumAtBoundary();
        await this.validateSplitChecksum();
    }
    
    /**
     * Test G: Rapid Small Reads (SQLite behavior)
     * Writes a continuous pattern, then issues a sequence of small, adjacent reads
     * (e.g., read 128KB, then read 32B, then read 128KB...).
     * This ensures the "read" method doesn't carry over state or offset errors between calls.
     */
    @Test({
        config: {
            db: {
                randomWriteStorageProviderName: "fs",
            },
        },
    })
    async stressTestSequentialSmallReads() {
        await this.createNewStore();
        await this.createNewRandomModeFile();
        await this.writeContinuousPattern();
        await this.performSequentialReadPattern();
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
    
    private async createNewRandomModeFileWithLargeChecksum() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        
        const request = await this.apis.requestApi.createRequest({files: [{size: 512, checksumSize: 512, randomWrite: true}]});
        
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(512, "A")});
        await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 1, checksum: Buffer.alloc(512, "A")});
        
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
    
    private async writeOnFileChecksum() {
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
                    data: Buffer.from("BBBB"),
                    pos: 16,
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
    
    private async validateFileChecksum() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 512 && buf.toString().substring(16, 20) === "BBBB", "Invalid file content");
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
    
    private async listFilesByCreateDateAsc() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        
        const res = await this.apis.storeApi.storeFileList({
            storeId: this.storeId,
            limit: 100,
            skip: 0,
            sortBy: "createDate",
            sortOrder: "asc",
        });
        
        assert(res.count === 4, `Message count does not match expected 100! instead:${res.count}`);
        let lastMessageTimestamp = 0;
        for (const file of res.files) {
            assert(file.createDate > lastMessageTimestamp, "Messages are in wrong order");
            lastMessageTimestamp = file.createDate;
        }
    }
    
    private async listFilesByCreateDateDesc() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        
        const res = await this.apis.storeApi.storeFileList({
            storeId: this.storeId,
            limit: 100,
            skip: 0,
            sortBy: "createDate",
            sortOrder: "desc",
        });
        
        assert(res.count === 4, `Message count does not match expected 100! instead:${res.count}`);
        let lastMessageTimestamp = Infinity;
        for (const file of res.files) {
            assert(file.createDate < lastMessageTimestamp, "Messages are in wrong order");
            lastMessageTimestamp = file.createDate;
        }
    }
    
    private async listFilesByUpdateDateDesc() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const res = await this.apis.storeApi.storeFileList({
            storeId: this.storeId,
            limit: 100,
            skip: 0,
            sortBy: "updates",
            sortOrder: "desc",
        });
        
        assert(res.count === 4, `Message count does not match expected 4! instead:${res.count}`);
        assert(res.files.length === 4 && res.files[0].id === this.fileId, "last message doesnt match");
    }
    
    private async listFilesByUpdateDateAsc() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const res = await this.apis.storeApi.storeFileList({
            storeId: this.storeId,
            limit: 100,
            skip: 0,
            sortBy: "updates",
            sortOrder: "asc",
        });
        
        assert(res.count === 4, `Message count does not match expected 4! instead:${res.count}`);
        assert(res.files.length === 4 && res.files[3].id === this.fileId, "first message doesnt match");
    }
    
    private async updateFile() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const res = await this.apis.storeApi.storeFileUpdate({
            fileId: this.fileId,
            meta: "bbbb" as types.store.StoreFileMeta,
            keyId: testData.keyId,
        });
        assert(res === "OK", "Unexpected return value from storeFileUpdate(");
    }
    
    private async createNewRandomModeFileSmall() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        const request = await this.apis.requestApi.createRequest({files: [{size: 100, checksumSize: 64, randomWrite: true}]});
        
        await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(100, "A")});
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
    
    private async writeOnFileSmallWithTruncate() {
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
                    data: Buffer.alloc(50, "B"),
                    pos: 0,
                    truncate: true,
                },
            ],
        });
    }
    
    private async validateSmallFileContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 50, `Expected 50 bytes, got ${buf.length}`);
        assert(buf.toString() === "B".repeat(50), "Invalid file content");
    }
    
    private async writeOnFileAtStartWithTruncate() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.from("SHORT_DATA"),
                    pos: 0,
                    truncate: true,
                },
            ],
        });
    }
    
    private async validateTruncatedAtStartContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 10, `Expected 10 bytes, got ${buf.length}`);
        assert(buf.toString() === "SHORT_DATA", "Invalid file content");
    }
    
    private async writeOnFileMiddleChunk() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const CHUNK_SIZE = 255 * 1024;
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(100, "M"),
                    pos: CHUNK_SIZE + 10,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateLastChunkContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const CHUNK_SIZE = 255 * 1024;
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: (CHUNK_SIZE * 3) - 10, to: (CHUNK_SIZE * 3)},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 10, `Expected 10 bytes, got ${buf.length}`);
        assert(buf.toString() === "CCCCCCCCCC", "Last chunk corrupted");
    }
    
    private async writeOnFileTruncateToSmall() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(1024, "N"),
                    pos: 0,
                    truncate: true,
                },
            ],
        });
    }
    
    private async validateTruncatedToSmallContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 1024, `Expected 1024 bytes, got ${buf.length}`);
    }
    
    private async writeOnFileExpandWithoutOverwritingOldTail() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const CHUNK_SIZE = 255 * 1024;
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 2 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(10, "Z"),
                    pos: (CHUNK_SIZE * 2) + 10,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateZombieAreaIsClean() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const CHUNK_SIZE = 255 * 1024;
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: CHUNK_SIZE + 100, to: CHUNK_SIZE + 110},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        const isAllZeros = buf.every(b => b === 0);
        assert(isAllZeros, `Expected zeros, found: ${buf.toString()}`);
    }
    
    private async writeOnFileToNewChunk() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const CHUNK_SIZE = 255 * 1024;
        const posInSecondChunk = CHUNK_SIZE + 100;
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "aaaa" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.from("NEW_CHUNK_DATA"),
                    pos: posInSecondChunk,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateNewChunkContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized yet");
        }
        const CHUNK_SIZE = 255 * 1024;
        const posInSecondChunk = CHUNK_SIZE + 100;
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: posInSecondChunk, to: posInSecondChunk + 14},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.toString() === "NEW_CHUNK_DATA", `Invalid new chunk content, ${buf.toString()}`);
    }
    
    private async writeFarBeyondEOF() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // File is currently 100 bytes.
        // Write at offset 1,000,000 (approx 1MB gap).
        const data = Buffer.from("FAR_AWAY_DATA");
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "updated" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: data,
                    pos: 1000000,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateGapFilling() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // 1. Check total size
        const fileStat = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((fileStat.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Expected: 1,000,000 (gap start) + 13 (data length)
        assert(buf.length === 1000013, `Expected size 1000013, got ${buf.length}`);
        
        // 2. Verify data at the end
        const tail = buf.subarray(1000000);
        assert(tail.toString() === "FAR_AWAY_DATA", "Data at high offset is corrupted");
        
        // 3. Verify zeros in the gap (e.g., check bytes 500 to 510)
        const gapSlice = buf.subarray(500, 510);
        assert(gapSlice.every(b => b === 0), "Gap was not filled with zeros");
    }
    
    private async writeSpanning3Chunks() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // 255KB = 261120 bytes.
        // Write starts at 200,000.
        // Length 400,000.
        // End at 600,000.
        //
        // Chunk 1 (0 - 261120): Affected (tail modified)
        // Chunk 2 (261120 - 522240): Completely overwritten
        // Chunk 3 (522240 - 783360): Affected (head modified)
        
        const bigData = Buffer.alloc(400000, "X");
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "updated" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: bigData,
                    pos: 200000,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateSpanningContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: 199990, to: 600010}, // Read around the edges
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Check start boundary (should be original "A" then "X")
        // We requested 10 bytes before 200,000.
        // Original file was filled with "A" (chunk 1), "B" (chunk 2), "C" (chunk 3).
        // 200,000 is inside Chunk 1 ("A").
        assert(buf.subarray(0, 10).toString().match(/^A*$/), "Pre-write data corrupted");
        
        // Check start of write
        assert(buf.subarray(10, 20).toString().match(/^X*$/), "Start of spanning write corrupted");
        
        // Check end of write (at 400,000 + 10 offset = 400,010 in buffer)
        // The write ends at 600,000 (absolute).
        // 600,000 is inside Chunk 3 ("C").
        // buf len is 400,020.
        // Index 400010 corresponds to absolute 600000.
        assert(buf.subarray(400010, 400020).toString().match(/^C*$/), "Post-write data corrupted");
    }
    
    private async truncateExactlyAtBoundary() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const CHUNK_SIZE = 255 * 1024;
        
        // Truncate to exactly 1 chunk size
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "updated" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(0), // No new data, just set pos and truncate
                    pos: CHUNK_SIZE,
                    truncate: true,
                },
            ],
        });
    }
    
    private async validateBoundarySize() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === CHUNK_SIZE, `Expected exactly ${CHUNK_SIZE}, got ${buf.length}`);
    }
    
    private async truncateToZero() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "updated" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(0),
                    pos: 0,
                    truncate: true,
                },
            ],
        });
    }
    
    private async validateZeroSize() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 0, `Expected 0 bytes, got ${buf.length}`);
    }
    
    private async validateReadPastEOF() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        // File is 100 bytes.
        
        // Case 1: Slice partially outside
        // Read 90 to 110. Should return 10 bytes (90-100).
        let file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: 90, to: 110},
            thumb: false,
        });
        let buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 10, `Expected 10 bytes trimmed at EOF, got ${buf.length}`);
        
        // Case 2: Slice fully outside
        // Read 200 to 300. Should return 0 bytes.
        file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: 200, to: 300},
            thumb: false,
        });
        buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === 0, `Expected 0 bytes for read past EOF, got ${buf.length}`);
    }
    private async writeSandwichData() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const CHUNK_SIZE = 255 * 1024;
        const startOffset = CHUNK_SIZE - 100;
        // Length covers: Last 100 bytes of Chunk 1 + Full Chunk 2 + First 100 bytes of Chunk 3
        const length = 100 + CHUNK_SIZE + 100;
        const data = Buffer.alloc(length, "X");
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "sandwich" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: data,
                    pos: startOffset,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateSandwichContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const CHUNK_SIZE = 255 * 1024;
        const startOffset = CHUNK_SIZE - 100;
        const length = 100 + CHUNK_SIZE + 100;
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Check pre-write area (Chunk 1 start)
        assert(buf.subarray(0, startOffset).toString().match(/^A*$/), "Pre-sandwich data corrupted");
        
        // Check the written area (The Sandwich)
        const writtenArea = buf.subarray(startOffset, startOffset + length);
        assert(writtenArea.toString().match(/^X*$/), "Sandwich data corrupted");
        assert(writtenArea.length === length, "Sandwich length mismatch");
        
        // Check post-write area (Chunk 3 rest)
        const postWriteStart = startOffset + length;
        assert(buf.subarray(postWriteStart).toString().match(/^C*$/), "Post-sandwich data corrupted");
    }
    
    private async writeBoundaryStitches() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const CHUNK_SIZE = 255 * 1024;
        
        // Write "YYYY" across boundary 1-2 (2 bytes in Ch1, 2 bytes in Ch2)
        // Write "ZZZZ" across boundary 2-3 (2 bytes in Ch2, 2 bytes in Ch3)
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "stitch" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.from("YYYY"),
                    pos: CHUNK_SIZE - 2,
                    truncate: false,
                },
                {
                    type: "file",
                    data: Buffer.from("ZZZZ"),
                    pos: (CHUNK_SIZE * 2) - 2,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateBoundaryStitches() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const CHUNK_SIZE = 255 * 1024;
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Verify Boundary 1
        const b1 = buf.subarray(CHUNK_SIZE - 2, CHUNK_SIZE + 2);
        assert(b1.toString() === "YYYY", `Boundary 1 Corrupted: ${b1.toString()}`);
        
        // Verify Boundary 2
        const b2 = buf.subarray((CHUNK_SIZE * 2) - 2, (CHUNK_SIZE * 2) + 2);
        assert(b2.toString() === "ZZZZ", `Boundary 2 Corrupted: ${b2.toString()}`);
        
        // Verify Integrity of surrounding data
        assert(buf[CHUNK_SIZE - 3] === "A".charCodeAt(0), "Data before B1 corrupted");
        assert(buf[CHUNK_SIZE + 2] === "B".charCodeAt(0), "Data after B1 corrupted");
    }
    
    private async writeExactChunkReplacement() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const CHUNK_SIZE = 255 * 1024;
        const newData = Buffer.alloc(CHUNK_SIZE, "N");
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "exact" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: newData,
                    pos: CHUNK_SIZE, // Exactly start of Chunk 2
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateExactChunkReplacement() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const CHUNK_SIZE = 255 * 1024;
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Verify Chunk 1 is A
        assert(buf.subarray(0, CHUNK_SIZE).toString().match(/^A*$/), "Chunk 1 corrupted");
        // Verify Chunk 2 is N
        assert(buf.subarray(CHUNK_SIZE, CHUNK_SIZE * 2).toString().match(/^N*$/), "Chunk 2 replacement failed");
        // Verify Chunk 3 is C
        assert(buf.subarray(CHUNK_SIZE * 2).toString().match(/^C*$/), "Chunk 3 corrupted");
    }
    
    private async writeOverlappingOperations() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // Op 1: Write "BBBB" at 0.
        // Op 2: Write "CCCC" at 2 (Overwriting half of BBBB).
        // Op 3: Write "DD" at 3 (Overwriting inside CCCC).
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "overlap" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                { type: "file", data: Buffer.from("BBBB"), pos: 0, truncate: false },
                { type: "file", data: Buffer.from("CCCC"), pos: 2, truncate: false },
                { type: "file", data: Buffer.from("DD"), pos: 3, truncate: false },
            ],
        });
    }
    
    private async validateOverlappingContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        const resultPrefix = buf.subarray(0, 6).toString();
        // Result logic:
        // 012345
        // BBBB..
        // ..CCCC
        // ...DD.
        // BBCDDC
        assert(resultPrefix === "BBCDDC", `Overlapping memory update failed. Expected BBCDDC, got ${resultPrefix}`);
    }
    
    private async validateChecksumPartialUpdate() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        const writePos = CHUNK_SIZE + 100;
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        // 1. Verify Start of Chunk 2 (Before write) - Should be "A"
        assert(buf.subarray(CHUNK_SIZE, writePos).toString().match(/^A*$/), "Checksum data before update corrupted");
        
        // 2. Verify The Update - Should be "X"
        assert(buf.subarray(writePos, writePos + 1000).toString().match(/^X*$/), "Checksum update failed");
        
        // 3. Verify Rest of Chunk 2 (After write) - Should be "A"
        assert(buf.subarray(writePos + 1000, CHUNK_SIZE * 2).toString().match(/^A*$/), "Checksum data after update corrupted");
    }
    
    private async writeChecksumAppendNewChunk() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        
        // Current Checksum size is 3 * 255KB.
        // Append data that forces creation of Chunk 4.
        const appendPos = CHUNK_SIZE * 3;
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "chk_append" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.from("NEW_CHECKSUM_CHUNK"),
                    pos: appendPos,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateChecksumAppendNewChunk() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        const appendPos = CHUNK_SIZE * 3;
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Verify total size
        const expectedSize = appendPos + "NEW_CHECKSUM_CHUNK".length;
        assert(buf.length === expectedSize, `Checksum size incorrect. Expected ${expectedSize}, got ${buf.length}`);
        
        // Verify new content
        const newContent = buf.subarray(appendPos);
        assert(newContent.toString() === "NEW_CHECKSUM_CHUNK", "Appended checksum chunk corrupted");
    }
    
    private async writeChecksumTruncate() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // Truncate checksum to 10 bytes.
        // Should delete all 3 chunks (logically replaced by 1 small chunk) or update Chunk 1 and delete 2 & 3.
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "chk_trunc" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.alloc(10, "T"),
                    pos: 0,
                    truncate: true,
                },
            ],
        });
    }
    
    private async validateChecksumTruncate() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        assert(buf.length === 10, `Checksum truncation failed. Expected 10 bytes, got ${buf.length}`);
        assert(buf.toString() === "TTTTTTTTTT", "Truncated checksum content invalid");
    }
    
    private async initializeLargeChecksumForMixedTest() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        // Manually overwrite checksum to be large (Chunk 1 full of "C")
        const CHUNK_SIZE = 255 * 1024;
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "init" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 0 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.alloc(CHUNK_SIZE, "C"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeMixedFileAndChecksum() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // Op 1: Update File (Chunk 1) -> "F"
        // Op 2: Update Checksum (Chunk 1) -> "K"
        // Op 3: Append File (New Chunk) -> "F_APPEND"
        // Op 4: Truncate Checksum -> to 100 bytes
        
        const CHUNK_SIZE = 255 * 1024;
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "mixed" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(100, "F"),
                    pos: 0,
                    truncate: false,
                },
                {
                    type: "checksum",
                    data: Buffer.alloc(100, "K"),
                    pos: 0,
                    truncate: false,
                },
                {
                    type: "file",
                    data: Buffer.from("F_APPEND"),
                    pos: CHUNK_SIZE * 3, // Force new chunk
                    truncate: false, // Should pad with zeros
                },
                {
                    type: "checksum",
                    data: Buffer.alloc(100, "T"),
                    pos: 0,
                    truncate: true, // Should truncate checksum to 100 bytes
                },
            ],
        });
    }
    
    private async validateMixedFileAndChecksum() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        
        // 1. Validate File
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "all"},
            thumb: false,
        });
        const fileBuf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        // File Start: "F"
        assert(fileBuf.subarray(0, 100).toString().match(/^F*$/), "File start corrupted in mixed op");
        // File Append: "F_APPEND" at Chunk 4 start
        // Note: Sparse gap should be zeros
        assert(fileBuf.subarray(CHUNK_SIZE * 3).toString() === "F_APPEND", "File append corrupted in mixed op");
        
        // 2. Validate Checksum
        const chk = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const chkBuf = Buffer.from((chk.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Checksum should be exactly 100 bytes of "T" (because of truncate)
        assert(chkBuf.length === 100, `Checksum size mismatch. Expected 100, got ${chkBuf.length}`);
        assert(chkBuf.toString().match(/^T*$/), "Checksum content corrupted in mixed op");
    }
    
    private async writeSparseChecksum() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        // Current checksum is small (64 bytes).
        // Write at offset 500,000 (creating large gap).
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "chk_sparse" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.from("SPARSE_DATA"),
                    pos: 500000,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateSparseChecksum() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const chk = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const chkBuf = Buffer.from((chk.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Total size = 500,000 + length
        const expectedSize = 500000 + "SPARSE_DATA".length;
        assert(chkBuf.length === expectedSize, `Sparse checksum size mismatch. Got ${chkBuf.length}`);
        
        // Verify gap is zero
        const gapSlice = chkBuf.subarray(100, 200);
        assert(gapSlice.every(b => b === 0), "Checksum gap not filled with zeros");
        
        // Verify data
        const tail = chkBuf.subarray(500000);
        assert(tail.toString() === "SPARSE_DATA", "Sparse checksum data corrupted");
    }
    
    private async writeChecksumPartialUpdate() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        
        // Checksum has 3 chunks ("A").
        // We overwrite the middle of Chunk 2 with "X".
        // Chunk 2 range: [261120, 522240].
        // Write at offset: 261120 + 100.
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "chk_update" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.alloc(1000, "X"),
                    pos: CHUNK_SIZE + 100,
                    truncate: false,
                },
            ],
        });
    }
    
    private async writeChecksumWithLargeGap() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // Initial checksum is small (e.g. 64 bytes).
        // Write data at 600KB offset.
        // This skips over the entire Chunk 2 area (approx 255KB-510KB), making it a "hole".
        
        const data = Buffer.from("END_OF_CHECKSUM");
        const pos = 600 * 1024; // 600KB
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "sparse_chk" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: data,
                    pos: pos,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateSparseChecksumRead() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const chk = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const buf = Buffer.from((chk.data as unknown as ByteBuffer).toArrayBuffer());
        
        // 1. Check total size: 600KB + length of string
        const expectedSize = (600 * 1024) + "END_OF_CHECKSUM".length;
        assert(buf.length === expectedSize, `Checksum size mismatch. Expected ${expectedSize}, got ${buf.length}`);
        
        // 2. Check the "hole" (Chunk 2 area, e.g., 300KB to 400KB)
        const holeSlice = buf.subarray(300 * 1024, 400 * 1024);
        assert(holeSlice.every(b => b === 0), "Sparse gap in checksum is not zero-filled");
        
        // 3. Check tail data
        const tail = buf.subarray(600 * 1024);
        assert(tail.toString() === "END_OF_CHECKSUM", "Checksum tail data corrupted");
    }
    
    private async writeChecksumWithThreeChunksAndGap() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        
        // We want:
        // Chunk 1: Data "A" (Exists)
        // Chunk 2: GAP (Missing in DB)
        // Chunk 3: Data "C" (Exists)
        
        // 1. Write Chunk 1
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "step1" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.alloc(100, "A"),
                    pos: 0,
                    truncate: false,
                },
            ],
        });
        
        // 2. Write Chunk 3 (Skipping Chunk 2 range entirely)
        // Chunk 2 ends at 522240 (2 * 255 * 1024).
        // Let's write at 522250.
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "step2" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 2 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.alloc(100, "C"),
                    pos: (CHUNK_SIZE * 2) + 10,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateChecksumSliceAcrossGap() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        
        // Read from end of Chunk 1 -> through Gap Chunk 2 -> to start of Chunk 3
        // Chunk 1 end: 261120
        // Chunk 2 end: 522240
        // Chunk 3 start: 522240
        
        // Let's rely on full read and slice in memory to check the structure,
        // as "slice" range for checksums might not be fully exposed in the public API
        // depending on your `StoreApi` implementation (often only `type: checksum` is allowed).
        // Assuming we read full checksum:
        
        const chk = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const fullBuf = Buffer.from((chk.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Expected layout:
        // [0-100]: "A"
        // [100 - CHUNK_SIZE]: Zeros (Rest of Chunk 1)
        // [CHUNK_SIZE - CHUNK_SIZE*2]: ALL ZEROS (Chunk 2 - GAP)
        // [CHUNK_SIZE*2 - CHUNK_SIZE*2+10]: Zeros (Start of Chunk 3)
        // [CHUNK_SIZE*2+10 - ...]: "C"
        
        // Verify Chunk 1 Data
        assert(fullBuf.subarray(0, 100).toString().match(/^A*$/), "Chunk 1 data invalid");
        
        // Verify Gap (Chunk 2)
        const gapChunk = fullBuf.subarray(CHUNK_SIZE, CHUNK_SIZE * 2);
        assert(gapChunk.every(b => b === 0), "Gap chunk (Chunk 2) is not zero-filled");
        
        // Verify Chunk 3 Data
        const cData = fullBuf.subarray((CHUNK_SIZE * 2) + 10, (CHUNK_SIZE * 2) + 110);
        assert(cData.toString().match(/^C*$/), "Chunk 3 data invalid");
    }
    
    private async writeIntoChecksumGap() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // We have a gap around 300KB. Write "MID" there.
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "fill_gap" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 2 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "checksum",
                    data: Buffer.from("MID_GAP_DATA"),
                    pos: 300 * 1024,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateChecksumGapContent() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const chk = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "checksum"},
            thumb: false,
        });
        const buf = Buffer.from((chk.data as unknown as ByteBuffer).toArrayBuffer());
        
        // Verify "MID_GAP_DATA" is present
        const mid = buf.subarray(300 * 1024, (300 * 1024) + 12);
        assert(mid.toString() === "MID_GAP_DATA", "Writing into checksum gap failed");
        
        // Verify surrounding bytes are still zero
        assert(buf[ (300 * 1024) - 1 ] === 0, "Byte before gap write corrupted");
        assert(buf[ (300 * 1024) + 12 ] === 0, "Byte after gap write corrupted");
        
        // Verify tail is still preserved
        const tail = buf.subarray(600 * 1024);
        assert(tail.toString() === "END_OF_CHECKSUM", "Tail data corrupted after gap write");
    }
    
    private async writeInterleavedBlocks() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // Pattern: 4 blocks of (128KB Data + 32B Checksum)
        // Total size: (128*1024 + 32) * 4 = 524,416 bytes (~512KB)
        
        const BLOCK_SIZE = 128 * 1024; // 131072
        const CHK_SIZE = 32;
        
        let currentPos = 0;
        
        // --- Batch 1: Process Blocks 0 and 1 (4 operations) ---
        const ops1: types.store.StoreFileRandomWriteOperation[] = [];
        for (let i = 0; i < 2; i++) {
            // Data Block
            ops1.push({
                type: "file",
                data: Buffer.alloc(BLOCK_SIZE, "D"),
                pos: currentPos,
                truncate: false,
            });
            currentPos += BLOCK_SIZE;
            
            // Checksum Block (values 0x01, 0x02)
            ops1.push({
                type: "file",
                data: Buffer.alloc(CHK_SIZE, i + 1),
                pos: currentPos,
                truncate: false,
            });
            currentPos += CHK_SIZE;
        }
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "interleaved_batch1" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: ops1,
        });
        
        // --- Batch 2: Process Blocks 2 and 3 (4 operations) ---
        const ops2: types.store.StoreFileRandomWriteOperation[] = [];
        for (let i = 2; i < 4; i++) {
            // Data Block
            ops2.push({
                type: "file",
                data: Buffer.alloc(BLOCK_SIZE, "D"),
                pos: currentPos,
                truncate: false,
            });
            currentPos += BLOCK_SIZE;
            
            // Checksum Block (values 0x03, 0x04)
            ops2.push({
                type: "file",
                data: Buffer.alloc(CHK_SIZE, i + 1),
                pos: currentPos,
                truncate: false,
            });
            currentPos += CHK_SIZE;
        }
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "interleaved_batch2" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 2 as types.store.StoreFileVersion,
            force: true,
            operations: ops2,
        });
    }
    private async validateInterleavedChecksums() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        const BLOCK_SIZE = 128 * 1024;
        const CHK_SIZE = 32;
        const STRIDE = BLOCK_SIZE + CHK_SIZE;
        
        // Verify all 4 checksums
        for (let i = 0; i < 4; i++) {
            const expectedPos = (i * STRIDE) + BLOCK_SIZE;
            
            const file = await this.apis.storeApi.storeFileRead({
                fileId: this.fileId,
                range: {type: "slice", from: expectedPos, to: expectedPos + CHK_SIZE},
                thumb: false,
            });
            const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
            
            assert(buf.length === CHK_SIZE, `Checksum ${i} size wrong`);
            
            // Check if it's all zeros (The Bug) or correct value
            const isZeros = buf.every(b => b === 0);
            assert(!isZeros, `Checksum ${i} at pos ${expectedPos} returned ALL ZEROS!`);
            
            // Check specific value
            const expectedVal = i + 1;
            const isCorrect = buf.every(b => b === expectedVal);
            assert(isCorrect, `Checksum ${i} content incorrect. Expected byte ${expectedVal}, got ${buf[0]}`);
        }
    }
    
    private async writeSplitChecksumAtBoundary() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024; // 261120 bytes
        
        // We want a 32-byte checksum to cross the boundary.
        // Start 16 bytes before the end of Chunk 1.
        const pos = CHUNK_SIZE - 16;
        
        // Write 32 bytes of "X"
        // 16 bytes go to Chunk 1, 16 bytes go to Chunk 2.
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "split" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [
                {
                    type: "file",
                    data: Buffer.alloc(32, "X"),
                    pos: pos,
                    truncate: false,
                },
            ],
        });
    }
    
    private async validateSplitChecksum() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        const CHUNK_SIZE = 255 * 1024;
        const pos = CHUNK_SIZE - 16;
        
        // Read exactly the 32 bytes crossing the boundary
        const file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: pos, to: pos + 32},
            thumb: false,
        });
        const buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        
        assert(buf.length === 32, "Read length mismatch");
        
        // If the stitch logic failed, we might see zeros in the second half
        const isAllX = buf.toString().match(/^X*$/);
        assert(isAllX, `Split checksum corrupted. Got hex: ${buf.toString("hex")}`);
    }
    
    private async writeContinuousPattern() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // Write 500KB of counting bytes 0..255 repeating
        const size = 500 * 1024;
        const data = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
            data[i] = i % 255;
        }
        
        await this.apis.storeApi.storeFileWrite({
            fileId: this.fileId,
            meta: "continuous" as types.store.StoreFileMeta,
            keyId: testData.keyId,
            version: 1 as types.store.StoreFileVersion,
            force: true,
            operations: [{ type: "file", data: data, pos: 0, truncate: true }],
        });
    }
    
    private async performSequentialReadPattern() {
        if (!this.fileId) {
            throw new Error("fileId not initialized");
        }
        
        // Pattern: 128KB, then 32B, then 128KB, then 32B
        const BLOCK = 128 * 1024;
        const SMALL = 32;
        let pos = 0;
        
        // Read 1: Large Block
        let file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: pos, to: pos + BLOCK},
            thumb: false,
        });
        let buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === BLOCK, "Read 1 size mismatch");
        assert(buf[0] === 0 && buf[1] === 1, "Read 1 content mismatch");
        pos += BLOCK;
        
        // Read 2: Small Block (Potential failure point)
        file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: pos, to: pos + SMALL},
            thumb: false,
        });
        buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === SMALL, "Read 2 size mismatch");
        
        // Verify content (should continue counting)
        // pos is 131072. 131072 % 255 = 17 (approx, let's just check non-zero)
        const expectedByte = pos % 255;
        assert(buf[0] === expectedByte, `Read 2 start byte wrong. Expected ${expectedByte}, got ${buf[0]}`);
        assert(!buf.every(b => b === 0), "Read 2 returned ALL ZEROS");
        
        pos += SMALL;
        
        // Read 3: Large Block again
        file = await this.apis.storeApi.storeFileRead({
            fileId: this.fileId,
            range: {type: "slice", from: pos, to: pos + BLOCK},
            thumb: false,
        });
        buf = Buffer.from((file.data as unknown as ByteBuffer).toArrayBuffer());
        assert(buf.length === BLOCK, "Read 3 size mismatch");
        assert(buf[0] === pos % 255, "Read 3 content mismatch");
    }
}
