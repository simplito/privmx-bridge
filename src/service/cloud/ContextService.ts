/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */
import * as types from "../../types";
import { AppException } from "../../api/AppException";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { CloudUser } from "../../CommonTypes";
import * as managementContextApi from "../../api/plain/context/ManagementContextApiTypes";
import { PolicyService, PolicyUser } from "./PolicyService";
import { CloudAclChecker } from "./CloudAclChecker";
import { ThreadService } from "./ThreadService";
import { StoreService } from "./StoreService";
import { InboxService } from "./InboxService";
import { StreamService } from "./StreamService";
import { DbInconsistencyError } from "../../error/DbInconsistencyError";
import * as db from "../../db/Model";
import { ContextNotificationService } from "./ContextNotificationService";
import { ActiveUsersMap } from "../../cluster/master/ipcServices/ActiveUsers";
export class ContextService {
    
    private policy: ContextPolicy;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
        private policyService: PolicyService,
        private cloudAclChecker: CloudAclChecker,
        private threadService: ThreadService,
        private storeService: StoreService,
        private inboxService: InboxService,
        private streamService: StreamService,
        private contextNotificationService: ContextNotificationService,
        private activeUsersMap: ActiveUsersMap,
    ) {
        this.policy = new ContextPolicy(this.policyService);
    }
    
    async checkSolutionExistance(solutionId: types.cloud.SolutionId) {
        const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
        if (!solution) {
            throw new AppException("SOLUTION_DOES_NOT_EXIST");
        }
    }
    
    async createSolutionsIfNeeded(solutions: types.cloud.SolutionId[]) {
        for (const solutionId of solutions) {
            await this.repositoryFactory.createSolutionRepository().createByIdIfNeeded(solutionId);
        }
    }
    
    async createContext(solutionId: types.cloud.SolutionId, contextName: types.context.ContextName, description: types.context.ContextDescription, scope: types.context.ContextScope, policy: types.context.ContextPolicy) {
        const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
        if (!solution) {
            throw new AppException("SOLUTION_DOES_NOT_EXIST");
        }
        this.policyService.validateContextPolicy(policy);
        return this.repositoryFactory.createContextRepository().create(solutionId, contextName, description, scope, policy);
    }
    
    async updateContext(model: managementContextApi.UpdateContextModel) {
        const {contextId, ...rest} = model;
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        if (rest.policy) {
            this.policyService.validateContextPolicy(rest.policy);
        }
        if (rest.scope) {
            if (context.shares.length > 0 && rest.scope === "private") {
                throw new AppException("CANNOT_SWITCH_CONNECTED_CONTEXT_TO_PRIVATE");
            }
        }
        await this.repositoryFactory.createContextRepository().updateContext(contextId, rest);
    }
    
    async deleteContext(contextId: types.context.ContextId) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.repositoryFactory.createContextRepository().remove(contextId);
        await this.repositoryFactory.createContextUserRepository().removeAllByContextId(contextId);
        
        await this.threadService.deleteThreadsByContext(contextId, context.solution);
        await this.storeService.deleteStoresByContext(contextId, context.solution);
        await this.inboxService.deleteInboxesByContext(contextId, context.solution);
        await this.streamService.deleteStreamRoomsByContext(contextId, context.solution);
    }
    
    async addSolutionToContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
        if (!solution) {
            throw new AppException("SOLUTION_DOES_NOT_EXIST");
        }
        if (context.scope === "private") {
            throw new AppException("CANNOT_ASSIGN_PRIVATE_CONTEXT");
        }
        if (context.solution === solutionId) {
            return;
        }
        await this.repositoryFactory.createContextRepository().addSolutionToContext(contextId, solutionId);
    }
    
    async removeSolutionFromContext(contextId: types.context.ContextId, solutionId: types.cloud.SolutionId) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
        if (!solution) {
            throw new AppException("SOLUTION_DOES_NOT_EXIST");
        }
        if (context.solution === solutionId) {
            throw new AppException("CANNOT_UNASSIGN_CONTEXT_FROM_ITS_PARENT");
        }
        await this.repositoryFactory.createContextRepository().removeSolutionFromContext(contextId, solutionId);
    }
    
    async addUserToContext(contextId: types.context.ContextId, userId: types.cloud.UserId, userPubKey: types.cloud.UserPubKey, acl: types.cloud.ContextAcl) {
        this.cloudAclChecker.checkAcl(acl);
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        await this.repositoryFactory.createContextUserRepository().insertOrUpdate(contextId, userId, userPubKey, acl);
    }
    
    async removeUserFromContext(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        const user = await this.repositoryFactory.createContextUserRepository().get(contextId, userId);
        if (!user) {
            throw new AppException("USER_DOESNT_EXIST");
        }
        await this.repositoryFactory.createContextUserRepository().remove(contextId, userId);
    }
    
    async removeUserFromContextByPubKey(contextId: types.context.ContextId, userPubKey: types.cloud.UserPubKey) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        const users = await this.repositoryFactory.createContextUserRepository().getAllByContextAndUserPubKey(contextId, userPubKey);
        if (users.length === 0) {
            throw new AppException("USER_DOESNT_EXIST");
        }
        await this.repositoryFactory.createContextUserRepository().removeAllByUserPub(contextId, userPubKey);
    }
    
    async getAllForUser(cloudUser: CloudUser, listParams: types.core.ListModel) {
        return cloudUser.solutionId ?
            this.repositoryFactory.createContextUserRepository().getPageByUserPubKeyAndSolution(cloudUser.pub, cloudUser.solutionId, listParams) :
            this.repositoryFactory.createContextUserRepository().getPageByUserPubKey(cloudUser.pub, listParams);
    }
    
    async getContextWithCheckingExistance(contextId: types.context.ContextId) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        return context;
    }
    
    async getContext(cloudUser: CloudUser, contextId: types.context.ContextId) {
        const user = await this.repositoryFactory.createContextUserRepository().getUserFromContext(cloudUser.pub, contextId);
        if (!user) {
            throw new AppException("ACCESS_DENIED");
        }
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new DbInconsistencyError(`Context=${contextId} does not exist, contextUser=${user.id}`);
        }
        if (cloudUser.solutionId) {
            if (context.solution !== cloudUser.solutionId && !context.shares.includes(cloudUser.solutionId)) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        return {context, user};
    }
    
    async listContexts(solutions: false|types.cloud.SolutionId[], model: types.core.ListModel) {
        return solutions === false
            ? this.repositoryFactory.createContextRepository().getPage(model)
            : this.repositoryFactory.createContextRepository().getPageForSolutions(solutions, model);
    }
    
    async getUser(contextId: types.context.ContextId, userId: types.cloud.UserId) {
        const user = await this.repositoryFactory.createContextUserRepository().get(contextId, userId);
        if (!user) {
            throw new AppException("USER_DOESNT_EXIST");
        }
        return user;
    }
    
    async getUserByPub(contextId: types.context.ContextId, userPubKey: types.cloud.UserPubKey) {
        const user = await this.repositoryFactory.createContextUserRepository().getUserFromContext(userPubKey, contextId);
        if (!user) {
            throw new AppException("USER_DOESNT_EXIST");
        }
        return user;
    }
    
    async getUsersOfContext(contextId: types.context.ContextId, model: types.core.ListModel) {
        return this.repositoryFactory.createContextUserRepository().getUsersPageFromContext(contextId, model);
    }
    
    async setUserAcl(contextId: types.context.ContextId, userId: types.cloud.UserId, acl: types.cloud.ContextAcl) {
        this.cloudAclChecker.checkAcl(acl);
        const user = await this.repositoryFactory.createContextUserRepository().get(contextId, userId);
        if (!user) {
            throw new AppException("USER_DOESNT_EXIST");
        }
        await this.repositoryFactory.createContextUserRepository().updateAcl(contextId, userId, acl);
    }
    
    async getAllContextUsers(cloudUser: CloudUser, contextId: types.context.ContextId) {
        const user = await this.repositoryFactory.createContextUserRepository().getUserFromContext(cloudUser.pub, contextId);
        if (!user) {
            throw new AppException("ACCESS_DENIED");
        }
        this.cloudAclChecker.verifyAccess(user.acl, "context/contextSendCustomNotification", ["contextId=" + contextId]);
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new AppException("CONTEXT_DOES_NOT_EXIST");
        }
        if (!this.policy.canListUsers(context)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (cloudUser.solutionId) {
            if (context.solution !== cloudUser.solutionId && !context.shares.includes(cloudUser.solutionId)) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        const users = await this.repositoryFactory.createContextUserRepository().getAllContextUsers(contextId);
        const usersState = await this.activeUsersMap.getUsersState({userPubkeys: users.map(u => u.userPubKey), solutionIds: [context.solution, ...context.shares]});
        return users.map((contextUser, index) => ({ ...contextUser, ...usersState[index] })) as db.context.ContextUserWithStatus[];
    }
    
    async sendCustomNotification(cloudUser: CloudUser, contextId: types.context.ContextId, data: unknown, customChannelName: types.core.WsChannelName,  usersWithEncryptionKey: {id: types.cloud.UserId, key: types.core.UserKeyData}[]) {
        const user = await this.repositoryFactory.createContextUserRepository().getUserFromContext(cloudUser.pub, contextId);
        if (!user) {
            throw new AppException("ACCESS_DENIED");
        }
        this.cloudAclChecker.verifyAccess(user.acl, "context/contextSendCustomNotification", ["contextId=" + contextId]);
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        if (!context) {
            throw new DbInconsistencyError(`Context=${contextId} does not exist, contextUser=${user.id}`);
        }
        if (!this.policy.canSendContextCustomNotification(context)) {
            throw new AppException("ACCESS_DENIED");
        }
        if (cloudUser.solutionId) {
            if (context.solution !== cloudUser.solutionId && !context.shares.includes(cloudUser.solutionId)) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        const usersWithPubKey = await this.repositoryFactory.createContextUserRepository().getUsers(contextId, usersWithEncryptionKey.map(e => e.id));
        const users = this.mergeUsersArrays(usersWithPubKey, usersWithEncryptionKey);
        this.contextNotificationService.sendContextCustomEvent(contextId, data, {id: user.userId, pub: user.userPubKey}, customChannelName, users);
    }
    
    private mergeUsersArrays(usersWithPubKey: db.context.ContextUser[], usersWithEncryptionKey: {id: types.cloud.UserId, key: types.core.UserKeyData}[]): {id: types.cloud.UserId, key: types.core.UserKeyData, pubKey: types.core.EccPubKey}[] {
        return usersWithEncryptionKey.map(user => {
            const userWithPubKey = usersWithPubKey.find(x => x.userId === user.id);
            if (!userWithPubKey) {
                throw new AppException("USER_DOESNT_EXIST");
            }
            return {
                id: user.id,
                key: user.key,
                pubKey: userWithPubKey.userPubKey,
            };
        });
      }
}

class ContextPolicy {
    
    constructor(
        private policyService: PolicyService,
    ) {
    }
    
    canSendContextCustomNotification(context: db.context.Context) {
        return this.isContextInnerPolicyMet(context, p => p?.sendCustomNotification);
    }
    
    canListUsers(context: db.context.Context) {
        return this.isContextInnerPolicyMet(context, p => p?.listUsers);
    }
    
    private isContextInnerPolicyMet(context: db.context.Context, func: (policy: types.cloud.ContextInnerPolicy) => types.cloud.PolicyEntry|undefined) {
        return this.policyService.isPolicyMet(this.getEmptyPolicyUser(), context, policy => func(this.extractPolicyFromContext(policy)));
    }
    
    private getEmptyPolicyUser() {
        const res: PolicyUser = {
            user: false,
            manager: false,
            owner: false,
            itemOwner: false,
        };
        return res;
    }
    
    private extractPolicyFromContext(policy: types.context.ContextPolicy) {
        return policy?.context || {};
    }
}
