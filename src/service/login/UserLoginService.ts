/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as BN from "bn.js";

export interface SrpUser {
    username: types.core.Username;
    I: types.user.UserLogin;
    s: Buffer;
    v: BN;
    loginData: types.user.SrpParams;
    type: types.user.UserType;
    rights: types.user.UserRightsMap;
    loginByProxy: types.core.Host;
    primaryKey: types.core.EccPubKey;
}

export interface KeyUser {
    I: types.core.Username;
    pub: types.core.EccPubKey;
    subidentity: Subidentity;
    type: types.user.UserType;
    rights: types.user.UserRightsMap;
    loginByProxy: types.core.Host;
    primaryKey: types.core.EccPubKey;
}

export interface Subidentity {
    pub: types.core.EccPubKey;
    acl: types.user.SubidentityAcl;
    deviceId: types.core.DeviceId;
    deviceIdRequired: boolean;
}

export class UserLoginService {
    
    async getSrpUser(_I: types.user.UserLogin, _host: types.core.Host): Promise<SrpUser> {
        return null;
    }
    
    async getKeyUser(_pub: types.core.EccPubKey): Promise<KeyUser> {
        return null;
    }
}