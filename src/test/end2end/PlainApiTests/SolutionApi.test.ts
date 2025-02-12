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
import * as assert from "assert";

export class SolutionApiTests extends BaseTestSet {
    
    private newSolutionId?: types.cloud.SolutionId;
    
    @Test()
    async CRUDSolution() {
        this.helpers.authorizePlainApi();
        await this.createNewSolution();
        await this.listAndCheckSolutions();
        await this.updateNewSolution();
        await this.getNewSolutionAndValidateUpdatedFields();
        await this.deleteNewSolution();
        await this.checkIfSolutionWasDeleted();
    }
    
    async createNewSolution() {
        const result = await this.plainApis.solutionApi.createSolution({
            name: "New test solution" as types.cloud.SolutionName,
        });
        
        verifyResponseFor("createSolution", result, ["solutionId"]);
        this.newSolutionId = result.solutionId;
    }
    
    async listAndCheckSolutions() {
        if (!this.newSolutionId) {
            throw new Error("newSolutionId not initialized yet");
        };
        
        const result = await this.plainApis.solutionApi.listSolutions();
        
        verifyResponseFor("listSolutions", result, ["list"]);
        const newSolution = result.list.find(solution => solution.id === this.newSolutionId);
        assert(!!newSolution, "New solution not found");
    }
    
    async updateNewSolution() {
        if (!this.newSolutionId) {
            throw new Error("newSolutionId not initialized yet");
        };
        
        const result = await this.plainApis.solutionApi.updateSolution({
            id: this.newSolutionId,
            name: "updated solution name" as types.cloud.SolutionName,
        });
        
        assert(result === "OK", "updateSolution() invalid response, got: " + JSON.stringify(result, null, 2));
    }
    
    async getNewSolutionAndValidateUpdatedFields() {
        if (!this.newSolutionId) {
            throw new Error("newSolutionId not initialized yet");
        };
        
        const result = await this.plainApis.solutionApi.getSolution({
            id: this.newSolutionId,
        });
        
        assert(!!result && "solution" in result && result.solution.name === "updated solution name", "updateSolution() invalid response, got: " + JSON.stringify(result, null, 2));
    }
    
    async deleteNewSolution() {
        if (!this.newSolutionId) {
            throw new Error("newSolutionId not initialized yet");
        };
        
        const result = await this.plainApis.solutionApi.deleteSolution({
            id: this.newSolutionId,
        });
        
        assert(result === "OK", "updateSolution() invalid response, got: " + JSON.stringify(result, null, 2));
    }
    
    async checkIfSolutionWasDeleted() {
        if (!this.newSolutionId) {
            throw new Error("newSolutionId not initialized yet");
        };
        
        const result = await this.plainApis.solutionApi.listSolutions();
        
        verifyResponseFor("listSolutions", result, ["list"]);
        const newSolution = result.list.find(solution => solution.id === this.newSolutionId);
        assert(!newSolution, "Deleted solution was found");
    }
}