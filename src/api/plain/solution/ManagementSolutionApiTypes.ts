/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface CreateSolutionModel {
    /** solution's name */
    name: types.cloud.SolutionName;
}

export interface CreateSolutionResult {
    /** solution's id */
    solutionId: types.cloud.SolutionId;
}

export interface GetSolutionModel {
    /** solution's id */
    id: types.cloud.SolutionId;
}

export interface GetSolutionResult {
    /** solution's info */
    solution: Solution;
}

export interface ListSolutionsResult {
    /** solutions list */
    list: Solution[];
}

export interface Solution {
    /** solution's id */
    id: types.cloud.SolutionId;
    /** solution's create date timestamp */
    created: types.core.Timestamp;
    /** solution's name */
    name: types.cloud.SolutionName;
}

export interface UpdateSolutionModel {
    /** solution's id */
    id: types.cloud.SolutionId;
    /** solution's name */
    name: types.cloud.SolutionName;
}

export interface DeleteSolutionModel {
    /** solution's id */
    id: types.cloud.SolutionId;
}

export interface ISolutionApi {
    /**
    * Creates solution
    * @param model solution's name, instance's id
    * @returns solution's id
    */
    createSolution(model: CreateSolutionModel): Promise<CreateSolutionResult>;
    
    /**
    * Get solution
    * @param model solution's id
    * @returns solution
    */
    getSolution(model: GetSolutionModel): Promise<GetSolutionResult>;
    
    /**
    * return list of the solutions
    * @returns returns list of solutions
    */
    listSolutions(): Promise<ListSolutionsResult>;
    
    /**
    * Updates solution
    * @param model solution's id, solution's name
    * @returns "OK"
    */
    updateSolution(model: UpdateSolutionModel): Promise<types.core.OK>;
    
    /**
    * Deletes solution
    * @param model solution's id
    * @returns "OK"
    */
    deleteSolution(model: DeleteSolutionModel): Promise<types.core.OK>;
}