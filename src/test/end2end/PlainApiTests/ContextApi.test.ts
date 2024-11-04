/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseTestSet, Test, verifyResponseFor } from "../BaseTestSet";
import * as types from "../../../types";
import { testData } from "../../datasets/testData";
import * as assert from "assert";

export class ContextApiTests extends BaseTestSet {
    
    private newContextId?: types.context.ContextId;
    private contextListLength: number;

    @Test()
    async shouldCreateNewContext() {
        this.helpers.authorizePlainApi();
        await this.listContexts();
        await this.createNewContext();
        await this.listContextsAndCompare();
        await this.listContextsOfSolution();
        await this.updateContextDescription();
        await this.getNewContextAndCheckDescription();
        await this.deleteNewContext();
        await this.validateIfContextHasBeenDeleted();
    }
    
    @Test()
    async shouldAddAndRemoveUser() {
        this.helpers.authorizePlainApi();
        await this.createNewContext();
        await this.addUserToNewContext();
        await this.checkNewContextUsers();
        await this.getUserById();
        await this.removeUserFromContext();
        await this.validateIfUserIsDeleted();
    }
    
    @Test()
    async shouldAddAndRemoveUserByPubkey() {
        this.helpers.authorizePlainApi();
        await this.createNewContext();
        await this.addUserToNewContext();
        await this.getUserByPubkey();
        await this.removeUserFromContextByPubkey();
        await this.validateIfUserIsDeleted();
    }
    
    @Test()
    async shouldSetUserAcl() {
        this.helpers.authorizePlainApi();
        await this.createNewContext();
        await this.addUserToNewContext();
        await this.addUserAcl();
        await this.validateAclUpdate();
    }
    
    @Test()
    async shouldAddAndRemoveSolution() {
        this.helpers.authorizePlainApi();
        await this.createNewContext();
        await this.addSolutionToNewContext();
        await this.checkContextShares();
        await this.removeSolutionFromContext();
        await this.validateIfSolutionIsDeleted();
    }

    async listContexts() {
        const result = await this.plainApis.contextApi.listContexts({
            limit: 10,
            skip: 0,
            sortOrder: "asc",
        });
        
        verifyResponseFor("listContexts", result, ["count",  "list"]);
        this.contextListLength = result.count;
    }

    async listContextsOfSolution() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.listContextsOfSolution({
            solutionId: testData.solutionId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
        });

        verifyResponseFor("listContextsOfSolution", result, ["count", "list"]);
        const newContext = result.list.find(context => context.id === this.newContextId);
        assert(!!newContext, "New context not found");
    }

    async createNewContext() {
        const result = await this.plainApis.contextApi.createContext({
            name: "New Context" as types.context.ContextName,
            description: "Desc" as types.context.ContextDescription,
            scope: "public",
            solution: testData.solutionId,
        });
        verifyResponseFor("createContext", result, ["contextId"]);
        this.newContextId = result.contextId;
    }

    async listContextsAndCompare() {
        if (!this.newContextId || !this.contextListLength) {
            throw new Error("newContextId  or contextListLength not initialized yet");
        };

        const result = await this.plainApis.contextApi.listContexts({
            limit: 10,
            skip: 0,
            sortOrder: "asc",
        });
        
        verifyResponseFor("listContexts", result, ["count", "list"]);

        assert(result.count === this.contextListLength + 1, `Unexpected list length, expected: ${this.contextListLength + 1}, got: ${result.count}`);
        const newContext = result.list.find(context => context.id === this.newContextId);
        assert(!!newContext, "New Context not found in the list!");
    }

    async updateContextDescription() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.updateContext({
            contextId: this.newContextId,
            description: "New description!" as types.context.ContextDescription,
        });

        assert(result === "OK", "updateContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async getNewContextAndCheckDescription() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.getContext({
            contextId: this.newContextId
        });

        assert(!!result && !!result.context && result.context.description === "New description!", "getContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async addSolutionToNewContext() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.addSolutionToContext({
            contextId: this.newContextId,
            solutionId: testData.secondSolutionId,
        });

        assert(result === "OK", "getContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async checkContextShares() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.getContext({
            contextId: this.newContextId,
        });

        verifyResponseFor("getContext", result, ["context"]);
        assert(result.context.shares.includes(testData.secondSolutionId), "Solution not found");
    }

    async removeSolutionFromContext() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.removeSolutionFromContext({
            contextId: this.newContextId,
            solutionId: testData.secondSolutionId,
        });

        assert(result === "OK", "removeSolutionFromContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async validateIfSolutionIsDeleted() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.getContext({
            contextId: this.newContextId,
        });

        verifyResponseFor("getContext", result, ["context"]);
        assert(!result.context.shares.includes(testData.secondSolutionId), "Deleted solution found");
    }

    async addUserToNewContext() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };
        
        const result = await this.plainApis.contextApi.addUserToContext({
            contextId: this.newContextId,
            userId: testData.userId,
            userPubKey: testData.userPubKey,
        });

        assert(result === "OK", "addUserToContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async removeUserFromContext() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.removeUserFromContext({
            contextId: this.newContextId,
            userId: testData.userId,
        });

        assert(result === "OK", "removeUserFromContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async removeUserFromContextByPubkey() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.removeUserFromContextByPubKey({
            contextId: this.newContextId,
            userPubKey: testData.userPubKey,
        });

        assert(result === "OK", "removeUserFromContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async validateIfUserIsDeleted() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.listUsersFromContext({
            contextId: this.newContextId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
        });

        verifyResponseFor("listUsersFromContext", result, ["count", "users"]);
        assert(result.count === 0, "Expected users count: 0, got: " + result.count);
    }

    async checkNewContextUsers() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.listUsersFromContext({
            contextId: this.newContextId,
            limit: 10,
            skip: 0,
            sortOrder: "asc",
        });

        verifyResponseFor("listUsersFromContext", result, ["count", "users"]);
        assert(result.count === 1, "Expected users count: 1, got: " + result.count);
        assert(result.users[0].userId === testData.userId, "User mismatch!");
    }

    async getUserById() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.getUserFromContext({
            contextId: this.newContextId,
            userId: testData.userId,
        });

        verifyResponseFor("getUserFromContext", result, ["user"]);
    }

    async getUserByPubkey() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.getUserFromContextByPubKey({
            contextId: this.newContextId,
            pubKey: testData.userPubKey,
        });

        verifyResponseFor("getUserFromContextByPubKey", result, ["user"]);
    }

    async deleteNewContext() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.deleteContext({
            contextId: this.newContextId,
        });
        
        assert(result === "OK", "deleteContext() invalid response" + JSON.stringify(result, null, 2));
    }

    async validateIfContextHasBeenDeleted() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.listContexts({
            limit: 10,
            skip: 0,
            sortOrder: "asc",
        });
        
        verifyResponseFor("listContexts", result, ["count", "list"]);

        assert(result.count === this.contextListLength, `Unexpected list length, expected: ${this.contextListLength}, got: ${result.count}`);
        const newContext = result.list.find(context => context.id === this.newContextId);
        assert(!newContext, "Deleted context found in the list!");
    }

    async addUserAcl() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.setUserAcl({
            contextId: this.newContextId,
            userId: testData.userId,
            acl: "ALLOW store/READ" as types.cloud.ContextAcl,
        });

        assert(result === "OK", "setUserAcl() invalid response, got: " + JSON.stringify(result, null, 2));
    }

    async validateAclUpdate() {
        if (!this.newContextId) {
            throw new Error("newContextId not initialized yet");
        };

        const result = await this.plainApis.contextApi.getUserFromContext({
            contextId: this.newContextId,
            userId: testData.userId,
        });

        verifyResponseFor("getUserFromContext", result, ["user"]);
        assert(result.user.acl === "ALLOW store/READ");
    }
}