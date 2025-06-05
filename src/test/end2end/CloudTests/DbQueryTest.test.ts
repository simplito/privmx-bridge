/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as assert from "assert";
import * as types from "../../../types";
import { testData } from "../../datasets/testData";
import { BaseTestSet, executeWithTimeout, shouldThrowErrorWithCode2, Test } from "../BaseTestSet";
import { DateUtils } from "../../../utils/DateUtils";
import { expect } from "../AssertUtils";

interface DataObject {
    publicMetaObject: {
        field1: string,
        field2: string,
        field3: number;
        field4: boolean;
    }
}

export class DbQueryTest extends BaseTestSet {
    
    private threadId?: types.thread.ThreadId;
    private storeId?: types.store.StoreId;
    
    @Test()
    async searchThreadsForExactMatchTest() {
        await this.createThreads();
        await this.searchThreadsForExactMatch();
    }
    
    @Test()
    async searchStoresForExactMatchTest() {
        await this.createStores();
        await this.searchStoresForExactMatch();
    }
    
    @Test()
    async searchInboxesForExactMatchTest() {
        await this.createInboxes();
        await this.searchInboxesForExactMatch();
    }
    
    @Test()
    async searchStreamRoomsForExactMatchTest() {
        await this.createStreamRooms();
        await this.searchStreamRoomsForExactMatch();
    }
    
    @Test()
    async searchForExactMatchTest() {
        await this.createThreadAndPopulateData();
        await this.searchForExactMatch();
    }
    
    @Test()
    async searchWithMultipleConditionsTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithMultipleConditions();
    }
    
    @Test()
    async searchWithNumericComparisonTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithNumericComparison();
    }
    
    @Test()
    async searchWithInRangeMatchTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithInRangeMatch();
    }
    
    @Test()
    async searchWithAndTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithAndMatch();
    }
    
    @Test()
    async searchWithContainsStringMatchTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithContainsStringMatch();
    }
    
    @Test()
    async searchWithInArrayMatchTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithInArrayMatch();
        await this.searchWithBooleanMatch();
    }
    
    @Test()
    async searchWithBooleanMatchTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithBooleanMatch();
    }
    
    @Test()
    async tryInjectVulnerableRegexPattern() {
        await this.createThreadAndPopulateDataWithMaliciousInput();
        await this.tryInjectVunerablePattern();
    }
    
    @Test()
    async searchWithExistsMatchTest() {
        await this.createThreadAndPopulateData();
        await this.searchWithExistsMatch();
    }
    
    @Test()
    async searchByInvalidDataType() {
        await this.createThreadAndPopulateData();
        await this.trySearchIntWithRegex();
        await this.trySearchStringWithLt();
    }
    
    @Test()
    async trySearchByNotExistingField() {
        await this.createThreadAndPopulateData();
        await this.searchByNotExistingField();
    }
    
    @Test()
    async searchStoreFilesForExactMatch() {
        await this.createNewStoreAndPopulateData();
        await this.searchStoreFilesWithBooleanMatch();
    }
    
    @Test()
    async searchThreadsForExactMatchInRootLevelTest() {
        await this.createThreads();
        await this.searchThreadsForExactMatchInRootLevel();
    }
    
    @Test()
    async getThreadUsingQuery() {
        await this.createThread();
        await this.fetchThreadUsingQuery();
    }
    
    @Test()
    async tryQueryUsingRestrictedFields() {
        await this.createThread();
        await this.tryListThreadUsingRestrictedFieldsInQuery();
    }
    
    private async createThreadAndPopulateDataWithMaliciousInput() {
        const newThread = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        
        this.threadId = newThread.threadId;
        await this.apis.threadApi.threadMessageSend({
            threadId: this.threadId,
            resourceId: this.helpers.generateResourceId(),
            data: {
                publicMetaObject: {
                    field1: "a".repeat(10000) + "!",
                },
                encryptedData: "CCCC",
            } as types.thread.ThreadMessageData,
            keyId: testData.keyId,
        });
    }
    
    private async tryInjectVunerablePattern() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const threadId = this.threadId;
        await executeWithTimeout(async () => {
            const res = await this.apis.threadApi.threadMessagesGet({
                threadId: threadId,
                limit: 10,
                skip: 0,
                sortOrder: "asc",
                query: {
                    field1: {
                        $contains: "^(a+)+$",
                    },
                },
            });
            assert(res.count === 0);
        }, DateUtils.seconds(10));
    }
    
    private async createThreadAndPopulateData() {
        const newThread = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA" as types.thread.ThreadData,
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        
        this.threadId = newThread.threadId;
        
        for (let i = 0; i < 10; i++ ) {
            await this.apis.threadApi.threadMessageSend({
                threadId: this.threadId,
                resourceId: this.helpers.generateResourceId(),
                data: {
                    publicMetaObject: {
                        field1: `AAAA${i % 2}`,
                        field2: `AAAA${i % 3}`,
                        field3: i * 2,
                        field4: false,
                    },
                    encryptedData: "CCCC",
                } as types.thread.ThreadMessageData,
                keyId: testData.keyId,
            });
            await this.apis.threadApi.threadMessageSend({
                threadId: this.threadId,
                resourceId: this.helpers.generateResourceId(),
                data: {
                    publicMetaObject: {
                        field1: `BBBB${i % 2}`,
                        field2: `BBBB${i % 3}`,
                        field3: i,
                    },
                    encryptedData: "CCCC",
                } as types.thread.ThreadMessageData,
                keyId: testData.keyId,
            });
            await this.apis.threadApi.threadMessageSend({
                threadId: this.threadId,
                resourceId: this.helpers.generateResourceId(),
                data: "CCCC" as types.thread.ThreadMessageData,
                keyId: testData.keyId,
            });
        }
    }
    
    private async searchForExactMatch() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: "AAAA0",
            },
        });
        assert(res.count === 5 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field1 === "AAAA0"));
    }
    
    private async searchWithMultipleConditions() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: "AAAA0",
                field2: "AAAA2",
            },
        });
        assert(res.count === 2 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field1 === "AAAA0" && (v.data as DataObject).publicMetaObject.field2 === "AAAA2"));
    }
    
    private async searchWithNumericComparison() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field3: {$lte: 4},
            },
        });
        assert(res.count === 8 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field3 <= 4));
    }
    
    private async searchWithInRangeMatch() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field3: {$lte: 20, $gte: 10},
            },
        });
        assert(res.count === 5 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field3 >= 10 && (v.data as DataObject).publicMetaObject.field3 <= 20));
    }
    
    private async searchWithAndMatch() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                $and: [
                    {field3: {$lte: 20}},
                    {field3: {$gte: 10}},
                ],
            },
        });
        assert(res.count === 5 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field3 >= 10 && (v.data as DataObject).publicMetaObject.field3 <= 20));
    }
    
    private async searchWithContainsStringMatch() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: {
                    $contains: "A0",
                },
            },
        });
        assert(res.count === 5 && res.messages.every(v => !!(v.data as DataObject).publicMetaObject.field1.search("A0")));
    }
    
    private async searchWithInArrayMatch() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: {$in: ["AAAA0", "AAAA1"]},
            },
        });
        assert(res.count === 10 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field1 === "AAAA0" || (v.data as DataObject).publicMetaObject.field1 === "AAAA1"));
    }
    
    private async searchWithBooleanMatch() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field4: false,
            },
        });
        assert(res.count === 10 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field4 === false));
    }
    
    private async searchWithExistsMatch() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field4: {
                    $exists: true,
                },
            },
        });
        assert(res.count === 10 && res.messages.every(v => (v.data as DataObject).publicMetaObject.field4 === false));
    }
    
    private async trySearchIntWithRegex() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                $and: [
                    {field3: {$contains: "AAA"}},
                ],
            },
        });
        assert(!!res && res.count === 0);
    }
    
    private async trySearchStringWithLt() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                $and: [
                    {field1: {$lt: 5}},
                ],
            },
        });
        assert(!!res && res.count === 0);
    }
    
    private async searchByNotExistingField() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        const res = await this.apis.threadApi.threadMessagesGet({
            threadId: this.threadId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                $and: [
                    {field5: {$lt: 5}},
                ],
            },
        });
        assert(!!res && res.count === 0);
    }
    
    private async createThreads() {
        for (let i = 0; i < 10; i++ ) {
            await this.apis.threadApi.threadCreate({
                contextId: testData.contextId2,
                resourceId: this.helpers.generateResourceId(),
                data: {
                    publicMetaObject: {
                        field1: `AAAA${i % 2}`,
                        field2: `AAAA${i % 3}`,
                        field3: i * 2,
                        field4: false,
                    },
                    encryptedData: "CCCC",
                },
                keyId: testData.keyId,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
        }
    }
    
    private async createThread() {
        const res = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId2,
            resourceId: this.helpers.generateResourceId(),
            data: {},
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        assert(!!res && !!res.threadId, "Invalid return value");
        this.threadId = res.threadId;
    }
    
    private async searchThreadsForExactMatch() {
        const res = await this.apis.threadApi.threadList({
            contextId: testData.contextId2,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: "AAAA0",
            },
        });
        expect(res.count).toBe(5);
        res.threads.forEach((v, i) => expect((v.data[v.data.length - 1].data as DataObject).publicMetaObject.field1).withContext(`for index ${i}`).toBe("AAAA0"));
    }
    
    private async createStores() {
        for (let i = 0; i < 10; i++ ) {
            await this.apis.storeApi.storeCreate({
                contextId: testData.contextId2,
                resourceId: this.helpers.generateResourceId(),
                data: {
                    publicMetaObject: {
                        field1: `AAAA${i % 2}`,
                        field2: `AAAA${i % 3}`,
                        field3: i * 2,
                        field4: false,
                    },
                    encryptedData: "CCCC",
                },
                keyId: testData.keyId,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
        }
    }
    
    private async searchStoresForExactMatch() {
        const res = await this.apis.storeApi.storeList({
            contextId: testData.contextId2,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: "AAAA0",
            },
        });
        expect(res.count).toBe(5);
        res.stores.forEach((v, i) => expect((v.data[v.data.length - 1].data as DataObject).publicMetaObject.field1).withContext(`for index ${i}`).toBe("AAAA0"));
    }
    
    private async createStreamRooms() {
        for (let i = 0; i < 10; i++ ) {
            await this.apis.streamApi.streamRoomCreate({
                contextId: testData.contextId2,
                resourceId: this.helpers.generateResourceId(),
                data: {
                    publicMetaObject: {
                        field1: `AAAA${i % 2}`,
                        field2: `AAAA${i % 3}`,
                        field3: i * 2,
                        field4: false,
                    },
                    encryptedData: "CCCC",
                },
                keyId: testData.keyId,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
        }
    }
    
    private async searchStreamRoomsForExactMatch() {
        const res = await this.apis.streamApi.streamRoomList({
            contextId: testData.contextId2,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: "AAAA0",
            },
        });
        expect(res.count).toBe(5);
        res.list.forEach((v, i) => expect((v.data[v.data.length - 1].data as DataObject).publicMetaObject.field1).withContext(`for index ${i}`).toBe("AAAA0"));
    }
    
    private async createInboxes() {
        const threadRes = await this.apis.threadApi.threadCreate({
            contextId: testData.contextId2,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA",
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        const storeRes = await this.apis.storeApi.storeCreate({
            contextId: testData.contextId2,
            resourceId: this.helpers.generateResourceId(),
            data: "AAAA",
            keyId: testData.keyId,
            keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
            managers: [testData.userId],
            users: [testData.userId],
        });
        for (let i = 0; i < 10; i++ ) {
            await this.apis.inboxApi.inboxCreate({
                contextId: testData.contextId2,
                resourceId: this.helpers.generateResourceId(),
                data: {
                    threadId: threadRes.threadId,
                    storeId: storeRes.storeId,
                    fileConfig: {
                        minCount: 0,
                        maxCount: 2,
                        maxFileSize: 999,
                        maxWholeUploadSize: 999,
                    },
                    meta: {
                        publicMetaObject: {
                            field1: `AAAA${i % 2}`,
                            field2: `AAAA${i % 3}`,
                            field3: i * 2,
                            field4: false,
                        },
                        encryptedData: "CCCC",
                    },
                    publicData: "hahahah",
                },
                keyId: testData.keyId,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
        }
    }
    
    private async searchInboxesForExactMatch() {
        const res = await this.apis.inboxApi.inboxList({
            contextId: testData.contextId2,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field1: "AAAA0",
            },
        });
        expect(res.count).toBe(5);
        res.inboxes.forEach((v, i) => expect((v.data[v.data.length - 1].data.meta as DataObject).publicMetaObject.field1).withContext(`for index ${i}`).toBe("AAAA0"));
    }
    
    private async createNewStoreAndPopulateData() {
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
        
        for (let i = 0; i < 10; i++) {
            const request = await this.apis.requestApi.createRequest({files: [{size: 512, checksumSize: 64}]});
            await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(512, "A")});
            await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 1, checksum: Buffer.alloc(64)});
            
            await this.apis.storeApi.storeFileCreate({
                storeId: this.storeId,
                requestId: request.id,
                fileIndex: 0,
                meta: {
                    publicMetaObject: {
                        field1: `AAAA${i % 2}`,
                        field2: `AAAA${i % 3}`,
                        field3: i * 2,
                        field4: false,
                    },
                } as types.store.StoreFileMeta,
                keyId: testData.keyId,
            });
        }
        
        for (let i = 0; i < 10; i++) {
            const request = await this.apis.requestApi.createRequest({files: [{size: 512, checksumSize: 64}]});
            await this.apis.requestApi.sendChunk({requestId: request.id, fileIndex: 0, seq: 0, data: Buffer.alloc(512, "A")});
            await this.apis.requestApi.commitFile({requestId: request.id, fileIndex: 0, seq: 1, checksum: Buffer.alloc(64)});
            
            await this.apis.storeApi.storeFileCreate({
                storeId: this.storeId,
                requestId: request.id,
                fileIndex: 0,
                meta: {
                    publicMetaObject: {
                        field1: `AAAA${i % 2}`,
                        field2: `AAAA${i % 3}`,
                        field3: i * 2,
                        field4: true,
                    },
                } as types.store.StoreFileMeta,
                keyId: testData.keyId,
            });
        }
    }
    
    private async searchStoreFilesWithBooleanMatch() {
        if (!this.storeId) {
            throw new Error("storeId not initialized yet");
        }
        const res = await this.apis.storeApi.storeFileList({
            storeId: this.storeId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                field4: false,
            },
        });
        assert(res.count === 10 && res.files.every(v => (v.meta as DataObject).publicMetaObject.field4 === false));
    }
    
    private async searchThreadsForExactMatchInRootLevel() {
        const res = await this.apis.threadApi.threadList({
            contextId: testData.contextId2,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                "#creator": testData.userId,
            },
        });
        expect(res.count).toBe(10);
    }
    
    private async fetchThreadUsingQuery() {
        if (!this.threadId) {
            throw new Error("threadId not initialized yet");
        }
        
        const res = await this.apis.threadApi.threadList({
            contextId: testData.contextId2,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                "#id": this.threadId,
            },
        });
        
        assert(res.count === 1, "invalid count");
        assert(res.threads[0].id === this.threadId, "invalid thread");
    }
    
    private async tryListThreadUsingRestrictedFieldsInQuery() {
        await shouldThrowErrorWithCode2(async () => this.apis.threadApi.threadList({
            contextId: testData.contextId2,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
            query: {
                "#keyId": testData.keyId,
            },
        }), "INVALID_PARAMS");
    }
}
