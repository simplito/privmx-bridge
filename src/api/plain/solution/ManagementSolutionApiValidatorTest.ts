/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagementSolutionApi } from "./ManagementSolutionApi";
import { ManagementSolutionApiValidator } from "./ManagementSolutionApiValidator";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

export const test = testApi("client", "solution/", ManagementSolutionApi, new ManagementSolutionApiValidator(new TypesValidator()), call => {
    call("getSolution", api => api.getSolution({
        id: "65fd820f0758a54a68558d7c" as types.cloud.SolutionId,
    })).setResult({
        solution: {
            id: "65fd820f0758a54a68558d7c" as types.cloud.SolutionId,
            created: 1726652150623 as types.core.Timestamp,
            name: "My Solution" as types.cloud.SolutionName,
        },
    });
    call("listSolutions", api => api.listSolutions()).setResult({
        list: [{
            id: "65fd820f0758a54a68558d7c" as types.cloud.SolutionId,
            created: 1726652150623 as types.core.Timestamp,
            name: "My Solution" as types.cloud.SolutionName,
        }]
    });
    call("createSolution", api => api.createSolution({
        name: "New solution" as types.cloud.SolutionName,
    })).setResult({
        solutionId: "2v36hhQQjXH74kGHyS7gxcEwWp4C" as types.cloud.SolutionId,
    });
    call("updateSolution", api => api.updateSolution({
        id: "2v36hhQQjXH74kGHyS7gxcEwWp4C" as types.cloud.SolutionId,
        name: "some-solution-name" as types.cloud.SolutionName,
    })).setResult("OK");
    call("deleteSolution", api => api.deleteSolution({
        id: "2v36hhQQjXH74kGHyS7gxcEwWp4C" as types.cloud.SolutionId,
    })).setResult("OK");

});
