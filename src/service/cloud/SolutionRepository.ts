/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoObjectRepository } from "../../db/mongo/MongoObjectRepository";
import * as types from "../../types";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";
import { Crypto } from "../../utils/crypto/Crypto";

export class SolutionRepository {
    
    static readonly COLLECTION_NAME = "solution";
    static readonly COLLECTION_ID_PROP = "id";
    
    constructor(
        private repository: MongoObjectRepository<types.cloud.SolutionId, db.solution.Solution>,
    ) {
    }
    
    async get(id: types.cloud.SolutionId) {
        return this.repository.get(id);
    }
    
    async getAll() {
        return this.repository.getAll();
    }
    
    async create(name: types.cloud.SolutionName) {
        const solution: db.solution.Solution = {
            id: Crypto.uuidv4() as types.cloud.SolutionId,
            created: DateUtils.now(),
            name: name,
        };
        await this.repository.insert(solution);
        return solution;
    }
    
    async createByIdIfNeeded(id: types.cloud.SolutionId) {
        const solution = await this.repository.get(id);
        if (solution) {
            return solution;
        }
        const newSolution: db.solution.Solution = {
            id: id,
            created: DateUtils.now(),
            name: "MySolution" as types.cloud.SolutionName,
        };
        await this.repository.insert(newSolution);
        return newSolution;
    }
    
    async update(solution: db.solution.Solution, solutionName: types.cloud.SolutionName) {
        const newSolution: db.solution.Solution = {
            ...solution,
            name: solutionName,
        };
        await this.repository.update(newSolution);
    }
    
    async remove(id: types.cloud.SolutionId) {
        await this.repository.delete(id);
    }
}
