/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { AppException } from "../../api/AppException";
import * as db from "../../db/Model";
import { RepositoryFactory } from "../../db/RepositoryFactory";

export class SolutionService {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    async getSolution(solutionId: types.cloud.SolutionId): Promise<db.solution.Solution> {
        const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
        if (!solution) {
            throw new AppException("SOLUTION_DOES_NOT_EXIST");
        }
        return solution;
    }
    
    async listSolutions() {
        return this.repositoryFactory.createSolutionRepository().getAll();
    }
    
    async createSolution(solutionName: types.cloud.SolutionName) {
        const solution = await this.repositoryFactory.createSolutionRepository().create(solutionName);
        return solution;
    }
    
    async updateSolution(solutionId: types.cloud.SolutionId, solutionName: types.cloud.SolutionName) {
        const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
        if (!solution) {
            throw new AppException("SOLUTION_DOES_NOT_EXIST");
        }
        await this.repositoryFactory.createSolutionRepository().update(solution, solutionName);
    }
    
    async deleteSolution(solutionId: types.cloud.SolutionId) {
        const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
        if (!solution) {
            throw new AppException("SOLUTION_DOES_NOT_EXIST");
        }
        const contexts = await this.repositoryFactory.createContextRepository().getAllBySolution(solutionId);
        if (contexts.length > 0) {
            throw new AppException("SOLUTION_HAS_CONTEXTS");
        }
        await this.repositoryFactory.createSolutionRepository().remove(solutionId);
    }
}
