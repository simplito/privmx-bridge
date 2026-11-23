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

export class ManagementSpaceApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getSpace", this.builder.createObject({
            spaceId: this.tv.spaceId,
        }));
        
        this.registerMethod("listSpaces", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
        }));
        
        this.registerMethod("deleteSpace", this.builder.createObject({
            spaceId: this.tv.spaceId,
        }));
    }
}
