/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseApi } from "../../../api/BaseApi";
import * as managementContextApi from "./ManagementContextApiTypes";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { AppException } from "../../../api/AppException";
import { ApiMethod } from "../../../api/Decorators";
import { AuthorizationDetector } from "../../../service/auth/AuthorizationDetector";
import { AuthorizationHolder } from "../../../service/auth/AuthorizationHolder";
import { ContextService } from "../../../service/cloud/ContextService";
import { ManagementContextApiValidator } from "./ManagementContextApiValidator";

export class ManagementContextApi extends BaseApi implements managementContextApi.IContextApi {
    
    constructor(
        contextApiValidator: ManagementContextApiValidator,
        private authorizationDetector: AuthorizationDetector,
        private authorizationHolder: AuthorizationHolder,
        private contextService: ContextService,
    ) {
        super(contextApiValidator);
    }
    
    async validateAccess() {
        await this.authorizationDetector.authorize();
        if (!this.authorizationHolder.isAuthorized()) {
            throw new AppException("UNAUTHORIZED");
        }
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"]})
    async getContext(model: managementContextApi.GetContextModel): Promise<managementContextApi.GetContextResult> {
        await this.checkIfHasAccessToContext(model.contextId);
        const context = await this.contextService.getContextWithCheckingExistance(model.contextId);
        return {context: this.convertContext(context)};
    }
    
    @ApiMethod({})
    async listContexts(model: managementContextApi.ListContextsModel): Promise<managementContextApi.ListContextsResult> {
        this.validateScope("context");
        const solutions = this.getSolutionsToWhichUserIsLimited();
        const contexts = await this.contextService.listContexts(solutions, model);
        return {list: contexts.list.map(x => this.convertContext(x)), count: contexts.count};
    }
    
    @ApiMethod({errorCodes: ["SOLUTION_DOES_NOT_EXIST"]})
    async listContextsOfSolution(model: managementContextApi.ListContextsOfSolutionModel): Promise<managementContextApi.ListContextsResult> {
        await this.checkIfHasAccessToAllSolutions([model.solutionId]);
        await this.contextService.checkSolutionExistance(model.solutionId);
        const contexts = await this.contextService.listContexts([model.solutionId], model);
        return {list: contexts.list.map(x => this.convertContext(x)), count: contexts.count};
    }
    
    @ApiMethod({errorCodes: ["SOLUTION_DOES_NOT_EXIST"]})
    async createContext(model: managementContextApi.CreateContextModel): Promise<managementContextApi.CreateContextResult> {
        await this.checkIfHasAccessToAllSolutions([model.solution]);
        const context = await this.contextService.createContext(model.solution, model.name, model.description, model.scope, model.policy || {});
        return {contextId: context.id};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST", "CANNOT_SWITCH_CONNECTED_CONTEXT_TO_PRIVATE"]})
    async updateContext(model: managementContextApi.UpdateContextModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        await this.contextService.updateContext(model);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"]})
    async deleteContext(model: managementContextApi.DeleteContextModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        await this.contextService.deleteContext(model.contextId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST", "SOLUTION_DOES_NOT_EXIST", "CANNOT_ASSIGN_PRIVATE_CONTEXT"]})
    async addSolutionToContext(model: managementContextApi.AddSolutionToContextModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        await this.contextService.addSolutionToContext(model.contextId, model.solutionId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST", "SOLUTION_DOES_NOT_EXIST", "CANNOT_UNASSIGN_CONTEXT_FROM_ITS_PARENT"]})
    async removeSolutionFromContext(model: managementContextApi.RemoveSolutionFromContextModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        await this.contextService.removeSolutionFromContext(model.contextId, model.solutionId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"]})
    async addUserToContext(model: managementContextApi.AddUserToContextModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        const acl = "acl" in model ? model.acl : "ALLOW ALL" as types.cloud.ContextAcl;
        await this.contextService.addUserToContext(model.contextId, model.userId, model.userPubKey, acl);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"]})
    async removeUserFromContext(model: managementContextApi.RemoveUserFromContextModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        await this.contextService.removeUserFromContext(model.contextId, model.userId);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"]})
    async removeUserFromContextByPubKey(model: managementContextApi.RemoveUserFromContextByPubKeyModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        await this.contextService.removeUserFromContextByPubKey(model.contextId, model.userPubKey);
        return "OK";
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST", "USER_DOESNT_EXIST"]})
    async getUserFromContext(model: managementContextApi.GetUserFromContextModel): Promise<managementContextApi.GetUserFromContextResult> {
        await this.checkIfHasAccessToContext(model.contextId);
        const user = await this.contextService.getUser(model.contextId, model.userId);
        return {user: this.convertContextUser(user)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST", "USER_DOESNT_EXIST"]})
    async getUserFromContextByPubKey(model: managementContextApi.GetUserFromContextByPubKeyModel): Promise<managementContextApi.GetUserFromContextResult> {
        await this.checkIfHasAccessToContext(model.contextId);
        const user = await this.contextService.getUserByPub(model.contextId, model.pubKey);
        return {user: this.convertContextUser(user)};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST"]})
    async listUsersFromContext(model: managementContextApi.ListUsersFromContextModel): Promise<managementContextApi.ListUsersFromContextResult> {
        await this.checkIfHasAccessToContext(model.contextId);
        const users = await this.contextService.getUsersOfContext(model.contextId, model);
        return {users: users.list.map(x => this.convertContextUser(x)), count: users.count};
    }
    
    @ApiMethod({errorCodes: ["CONTEXT_DOES_NOT_EXIST", "USER_DOESNT_EXIST"]})
    async setUserAcl(model: managementContextApi.SetUserAclModel): Promise<types.core.OK> {
        await this.checkIfHasAccessToContext(model.contextId);
        await this.contextService.setUserAcl(model.contextId, model.userId, model.acl);
        return "OK";
    }
    
    private convertContext(context: db.context.Context) {
        const res: managementContextApi.Context = {
            id: context.id,
            created: context.created,
            modified: context.modified,
            solution: context.solution,
            shares: context.shares,
            name: context.name,
            description: context.description,
            scope: context.scope,
            policy: context.policy || {},
        };
        return res;
    }
    
    private convertContextUser(contextUser: db.context.ContextUser) {
        const res: managementContextApi.ContextUser = {
            userId: contextUser.userId,
            pubKey: contextUser.userPubKey,
            created: contextUser.created,
            acl: contextUser.acl,
            contextId: contextUser.contextId,
        };
        return res;
    }
    
    private async checkIfHasAccessToAllSolutions(solList: types.cloud.SolutionId[]) {
        this.validateScope("context");
        const solutions = this.getSolutionsToWhichUserIsLimited();
        if (solutions === false) {
            return;
        }
        if (!solList.every(x => solutions.includes(x))) {
            throw new AppException("ACCESS_DENIED");
        }
    }
    
    private async checkIfHasAccessToContext(contextId: types.context.ContextId) {
        this.validateScope("context");
        const solutions = this.getSolutionsToWhichUserIsLimited();
        if (solutions === false) {
            return;
        }
        const context = await this.contextService.getContextWithCheckingExistance(contextId);
        if (!solutions.includes(context.solution) && !context.shares.find(x => solutions.includes(x))) {
            throw new AppException("ACCESS_DENIED");
        }
    }
    
    private getSolutionsToWhichUserIsLimited() {
        const solutions: types.cloud.SolutionId[] = [];
        const auth = this.authorizationHolder.getAuth();
        if (!auth) {
            throw new AppException("INSUFFICIENT_SCOPE");
        }
        const scopes = auth.session ? auth.session.scopes : auth.apiKey.scopes;
        for (const scope of scopes) {
            if (scope.startsWith("solution:")) {
                solutions.push(scope.substring("solution:".length) as types.cloud.SolutionId);
            }
        }
        return solutions.includes("*" as types.cloud.SolutionId) || solutions.length === 0 ? false : solutions;
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
}
