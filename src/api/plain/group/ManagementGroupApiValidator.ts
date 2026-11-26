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

export class ManagementGroupApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getGroup", this.builder.createObject({
            groupId: this.tv.groupId,
        }));
        
        this.registerMethod("listGroups", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
        }));
        
        this.registerMethod("listGroupsOfUser", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            userId: this.tv.cloudUserId,
        }));
        
        this.registerMethod("listGroupCommits", this.builder.createObject({
            groupId: this.tv.groupId,
            fromSeq: this.tv.intNonNegative,
            limit: this.builder.range(this.builder.int, 1, 100),
        }));
        
        this.registerMethod("cutHistory", this.builder.createObject({
            groupId: this.tv.groupId,
            beforeEpoch: this.builder.optional(this.builder.min(this.builder.int, 1)),
        }));
        
        this.registerMethod("deleteGroup", this.builder.createObject({
            groupId: this.tv.groupId,
        }));
        
        this.registerMethod("deleteManyGroups", this.builder.createObject({
            groupIds: this.builder.createListWithMaxLength(this.tv.groupId, 128),
        }));
    }
}
