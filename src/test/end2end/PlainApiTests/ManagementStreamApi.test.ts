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

export class ManagementStreamApiTest extends BaseTestSet {
    
    private newStreamRooms: types.stream.StreamRoomId[] = [];
    
    @Test()
    async shouldGetStreamRoom() {
        this.helpers.authorizePlainApi();
        await this.fetchStreamRoom();
    }
    
    @Test()
    async shouldDeleteStreamRoom() {
        this.helpers.authorizePlainApi();
        await this.deleteSingleStreamRoom();
    }
    
    @Test()
    async shouldDeleteManyStreamesRoom() {
        this.helpers.authorizePlainApi();
        await this.createNewStreamRooms();
        await this.listAllStreamRooms();
        await this.deleteAllNewStreamRooms();
        await this.validateStreamRoomCount();
    }
    
    private async fetchStreamRoom() {
        const result = await this.plainApis.streamApi.getStreamRoom({
            streamRoomId: testData.streamRoomId,
        });
        verifyResponseFor("getStreamRoom", result, ["streamRoom"]);
    }
    
    private async deleteSingleStreamRoom() {
        const result = await this.plainApis.streamApi.deleteStreamRoom({
            streamRoomId: testData.streamRoomId,
        });
        verifyResponseIsOK("deleteStream", result);
    }
    
    private async createNewStreamRooms() {
        for (let i = 0; i < 5; i++) {
            const newStream = await this.apis.streamApi.streamRoomCreate({
                contextId: testData.contextId,
                keyId: testData.keyId,
                data: {
                    qwe: 1,
                    abc: {zxc: "asdd", bb: "zzwer", u: "sadsad", u1: [1, 2, {a: true}]},
                } as types.stream.StreamRoomData,
                keys: [{user: testData.userId, keyId: testData.keyId, data: "AAAA" as types.core.UserKeyData}],
                managers: [testData.userId],
                users: [testData.userId],
            });
            this.newStreamRooms.push(newStream.streamRoomId);
        }
    }
    
    private async listAllStreamRooms() {
        const result = await this.plainApis.streamApi.listStreamRooms({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listTlistStreameshreads", result, ["list", "count"]);
        assert(result.count === this.newStreamRooms.length + 1);
    }
    
    private async deleteAllNewStreamRooms() {
        const result = await this.plainApis.streamApi.deleteManyStreamRooms({
            streamRoomIds: this.newStreamRooms,
        });
        verifyResponseFor("deleteManyStreames", result, ["results"]);
        assert(result.results.every(x => x.status === "OK"));
    }
    
    private async validateStreamRoomCount() {
        const result = await this.plainApis.streamApi.listStreamRooms({
            contextId: testData.contextId,
            limit: 10,
            sortOrder: "asc",
            from: null,
        });
        verifyResponseFor("listTlistStreameshreads", result, ["list", "count"]);
        assert(result.count === 1);
    }
}