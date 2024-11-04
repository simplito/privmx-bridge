/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as db from "../../db/Model";
import * as types from "../../types";

export interface Session {
    scopes: types.auth.Scope[];
}

export class AuthorizationHolder {
    
    private auth: {user: db.auth.ApiUser, apiKey: db.auth.ApiKey, session: Session|null}|null = null;
    
    authorize(user: db.auth.ApiUser, apiKey: db.auth.ApiKey, session: Session|null) {
        this.auth = {user, apiKey, session};
    }
    
    isAuthorized() {
        return !!this.auth;
    }
    
    getAuth() {
        return this.auth;
    }
}
