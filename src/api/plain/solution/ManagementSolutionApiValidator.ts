/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../BaseValidator";
import { TypesValidator } from "../../TypesValidator";

export class ManagementSolutionApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("createSolution", this.builder.createObject({
            name: this.tv.cloudSolutionName,
        }));
        
        this.registerMethod("getSolution", this.builder.createObject({
            id: this.tv.cloudSolutionId,
        }));
        
        this.registerMethod("listSolutions", this.builder.empty);
        
        this.registerMethod("updateSolution", this.builder.createObject({
            id: this.tv.cloudSolutionId,
            name: this.tv.cloudSolutionName,
        }));
        
        this.registerMethod("deleteSolution", this.builder.createObject({
            id: this.tv.cloudSolutionId,
        }));
    }
}
