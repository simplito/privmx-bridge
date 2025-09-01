/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, shouldThrowErrorWithCode2, Test } from "../BaseTestSet";
import * as assert from "assert";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";

export class KvdbTests extends BaseTestSet {
    
    private entries: Map<types.kvdb.KvdbEntryKey, types.kvdb.KvdbEntryValue> = new Map();
    private kvdbId?: types.kvdb.KvdbId;
    private keysToDelete: types.kvdb.KvdbEntryKey[] = [];
    
    @Test()
    async shouldCreateGetDeleteNewKVDB() {
        await this.createNewKvdb();
        await this.getNewlyCreatedKvdb();
        await this.shouldListNewlyCreatedKvdb();
        await this.shouldUpdateExistingKvdb();
        await this.shouldListNewlyCreatedKvdbByLastModificationDate();
        await this.createNewKvdbEntry();
        await this.shouldListNewlyCreatedKvdbByLastEntryDate();
        await this.shouldDeleteNewKvdb();
        await this.shouldFetchListWithoutDeletedKvdb();
    }
    
    @Test()
    async shouldCreateGetAllDeleteManyKVDB() {
        this.helpers.authorizePlainApi();
        await this.updateContextPolicy();
        await this.createNewKvdb();
        await this.shouldListAllNewlyCreatedKvdb();
        await this.shouldDeleteNewKvdbWithDeleteMany();
        await this.shouldFetchListWithoutDeletedKvdb();
    }
    
    @Test()
    async shouldCreateNewKVDBAndCreateItemsToRetrieve() {
        await this.createNewKvdb();
        await this.createNewKvdbEntry();
        await this.getAndValidateKvdbEntry();
        await this.updateKvdbEntry();
        await this.getAndValidateKvdbEntry();
        await this.updateKvdbEntryWithWrongVersionAndFail();
        await this.updateKvdbEntryWithWrongVersionWithImplicitFalseForceAndFail();
        await this.updateOrCreateKvdbEntryWithForce();
        await this.getAndValidateKvdbEntry();
    }
    
    @Test()
    async shouldCreateNewKVDBAndCreateItemsWithForceToRetrieve() {
        await this.createNewKvdb();
        await this.updateOrCreateKvdbEntryWithForce();
        await this.getAndValidateKvdbEntry();
    }
    
    @Test()
    async shouldCreateNewKVDBAndCreateItemsWithForceAndWrongVersionToRetrieve() {
        await this.createNewKvdb();
        await this.shouldCreateKvdbEntryWithForceAndInvalidVersion();
        await this.getAndValidateKvdbEntryVersion();
    }
    
    @Test()
    async shouldFetchItemsByPrefix() {
        await this.createNewKvdb();
        await this.createNewKvdbEntries();
        await this.fetchItemsByPrefix();
    }
    
    @Test()
    async shouldFetchEntriesKeysAndDeleteMany() {
        await this.createNewKvdb();
        await this.createNewKvdbEntries();
        await this.fetchEntriesKeys();
        await this.deleteAllFetchedItems();
        await this.shouldFetchEmptyListOfKvdbEntries();
    }
    
    private async createNewKvdb() {
        const newKvdb = await this.apis.kvdbApi.kvdbCreate({
            contextId: testData.contextId,
            data: "AAAA" as types.kvdb.KvdbData,
            resourceId: this.helpers.generateResourceId(),
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        this.kvdbId = newKvdb.kvdbId;
    }
    
    private async getNewlyCreatedKvdb() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const kvdb = await this.apis.kvdbApi.kvdbGet({
            kvdbId: this.kvdbId,
        });
        assert(!!kvdb, "Unexpected return value from kvdbGet(");
    }
    
    private async shouldListNewlyCreatedKvdb() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const result = await this.apis.kvdbApi.kvdbList({
            contextId: testData.contextId,
            limit: 100,
            skip: 0,
            sortOrder: "asc",
        });
        assert(result.count === 2 && result.kvdbs.length === 2, "Unexpected return value from kvdbList(");
    }
    
    private async shouldUpdateExistingKvdb() {
        await this.apis.kvdbApi.kvdbUpdate({
            id: testData.kvdbId,
            resourceId: testData.kvdbResourceId,
            data: "AAAAB" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
            version: 1 as types.kvdb.KvdbVersion,
            force: false,
        });
    }
    
    private async shouldListNewlyCreatedKvdbByLastModificationDate() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const result = await this.apis.kvdbApi.kvdbList({
            contextId: testData.contextId,
            limit: 100,
            skip: 0,
            sortOrder: "desc",
            sortBy: "lastModificationDate",
        });
        assert(result.count === 2 && result.kvdbs.length === 2, "Unexpected return value from kvdbList(");
        assert(result.kvdbs[0].id === testData.kvdbId, "Invalid first kvdb on list");
    }
    
    private async shouldListNewlyCreatedKvdbByLastEntryDate() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const result = await this.apis.kvdbApi.kvdbList({
            contextId: testData.contextId,
            limit: 100,
            skip: 0,
            sortOrder: "desc",
            sortBy: "lastEntryDate",
        });
        assert(result.count === 2 && result.kvdbs.length === 2, "Unexpected return value from kvdbList(");
        assert(result.kvdbs[0].id === this.kvdbId, "Invalid first kvdb on list");
    }
    
    private async shouldListAllNewlyCreatedKvdb() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const kvdb = await this.apis.kvdbApi.kvdbListAll({
            contextId: testData.contextId,
            limit: 100,
            skip: 0,
            sortOrder: "asc",
        });
        assert(kvdb.count === 2 && kvdb.kvdbs.length === 2, "Unexpected return value from kvdbListAll(");
    }
    
    private async shouldDeleteNewKvdb() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbDelete({
            kvdbId: this.kvdbId,
        });
        assert(res === "OK",  "Unexpected return value from kvdbDelete(");
    }
    
    private async shouldDeleteNewKvdbWithDeleteMany() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbDeleteMany({
            kvdbIds: [this.kvdbId],
        });
        assert(res.results.length === 1 && res.results[0].id === this.kvdbId && res.results[0].status === "OK",  "Unexpected return value from kvdbDeleteMany(");
    }
    
    private async shouldFetchListWithoutDeletedKvdb() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const result = await this.apis.kvdbApi.kvdbList({
            contextId: testData.contextId,
            limit: 100,
            skip: 0,
            sortOrder: "asc",
        });
        assert(result.count === 1 && result.kvdbs.length === 1 && result.kvdbs[0].id !== this.kvdbId, "Unexpected return value from kvdbList(");
    }
    
    private async createNewKvdbEntry() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbEntrySet({
            kvdbId: this.kvdbId,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
            kvdbEntryValue: "AAAA123" as types.kvdb.KvdbEntryValue,
            keyId: testData.keyId,
        });
        this.entries.set("abc123" as types.kvdb.KvdbEntryKey, "AAAA123");
        assert(res === "OK", "Unexpected return value from kvdbEntrySet(");
    }
    
    private async createNewKvdbEntries() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        for (let i = 0; i < 5; i++) {
            const res = await this.apis.kvdbApi.kvdbEntrySet({
                kvdbId: this.kvdbId,
                kvdbEntryKey: `myprefix/aaa${i}` as types.kvdb.KvdbEntryKey,
                kvdbEntryValue: `AAAA${i}` as types.kvdb.KvdbEntryValue,
                keyId: testData.keyId,
            });
            this.entries.set(`myprefix/aaa${i}` as types.kvdb.KvdbEntryKey, `AAAA${i}`);
            assert(res === "OK", "Unexpected return value from kvdbEntrySet(");
        }
    }
    
    private async getAndValidateKvdbEntry() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        if (this.entries.size === 0) {
            throw new Error("no items added during tests");
        }
        const res = await this.apis.kvdbApi.kvdbEntryGet({
            kvdbId: this.kvdbId,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
        });
        assert(res.kvdbEntry.kvdbEntryValue === this.entries.get("abc123" as types.kvdb.KvdbEntryKey), "Invalid kvdb item");
    }
    
    private async updateKvdbEntry() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbEntrySet({
            kvdbId: this.kvdbId,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
            kvdbEntryValue: "BBB456" as types.kvdb.KvdbEntryValue,
            keyId: testData.keyId,
            version: 1 as types.kvdb.KvdbEntryVersion,
        });
        this.entries.set("abc123" as types.kvdb.KvdbEntryKey, "BBB456");
        assert(res === "OK", "Unexpected return value from kvdbEntrySet(");
    }
    
    private async updateKvdbEntryWithWrongVersionAndFail() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const kvdb = this.kvdbId;
        await shouldThrowErrorWithCode2(() => this.apis.kvdbApi.kvdbEntrySet({
            kvdbId: kvdb,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
            kvdbEntryValue: "CCC456" as types.kvdb.KvdbEntryValue,
            keyId: testData.keyId,
            version: 0 as types.kvdb.KvdbEntryVersion,
        }), "INVALID_VERSION");
    }
    
    private async updateKvdbEntryWithWrongVersionWithImplicitFalseForceAndFail() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const kvdb = this.kvdbId;
        await shouldThrowErrorWithCode2(() => this.apis.kvdbApi.kvdbEntrySet({
            kvdbId: kvdb,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
            kvdbEntryValue: "CCC456" as types.kvdb.KvdbEntryValue,
            keyId: testData.keyId,
            version: 0 as types.kvdb.KvdbEntryVersion,
            force: false,
        }), "INVALID_VERSION");
    }
    
    private async fetchItemsByPrefix() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbListEntries({
            kvdbId: this.kvdbId,
            limit: 10,
            skip: 0,
            sortOrder: "desc",
            query: {
                "#entryKey": {
                    $startsWith: "myprefix/",
                },
            },
        });
        assert(res.count === 5 && res.kvdbEntries.length === 5, "Invalid list length or count");
        for (const item of res.kvdbEntries) {
            assert(item.kvdbEntryValue === this.entries.get(item.kvdbEntryKey), "Invalid kvdb item");
        }
    }
    
    private async fetchEntriesKeys() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbListKeys({
            kvdbId: this.kvdbId,
            limit: 10,
            skip: 0,
            sortOrder: "desc",
        });
        assert(res.count === 5 && res.kvdbEntryKeys.length === 5, "Invalid list length or count");
        for (const entryKey of res.kvdbEntryKeys) {
            assert(!!this.entries.get(entryKey), "Invalid kvdb item");
            this.keysToDelete.push(entryKey);
        }
    }
    
    private async deleteAllFetchedItems() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbEntryDeleteMany({
            kvdbId: this.kvdbId,
            kvdbEntryKeys: this.keysToDelete,
        });
        assert(res.results.length === 5, "");
    }
    
    private async shouldFetchEmptyListOfKvdbEntries() {
        if (!this.kvdbId) {
            throw new Error("kvdbId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbListEntries({
            kvdbId: this.kvdbId,
            limit: 10,
            skip: 0,
            sortOrder: "desc",
            query: {
                "#entryKey": {
                    $startsWith: "myprefix/",
                },
            },
        });
        assert(res.count === 0 && res.kvdbEntries.length === 0, "Unexpected return value from kvdbListItems(");
    }
    
    private async updateContextPolicy() {
        const res = await this.plainApis.contextApi.updateContext({
            contextId: testData.contextId,
            policy: {
                kvdb: {
                    listAll: "all",
                },
            },
        });
        assert(res === "OK", "Invalid response from updateContext(");
    }
    
    private async updateOrCreateKvdbEntryWithForce() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbEntrySet({
            kvdbId: this.kvdbId,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
            kvdbEntryValue: "BBB4536" as types.kvdb.KvdbEntryValue,
            keyId: testData.keyId,
            version: 1 as types.kvdb.KvdbEntryVersion,
            force: true,
        });
        this.entries.set("abc123" as types.kvdb.KvdbEntryKey, "BBB4536");
        assert(res === "OK", "Unexpected return value from kvdbEntrySet(");
    }
    
    private async shouldCreateKvdbEntryWithForceAndInvalidVersion() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.kvdbApi.kvdbEntrySet({
            kvdbId: this.kvdbId,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
            kvdbEntryValue: "BBB4536" as types.kvdb.KvdbEntryValue,
            keyId: testData.keyId,
            version: 30 as types.kvdb.KvdbEntryVersion,
            force: true,
        });
        this.entries.set("abc123" as types.kvdb.KvdbEntryKey, "BBB4536");
        assert(res === "OK", "Unexpected return value from kvdbEntrySet(");
    }
    
    private async getAndValidateKvdbEntryVersion() {
        if (!this.kvdbId) {
            throw new Error("threadId not initialized yet");
        }
        if (this.entries.size === 0) {
            throw new Error("no items added during tests");
        }
        const res = await this.apis.kvdbApi.kvdbEntryGet({
            kvdbId: this.kvdbId,
            kvdbEntryKey: "abc123" as types.kvdb.KvdbEntryKey,
        });
        assert(res.kvdbEntry.kvdbEntryValue === this.entries.get("abc123" as types.kvdb.KvdbEntryKey), "Invalid kvdb item");
        assert(res.kvdbEntry.version === 1, `Invalid version, got: ${res.kvdbEntry.version}`);
    }
}
