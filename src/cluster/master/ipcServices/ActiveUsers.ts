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
import * as db from "../../../db/Model";
@IpcService
export class ActiveUsersMap {
    
    private usersSet: Map<`${types.core.Host}/${types.cloud.SolutionId}/${types.core.EccPubKey}`, {usage: number}> = new Map();
    
    @ApiMethod({})
    async setUserAsActive(model: {host: types.core.Host, userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId}) {
        const entry = this.usersSet.get(`${model.host}/${model.solutionId}/${model.userPubkey}`);
        if (!entry) {
            this.usersSet.set(`${model.host}/${model.solutionId}/${model.userPubkey}`, {usage: 1});
            return;
        };
        entry.usage++;
    }
    
    @ApiMethod({})
    async setUserAsInactive(model: {host: types.core.Host, userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId}) {
        const entry = this.usersSet.get(`${model.host}/${model.solutionId}/${model.userPubkey}`);
        if (!entry) {
            return;
        };
        if (entry.usage === 1) {
            this.usersSet.delete(`${model.host}/${model.solutionId}/${model.userPubkey}`);
        }
        else {
            entry.usage--;
        }
    }
    
    @ApiMethod({})
    async getUsersState(model: {host: types.core.Host, userPubkeys: types.core.EccPubKey[], solutionIds: types.cloud.SolutionId[]}): Promise<{userPubKey: types.core.EccPubKey, status: "active"|"inactive"}[]> {
        return model.userPubkeys.map(user => {
            return {
                userPubKey: user,
                status: this.isUserActive(model.host, user, model.solutionIds) ? "active" : "inactive",
            };
        });
    }
    
    @ApiMethod({})
    async isAnyUserActive(model: {users: db.context.ContextUser[], solutionId: types.cloud.SolutionId, host: types.core.Host}) {
        for (const user of model.users) {
            if (await this.isContextUserActive({host: model.host, user, solutionId: model.solutionId})) {
                return true;
            }
        }
        return false;
    }
    
    @ApiMethod({})
    async isContextUserActive(model: {host: types.core.Host, user: db.context.ContextUser, solutionId: types.cloud.SolutionId}) {
        return !!this.usersSet.has(`${model.host}/${model.solutionId}/${model.user.userPubKey}`);
    }
    
    isUserActive(host: types.core.Host, userPubkey: types.core.EccPubKey, solutionIds: types.cloud.SolutionId[]) {
        for (const solution of solutionIds) {
            const entry = this.usersSet.has(`${host}/${solution}/${userPubkey}`);
            if (entry) {
                return true;
            }
        }
        return false;
    }
}
