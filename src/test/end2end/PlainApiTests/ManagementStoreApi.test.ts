/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode, Test, verifyResponseFor, verifyResponseIsOK } from "../BaseTestSet";
import * as types from "../../../types";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import { DateUtils } from "../../../utils/DateUtils";
import { PromiseUtils } from "../../../utils/PromiseUtils";

export class ManagementStoreApiTest extends BaseTestSet {
    
    private newStores: types.store.StoreId[] = [];
    private newStoreFile?: types.store.StoreFileId;
    private newStoreFiles: types.store.StoreFileId[] = [];
    
    @Test()
    async shouldGetStore() {
        this.helpers.authorizePlainApi();
        await this.fetchStore();
    }
    
    @Test()
    async shouldDeleteStore() {
        this.helpers.authorizePlainApi();
        await this.deleteSingleStore();
    }
    
    @Test()
    async shouldDeleteManyStores() {
        this.helpers.authorizePlainApi();
        await this.createNewStores();
        await this.listAllStores();
        await this.deleteAllNewStores();
        await this.validateStoreCount();
    }
    
    @Test()
    async shouldDeleteStoreFile() {
        this.helpers.authorizePlainApi();
        await this.createStoreFile();
        await this.fetchStoreFile();
        await this.deleteSingleStoreFile();
        await this.tryFetchStoreFileAndFail();
    }
    
    @Test()
    async shouldDeleteManyStoreFiles() {
        this.helpers.authorizePlainApi();
        await this.createManyStoreFiles();
        await this.listAllStoreFiles();
        await this.deleteManyStoreFiles();
        await this.checkIfAllStoreFilesAreDeleted();
    }
    
    @Test()
    async shouldDeleteStoreFilesOlderThan() {
        this.helpers.authorizePlainApi();
        await this.createManyStoreFiles();
        await this.deleteAllStoreFilesOlderThanNow();
        await this.checkIfAllStoreFilesAreDeleted();
    }
    
    private async fetchStore() {
        const result = await this.plainApis.storeApi.getStore({
            storeId: testData.storeId,
        });
        verifyResponseFor("getStore", result, ["store"]);
    }
    
    private async deleteSingleStore() {
        const result = await this.plainApis.storeApi.deleteStore({
            storeId: testData.storeId,
        });
        await PromiseUtils.wait(100);
        verifyResponseIsOK("deleteStream", result);
    }
    
    private async createNewStores() {
        for (let i = 0; i < 5; i++) {
            const newStore = await this.apis.storeApi.storeCreate({
                contextId: testData.contextId,
                keyId: testData.keyId,
                data: "aaaa" as types.store.StoreData,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
            this.newStores.push(newStore.storeId);
        }
    }
    
    private async listAllStores() {
        const result = await this.plainApis.storeApi.listStores({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listTlistStreameshreads", result, ["list", "count"]);
        assert(result.count === this.newStores.length + 1);
    }
    
    private async deleteAllNewStores() {
        const result = await this.plainApis.storeApi.deleteManyStores({
            storeIds: this.newStores,
        });
        verifyResponseFor("deleteManyStreames", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async validateStoreCount() {
        const result = await this.plainApis.storeApi.listStores({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listTlistStreameshreads", result, ["list", "count"]);
        assert(result.count === 1);
    }
    
    private async createStoreFile() {
        const req = await this.apis.requestApi.createRequest({files: [{size: 0, checksumSize: 0}]});
        const commitResult = await this.apis.requestApi.commitFile({requestId: req.id, fileIndex: 0, seq: 0, checksum: Buffer.alloc(0)});
        verifyResponseIsOK("commitFile", commitResult);
        const result = await this.apis.storeApi.storeFileCreate({
            storeId: testData.storeId,
            fileIndex: 0,
            requestId: req.id,
            keyId: testData.keyId,
            meta: "" as types.store.StoreFileMeta,
        });
        verifyResponseFor("storeFileCreate", result, ["fileId"]);
        this.newStoreFile = result.fileId;
    }
    
    private async fetchStoreFile() {
        if (!this.newStoreFile) {
            throw new Error("newStoreFile not initialized yet");
        }
        const result = await this.plainApis.storeApi.getStoreFile({
            storeFileId: this.newStoreFile,
        });
        verifyResponseFor("getStoreFile", result, ["storeFile"]);
    }
    
    private async deleteSingleStoreFile() {
        if (!this.newStoreFile) {
            throw new Error("newStoreFile not initialized yet");
        }
        const result = await this.plainApis.storeApi.deleteStoreFile({
            storeFileId: this.newStoreFile,
        });
        verifyResponseIsOK("deleteStoreFile", result);
    }
    
    private async tryFetchStoreFileAndFail() {
        const newStoreFile = this.newStoreFile;
        if (!newStoreFile) {
            throw new Error("newStoreFile not initialized yet");
        }
        await shouldThrowErrorWithCode(() => this.plainApis.storeApi.getStoreFile({
            storeFileId: newStoreFile,
        }), "STORE_FILE_DOES_NOT_EXIST");
    }
    
    private async createManyStoreFiles() {
        for (let i = 0; i < 5; i++) {
            const req = await this.apis.requestApi.createRequest({files: [{size: 1024 * 1024 * 10, checksumSize: 100}]});
            const sendChunkResult1 = await this.apis.requestApi.sendChunk({requestId: req.id, fileIndex: 0, seq: 0, data: Buffer.alloc(1024 * 1024 * 5)});
            assert(sendChunkResult1, "sendChunkResult1 unsuccessful");
            const sendChunkResult2 = await this.apis.requestApi.sendChunk({requestId: req.id, fileIndex: 0, seq: 1, data: Buffer.alloc(1024 * 1024 * 5)});
            assert(sendChunkResult2, "sendChunkResult2 unsuccessful");
            const commitResult = await this.apis.requestApi.commitFile({requestId: req.id, fileIndex: 0, seq: 2, checksum: Buffer.alloc(100)});
            assert(commitResult === "OK", "unsuccessful file commit");
            const result = await this.apis.storeApi.storeFileCreate({
                storeId: testData.storeId,
                fileIndex: 0,
                requestId: req.id,
                keyId: testData.keyId,
                meta: "" as types.store.StoreFileMeta,
            });
            verifyResponseFor("storeFileCreate", result, ["fileId"]);
            this.newStoreFiles.push(result.fileId);
        }
    }
    
    private async listAllStoreFiles() {
        const result = await this.plainApis.storeApi.listStoreFiles({
            from: null,
            limit: 10,
            sortOrder: "asc",
            storeId: testData.storeId,
        });
        verifyResponseFor("listStoreFiles", result, ["count", "list"]);
        assert(result.count === this.newStoreFiles.length, "newStoreFiles length and list count missmatch");
        assert(result.list.every(x => this.newStoreFiles.includes(x.id)));
    }
    
    private async checkIfAllStoreFilesAreDeleted() {
        const result = await this.plainApis.storeApi.listStoreFiles({
            from: null,
            limit: 10,
            sortOrder: "asc",
            storeId: testData.storeId,
        });
        verifyResponseFor("listStoreFiles", result, ["count", "list"]);
        assert(result.count === 0, "Expected list count: 0, got: " + result.count);
    }
    
    private async deleteManyStoreFiles() {
        const result = await this.plainApis.storeApi.deleteManyStoreFiles({
            fileIds: this.newStoreFiles,
        });
        await PromiseUtils.wait(100);
        verifyResponseFor("deleteManyStoreFiles", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async deleteAllStoreFilesOlderThanNow() {
        const result = await this.plainApis.storeApi.deleteStoreFilesOlderThan({
            storeId: testData.storeId,
            timestamp: DateUtils.now(),
        });
        await PromiseUtils.wait(100);
        verifyResponseFor("deleteManyStoreFiles", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
}