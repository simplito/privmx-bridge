/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";

export class LoginLogService {
    
    async saveSrpLoginAttempt(_username: types.core.Username|null, _login: types.user.UserLogin, _success: boolean, _error: string|undefined, _ip: types.core.IPAddress, _properties: types.user.LoginProperties) {
        // do nothing
    }
    
    async saveKeyLoginAttempt(_username: types.core.Username|null, _key: types.core.EccPubKey, _subidentity: boolean, _success: boolean, _error: string, _ip: types.core.IPAddress, _properties: types.user.LoginProperties) {
        // do nothing
    }
    
    async detectAttack(_ip: types.core.IPAddress): Promise<boolean> {
        // do nothing
        return false;
    }
}
