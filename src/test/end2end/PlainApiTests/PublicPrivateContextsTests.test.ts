/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { testData } from "../../datasets/testData";
import { BaseTestSet, Test, verifyResponseFor } from "../BaseTestSet";
import * as assert from "assert";
import * as types from "../../../types";

export class PublicPrivateContextsTests extends BaseTestSet {
    private newSolutionId?: types.cloud.SolutionId;
    private newPublicContext?: types.context.ContextId;
    private newPrivateContext?: types.context.ContextId;
    
    @Test()
    async PublicContextShouldBeFound() {
        this.helpers.authorizePlainApi();
        await this.createNewSolution();
        await this.createNewPublicContext();
        await this.addSolutionToContext();
        await this.listContextsAndCheckForNewPublicOne();
    }
    @Test()
    async PrivateContextShouldntBeFound() {
        this.helpers.authorizePlainApi();
        await this.createNewSolution();
        await this.createNewPrivateContext();
        await this.listContextsAndCheckForNewPrivateOne();
    }
    async createNewSolution() {
        const result = await this.plainApis.solutionApi.createSolution({
            name: "New test solution" as types.cloud.SolutionName,
        });
        verifyResponseFor("createSolution", result, ["solutionId"]);
        this.newSolutionId = result.solutionId;
    }
    async createNewPublicContext() {
        const result = await this.plainApis.contextApi.createContext({
            name: "New Context" as types.context.ContextName,
            description: "Desc" as types.context.ContextDescription,
            scope: "public",
            solution: this.newSolutionId as types.cloud.SolutionId,
        });
        verifyResponseFor("createContext", result, ["contextId"]);
        this.newPublicContext = result.contextId;
    }
    async addSolutionToContext() {
        await this.plainApis.contextApi.addSolutionToContext({
            solutionId: testData.solutionId as types.cloud.SolutionId,
            contextId: this.newPublicContext as types.context.ContextId,
        });
    }
    async listContextsAndCheckForNewPublicOne() {
        const result = await this.plainApis.contextApi.listContextsOfSolution({
            solutionId: testData.solutionId,
            skip: 0,
            limit: 5,
            sortOrder: "desc",
        });
        verifyResponseFor("listContexts", result, ["count", "list"]);
        const status = {
            found: false,
        };
        for (const context of result.list) {
            if (context.id == this.newPublicContext) {
                status.found = true;
                return;
            }
        }
        assert(status.found === true, "New public context not found in different solition! Expected true");
    }
    async createNewPrivateContext() {
        const result = await this.plainApis.contextApi.createContext({
            name: "New Context" as types.context.ContextName,
            description: "Desc" as types.context.ContextDescription,
            scope: "private",
            solution: this.newSolutionId as types.cloud.SolutionId,
        });
        verifyResponseFor("createContext", result, ["contextId"]);
        this.newPrivateContext = result.contextId;
    }
    async listContextsAndCheckForNewPrivateOne() {
        const result = await this.plainApis.contextApi.listContextsOfSolution({
            solutionId: testData.solutionId,
            skip: 0,
            limit: 5,
            sortOrder: "desc",
        });
        verifyResponseFor("listContexts", result, ["count", "list"]);
        const status = {
            found: false,
        };
        for (const context of result.list) {
            if (context.id == this.newPrivateContext) {
                status.found = true;
                return;
            }
        }
        assert(status.found === false, "New private context found in different solution! Expected false");
    }
};