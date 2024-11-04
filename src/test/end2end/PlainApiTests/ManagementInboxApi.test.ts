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

export class ManagementInboxApiTest extends BaseTestSet {
    
    private newInboxes: types.inbox.InboxId[] = [];
    
    @Test()
    async shouldGetInbox() {
        this.helpers.authorizePlainApi();
        await this.fetchInbox();
    }
    
    @Test()
    async shouldDeleteInbox() {
        this.helpers.authorizePlainApi();
        await this.deleteSingleInbox();
    }
    
    @Test()
    async shouldDeleteManyInboxes() {
        this.helpers.authorizePlainApi();
        await this.createNewInboxes();
        await this.listAllInboxes();
        await this.deleteAllNewInboxes();
        await this.validateInboxCount();
    }
    
    private async fetchInbox() {
        const result = await this.plainApis.inboxApi.getInbox({
            inboxId: testData.inboxId,
        });
        verifyResponseFor("getInbox", result, ["inbox"]);
    }
    
    private async deleteSingleInbox() {
        const result = await this.plainApis.inboxApi.deleteInbox({
            inboxId: testData.inboxId,
        });
        verifyResponseIsOK("deleteInbox", result);
    }
    
    private async createNewInboxes() {
        for (let i = 0; i < 5; i++) {
            const newInbox = await this.apis.inboxApi.inboxCreate({
                contextId: testData.contextId,
                keyId: testData.keyId,
                data: {
                    threadId: testData.threadId,
                    storeId: testData.storeId,
                    fileConfig: {minCount: 0, maxCount: 0, maxFileSize: 0, maxWholeUploadSize: 0},
                    meta: "aaaa" as types.inbox.InboxMeta,
                    publicData: "aaaa" as types.inbox.InboxPublicData,
                },
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
            this.newInboxes.push(newInbox.inboxId);
        }
    }
    
    private async listAllInboxes() {
        const result = await this.plainApis.inboxApi.listInboxes({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listTlistInboxeshreads", result, ["list", "count"]);
        assert(result.count === this.newInboxes.length + 1);
    }
    
    private async deleteAllNewInboxes() {
        const result = await this.plainApis.inboxApi.deleteManyInboxes({
            inboxIds: this.newInboxes,
        });
        verifyResponseFor("deleteManyInboxes", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async validateInboxCount() {
        const result = await this.plainApis.inboxApi.listInboxes({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listTlistInboxeshreads", result, ["list", "count"]);
        assert(result.count === 1);
    }
}
