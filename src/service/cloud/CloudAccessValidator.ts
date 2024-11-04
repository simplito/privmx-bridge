/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { CloudUser, Executor } from "../../CommonTypes";
import { AppException } from "../../api/AppException";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import * as types from "../../types";
import * as db from "../../db/Model";

export class CloudAccessValidator {
    
    constructor(
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    async checkIfCanExecuteInContext(executor: Executor, contextInfo: types.context.ContextId|db.context.Context, onCloudUser: (user: db.context.ContextUser, context: db.context.Context) => Promise<void>|void) {
        const context = await this.getContext(contextInfo);
        if (executor.type === "context") {
            if (executor.contextId !== context.id) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        else if (executor.type === "plain") {
            if (!executor.solutions.includes(context.solution) && !executor.solutions.includes("*" as types.cloud.SolutionId)) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        else if (executor.type === "cloud") {
            const user = await this.repositoryFactory.createContextUserRepository().getUserFromContext(executor.pub, context.id);
            if (!user) {
                throw new AppException("ACCESS_DENIED");
            }
            if (executor.solutionId) {
                if (context.solution !== executor.solutionId && !context.shares.includes(executor.solutionId)) {
                    throw new AppException("ACCESS_DENIED");
                }
            }
            await onCloudUser(user, context);
            executor.setUser(context.id, user.userId);
        }
        return context;
    }
    
    async getUserFromContext(cloudUser: CloudUser, contextId: types.context.ContextId) {
        const context = await this.repositoryFactory.createContextRepository().get(contextId);
        const user = await this.repositoryFactory.createContextUserRepository().getUserFromContext(cloudUser.pub, contextId);
        if (!user) {
            throw new AppException("ACCESS_DENIED");
        }
        if (cloudUser.solutionId) {
            if (context.solution !== cloudUser.solutionId && !context.shares.includes(cloudUser.solutionId)) {
                throw new AppException("ACCESS_DENIED");
            }
        }
        return {user, context};
    }

    private async getContext(contextInfo: types.context.ContextId|db.context.Context) {
        if (typeof contextInfo === "string") {
            const context = await this.repositoryFactory.createContextRepository().get(contextInfo);
            if (!context) {
                throw new Error(`DbInconsitency, given context does not exists contextId=${contextInfo}`);
            }
            return context;
        }
        else {
            return contextInfo;
        }
    }
}
