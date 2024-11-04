/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseApi } from "../../../api/BaseApi";
import { ManagementSolutionApiValidator } from "./ManagementSolutionApiValidator";
import * as managementSolutionApi from "./ManagementSolutionApiTypes";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { AppException } from "../../../api/AppException";
import { ApiMethod } from "../../../api/Decorators";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import { SolutionService } from "../../../service/cloud/SolutionService";

export class ManagementSolutionApi extends BaseApi implements managementSolutionApi.ISolutionApi {
    
    constructor(
        solutionApiValidator: ManagementSolutionApiValidator,
        private authorizationDetector: AuthorizationDetector,
        private authorizationHolder: AuthorizationHolder,
        private solutionService: SolutionService,
    ) {
        super(solutionApiValidator);
    }
    
    async validateAccess() {
        await this.authorizationDetector.authorize();
        if (!this.authorizationHolder.isAuthorized()) {
            throw new AppException("UNAUTHORIZED");
        }
    }
    
    @ApiMethod({errorCodes: ["SOLUTION_DOES_NOT_EXIST"]})
    async getSolution(model: managementSolutionApi.GetSolutionModel): Promise<managementSolutionApi.GetSolutionResult> {
        this.validateScope("solution");
        const solution = await this.solutionService.getSolution(model.id);
        return {solution: this.convertSolution(solution)};
    }
    
    @ApiMethod({})
    async listSolutions(): Promise<managementSolutionApi.ListSolutionsResult> {
        this.validateScope("solution");
        const solutions = await this.solutionService.listSolutions();
        return {list: solutions.map(x => this.convertSolution(x))};
    }
    
    @ApiMethod({})
    async createSolution(model: managementSolutionApi.CreateSolutionModel): Promise<managementSolutionApi.CreateSolutionResult> {
        this.validateScope("solution");
        const solution = await this.solutionService.createSolution(model.name);
        return {solutionId: solution.id};
    }
    
    @ApiMethod({errorCodes: ["SOLUTION_DOES_NOT_EXIST"]})
    async updateSolution(model: managementSolutionApi.UpdateSolutionModel): Promise<types.core.OK> {
        this.validateScope("solution");
        await this.solutionService.updateSolution(model.id, model.name);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["SOLUTION_DOES_NOT_EXIST"]})
    async deleteSolution(model: managementSolutionApi.DeleteSolutionModel): Promise<types.core.OK> {
        this.validateScope("solution");
        await this.solutionService.deleteSolution(model.id);
        return "OK";
    }
    
    private validateScope(scope: string) {
        const auth = this.authorizationHolder.getAuth();
        if (!auth) {
            throw new AppException("UNAUTHORIZED");
        }
        const scopes = auth.session ? auth.session.scopes : auth.apiKey.scopes;
        if (!scopes.includes(scope as types.auth.Scope)) {
            throw new AppException("INSUFFICIENT_SCOPE", scope);
        }
    }
    
    private convertSolution(solution: db.solution.Solution) {
        const res: managementSolutionApi.Solution = {
            id: solution.id,
            created: solution.created,
            name: solution.name,
        };
        return res;
    }
}
