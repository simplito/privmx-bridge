/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../../api/BaseValidator";
import { TypesValidator } from "../../../api/TypesValidator";

export class ManagementContextApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("getContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
        }));
        
        this.registerMethod("listContexts", this.tv.listModel);
        
        this.registerMethod("listContextsOfSolution", this.builder.addFields(this.tv.listModel, {
            solutionId: this.tv.cloudSolutionId,
        }));
        
        this.registerMethod("createContext", this.builder.createObject({
            solution: this.tv.cloudSolutionId,
            name: this.tv.contextName,
            description: this.tv.contextDescription,
            scope: this.tv.contextScope,
            policy: this.builder.optional(this.tv.contextPolicy),
        }));
        
        this.registerMethod("updateContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            name: this.builder.optional(this.tv.contextName),
            description: this.builder.optional(this.tv.contextDescription),
            scope: this.builder.optional(this.tv.contextScope),
            policy: this.builder.optional(this.tv.contextPolicy),
        }));
        
        this.registerMethod("deleteContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
        }));
        
        this.registerMethod("addSolutionToContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            solutionId: this.tv.cloudSolutionId,
        }));
        
        this.registerMethod("removeSolutionFromContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            solutionId: this.tv.cloudSolutionId,
        }));
        
        this.registerMethod("addUserToContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            userId: this.tv.cloudUserId,
            userPubKey: this.tv.cloudUserPubKey,
            acl: this.builder.optional(this.tv.contextAcl),
        }));
        
        this.registerMethod("removeUserFromContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            userId: this.tv.cloudUserId,
        }));
        
        this.registerMethod("removeUserFromContextByPubKey", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            userPubKey: this.tv.cloudUserPubKey,
        }));
        
        this.registerMethod("getUserFromContext", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            userId: this.tv.cloudUserId,
        }));
        
        this.registerMethod("getUserFromContextByPubKey", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            pubKey: this.tv.cloudUserPubKey,
        }));
        
        this.registerMethod("listUsersFromContext", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
        }));
        
        this.registerMethod("setUserAcl", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            userId: this.tv.cloudUserId,
            acl: this.tv.contextAcl,
        }));
    }
}
