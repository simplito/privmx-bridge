/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, Test, verifyResponseFor, verifyResponseIsOK } from "../BaseTestSet";
import * as types from "../../../types";
import * as assert from "assert";
import { testData } from "../../datasets/testData";

export class ManagementKvdbApiTest extends BaseTestSet {
    
    private newKvdbs: types.kvdb.KvdbId[] = [];
    private newKvdbEntriesKeys: types.kvdb.KvdbEntryKey[] = [];
    
    @Test()
    async shouldGetKvdb() {
        this.helpers.authorizePlainApi();
        await this.fetchKvdb();
    }
    
    @Test()
    async shouldDeleteKvdb() {
        this.helpers.authorizePlainApi();
        await this.deleteSingleKvdb();
    }
    
    @Test()
    async shouldDeleteManyKvdbs() {
        this.helpers.authorizePlainApi();
        await this.createNewKvdbs();
        await this.listAllKvdbs();
        await this.deleteAllNewKvdbs();
        await this.validateKvdbCount();
    }
    
    @Test()
    async shouldGetKvdbEntry() {
        this.helpers.authorizePlainApi();
        await this.fetchKvdbEntry();
    }
    
    @Test()
    async shouldDeleteKvdbEntry() {
        this.helpers.authorizePlainApi();
        await this.deleteSingleKvdbEntry();
    }
    
    @Test()
    async shouldListKvdbEntries() {
        this.helpers.authorizePlainApi();
        await this.listAllKvdbEntries();
    }
    
    @Test()
    async shouldDeleteManyKvdbEntries() {
        this.helpers.authorizePlainApi();
        await this.createManyKvdbEntries();
        await this.deleteManyKvdbEntries();
        await this.validateKvdbEntryCount();
    }
    
    @Test()
    async shouldFetchItemsByPrefix() {
        this.helpers.authorizePlainApi();
        await this.createManyKvdbEntries();
        await this.fetchItemsByPrefix();
    }
    
    @Test()
    async shouldFetchEntriesKeys() {
        this.helpers.authorizePlainApi();
        await this.createManyKvdbEntries();
        await this.fetchEntriesKeys();
    }
    
    private async fetchKvdb() {
        const result = await this.plainApis.kvdbApi.getKvdb({
            kvdbId: testData.kvdbId,
        });
        verifyResponseFor("getKvdb", result, ["kvdb"]);
    }
    
    private async listAllKvdbs() {
        const result = await this.plainApis.kvdbApi.listKvdbs({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listKvdbs", result, ["list", "count"]);
        assert(result.count === this.newKvdbs.length + 1);
    }
    
    private async deleteSingleKvdb() {
        const result = await this.plainApis.kvdbApi.deleteKvdb({
            kvdbId: testData.kvdbId,
        });
        verifyResponseIsOK("deleteKvdb", result);
    }
    
    private async createNewKvdbs() {
        for (let i = 0; i < 5; i++) {
            const newKvdb = await this.apis.kvdbApi.kvdbCreate({
                contextId: testData.contextId,
                data: "AAAA" as types.kvdb.KvdbData,
                resourceId: this.helpers.generateResourceId(),
                keyId: testData.keyId,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
            this.newKvdbs.push(newKvdb.kvdbId);
        }
    }
    
    private async deleteAllNewKvdbs() {
        const result = await this.plainApis.kvdbApi.deleteManyKvdbs({
            kvdbIds: this.newKvdbs,
        });
        verifyResponseFor("deleteManyKvdbs", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async validateKvdbCount() {
        const result = await this.plainApis.kvdbApi.listKvdbs({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listKvdbs", result, ["list", "count"]);
        assert(result.count === 1);
    }
    
    private async fetchKvdbEntry() {
        const result = await this.plainApis.kvdbApi.getKvdbEntry({
            kvdbId: testData.kvdbId,
            kvdbEntryKey: testData.kvdbEntryKey,
        });
        verifyResponseFor("getKvdbEntry", result, ["kvdbEntry"]);
    }
    
    private async listAllKvdbEntries() {
        const result = await this.plainApis.kvdbApi.listKvdbEntries({
            from: null,
            prefix: "",
            limit: 10,
            sortOrder: "asc",
            kvdbId: testData.kvdbId,
        });
        verifyResponseFor("listKvdbEntry", result, ["list", "count"]);
        assert(result.count === this.newKvdbEntriesKeys.length + 1);
    }
    
    private async createManyKvdbEntries() {
        for (let i = 0; i < 5; i++) {
            const result = await this.apis.kvdbApi.kvdbEntrySet({
                kvdbEntryKey: `myprefix/abc${i}` as types.kvdb.KvdbEntryKey,
                kvdbEntryValue: "New Data!",
                keyId: testData.keyId,
                kvdbId: testData.kvdbId,
            });
            assert(result === "OK", "Unexpected response from kvdbEntrySet(");
            this.newKvdbEntriesKeys.push(`myprefix/abc${i}` as types.kvdb.KvdbEntryKey);
        }
    }
    
    private async deleteManyKvdbEntries() {
        const result = await this.plainApis.kvdbApi.deleteManyKvdbEntries({
            kvdbId: testData.kvdbId,
            kvdbEntryKeys: this.newKvdbEntriesKeys,
        });
        verifyResponseFor("deleteManyKvdbEntries", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async validateKvdbEntryCount() {
        const result = await this.plainApis.kvdbApi.listKvdbEntries({
            kvdbId: testData.kvdbId,
            prefix: "",
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listKvdbs", result, ["kvdb", "list", "count"]);
        assert(result.count === 1);
    }
    
    private async deleteSingleKvdbEntry() {
        const result = await this.plainApis.kvdbApi.deleteKvdbEntry({
            kvdbId: testData.kvdbId,
            kvdbEntryKey: testData.kvdbEntryKey,
        });
        verifyResponseIsOK("deleteKvdbEntry", result);
    }
    
    private async fetchItemsByPrefix() {
        const res = await this.plainApis.kvdbApi.listKvdbEntries({
            kvdbId: testData.kvdbId,
            from: null,
            limit: 10,
            prefix: "myprefix/",
            sortOrder: "desc",
        });
        assert(res.count === 5 && res.list.length === 5, "Invalid list length or count");
    }
    
    private async fetchEntriesKeys() {
        const res = await this.plainApis.kvdbApi.listKvdbKeys({
            kvdbId: testData.kvdbId,
            from: null,
            limit: 10,
            sortOrder: "desc",
        });
        assert(res.count === 6 && res.list.length === 6, "Invalid list length or count");
    }
}
