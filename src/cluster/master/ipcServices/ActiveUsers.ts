/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService } from "../../master/Decorators";
import { ApiMethod } from "../../../api/Decorators";
import * as types from "../../../types";

@IpcService
export class ActiveUsersMap {
    
    private usersSet: Set<`${types.cloud.SolutionId}/${types.core.EccPubKey}`> = new Set();
    
    @ApiMethod({})
    async setUserAsActive(model: {userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId}) {
        this.usersSet.add(`${model.solutionId}/${model.userPubkey}`);
    }
    
    @ApiMethod({})
    async setUserAsInactive(model: {userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId}) {
        this.usersSet.delete(`${model.solutionId}/${model.userPubkey}`);
    }
    
    @ApiMethod({})
    async getUsersState(model: {userPubkeys: types.core.EccPubKey[], solutionIds: types.cloud.SolutionId[]}) {
        return model.userPubkeys.map(user => {
            return {status: this.isUserActive(user, model.solutionIds) ? "active" : "inactive"};
        });
    }
    
    isUserActive(userPubkey: types.core.EccPubKey, solutionIds: types.cloud.SolutionId[]) {
        for (const solution of solutionIds) {
            const entry = this.usersSet.has(`${solution}/${userPubkey}`);
            if (entry) {
                return true;
            }
        }
        return false;
    }
}
