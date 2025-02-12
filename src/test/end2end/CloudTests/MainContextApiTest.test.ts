/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, Test } from "../BaseTestSet";
import { testData } from "../../datasets/testData";
import * as types from "../../../types";
import { ECUtils } from "../../../utils/crypto/ECUtils";
import * as PrivmxRpc from "privmx-rpc";
import * as assert from "assert";

export class MainContextApiTests extends BaseTestSet {
    
    private newUserId?: types.cloud.UserId;
    private newUserPubkey?: types.core.EccPubKey;
    private newUserPrivKey?: string;
    private newUserConnection?: PrivmxRpc.AuthorizedConnection;
    
    @Test()
    async shouldFetchContextUsersWithStatus() {
        await this.createNewUser();
        await this.fetchUsersAndCheckIfNewUserIsInactive();
        await this.loginAsNewUser();
        await this.fetchUsersAndCheckIfNewUserIsActive();
        await this.closeNewUserConnection();
        await this.fetchUsersAndCheckIfNewUserIsInactive();
    }
    
    private async createNewUser() {
        const keys = ECUtils.generateKeyPair();
        this.newUserPubkey = ECUtils.publicToBase58DER(keys.keyPair);
        this.newUserId = "NewUser" as types.cloud.UserId;
        this.newUserPrivKey = keys.privWif;
        this.helpers.authorizePlainApi();
        const res = await this.plainApis.contextApi.addUserToContext({contextId: testData.contextId, userId: this.newUserId, userPubKey: this.newUserPubkey});
        assert(res === "OK", "Invalid response from addUserToContext()");
    }
    
    private async fetchUsersAndCheckIfNewUserIsActive() {
        const res = await this.apis.contextApi.contextGetUsers({
            contextId: testData.contextId,
        });
        assert(!!res.users && res.users.length === 2, "contextGetUsers invalid response");
        const user = res.users.find(u => u.id === "NewUser");
        assert(!!user && user.status === "active", "Invalid new user status");
    }
    
    private async fetchUsersAndCheckIfNewUserIsInactive() {
        const res = await this.apis.contextApi.contextGetUsers({
            contextId: testData.contextId,
        });
        assert(!!res.users && res.users.length === 2, "contextGetUsers invalid response");
        const user = res.users.find(u => u.id === "NewUser");
        assert(!!user && user.status === "inactive", "Invalid new user status");
    }
    
    private async loginAsNewUser() {
        if (!this.newUserPrivKey) {
            throw new Error("newUserPrivKey not initialized yet!");
        }
        this.newUserConnection = await this.helpers.createNewConnection(this.newUserPrivKey, testData.solutionId);
    }
    
    private async closeNewUserConnection() {
        if (!this.newUserConnection) {
            throw new Error("newUserConnection not initialized yet!");
        }
        this.newUserConnection.destroy();
    }
}
