/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppException } from "./AppException";
import { BaseApi } from "./BaseApi";
import * as types from "../types";
import * as AdvValidator from "adv-validator";
import { AuthorizationHolder } from "../service/auth/AuthorizationHolder";
import { AuthorizationDetector } from "../service/auth/AuthorizationDetector";
import { PlainUser } from "../CommonTypes";

export class ManagementBaseApi extends BaseApi {
    
    constructor(
        protected paramsValidator: AdvValidator.Types.PerNameValidator,
        protected authorizationDetector: AuthorizationDetector,
        protected authorizationHolder: AuthorizationHolder,
    ) {
        super(paramsValidator);
    }

    async validateAccess() {
        await this.authorizationDetector.authorizeByRequest();
        if (!this.authorizationHolder.isAuthorized()) {
            throw new AppException("UNAUTHORIZED");
        }
    }
    
    protected getPlainUser(): PlainUser {
        return {type: "plain", solutions: this.getSolutionsToWhichUserIsLimited()};
    }
    
    protected getSolutionsToWhichUserIsLimited() {
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
        if (solutions.length === 0) {
            throw new AppException("ACCESS_DENIED");
        }
        return solutions;
    }
    
    protected validateScope(scope: string) {
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
