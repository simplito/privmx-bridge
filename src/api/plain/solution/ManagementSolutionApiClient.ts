/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Requester } from "../../../CommonTypes";
import * as types from "../../../types";
import * as managementSolutionApi from "./ManagementSolutionApiTypes";

export class ManagementSolutionApiClient implements managementSolutionApi.ISolutionApi {
    
    constructor(
        private requester: Requester,
    ) {}

    async createSolution(model: managementSolutionApi.CreateSolutionModel): Promise<managementSolutionApi.CreateSolutionResult> {
        return await this.requester.request("solution/createSolution", model);
    }

    async getSolution(model: managementSolutionApi.GetSolutionModel): Promise<managementSolutionApi.GetSolutionResult> {
        return await this.requester.request("solution/getSolution", model);
    }

    async listSolutions(): Promise<managementSolutionApi.ListSolutionsResult> {
        return await this.requester.request("solution/listSolutions", {});
    }

    async updateSolution(model: managementSolutionApi.UpdateSolutionModel): Promise<types.core.OK> {
        return await this.requester.request("solution/updateSolution", model);
    }

    async deleteSolution(model: managementSolutionApi.DeleteSolutionModel): Promise<types.core.OK> {
        return await this.requester.request("solution/deleteSolution", model);
    }

}