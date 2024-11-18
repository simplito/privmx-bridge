/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Crypto } from "../../utils/crypto/Crypto";
import { Hex } from "../../utils/Hex";
import * as types from "../../types";
import * as db from "../../db/Model";
import { EcdheDataInSession } from "./Session";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import * as mongodb from "mongodb";

export class SessionStorage {
    
    private prefetched: db.session.Session|null = null;
    
    constructor(
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    setPrefetched(session: db.session.Session) {
        this.prefetched = session;
    }
    
    async createSession(session: mongodb.ClientSession|undefined, sessionData: db.session.SessionData) {
        const sessionId = Hex.from(Crypto.randomBytes(10)) as types.core.SessionId;
        await this.repositoryFactory.createSessionRepository(session).insert(sessionId, sessionData);
        return {id: sessionId, data: sessionData};
    }
    
    async getSession(id: types.core.SessionId) {
        if (this.prefetched && this.prefetched.id === id) {
            const res = this.prefetched;
            this.prefetched = null;
            return res;
        }
        return this.repositoryFactory.createSessionRepository().get(id);
    }
    
    async setSession(session: mongodb.ClientSession|undefined, id: types.core.SessionId, data: Partial<db.session.SessionData>) {
        return this.repositoryFactory.createSessionRepository(session).updateData(id, data);
    }
    
    async removeSession(session: mongodb.ClientSession|undefined, id: types.core.SessionId) {
        return this.repositoryFactory.createSessionRepository(session).delete(id);
    }
    
    async removeSessionsByUser(session: mongodb.ClientSession|undefined, username: types.core.Username) {
        return this.removeSessions(session, {"data.username": username});
    }
    
    async removeSessionsBySubidentity(session: mongodb.ClientSession|undefined, pub: types.core.EccPubKey) {
        return this.removeSessions(session, {"data.subidentity.pub": pub});
    }
    
    async removeSessionsByDeviceId(session: mongodb.ClientSession|undefined, deviceId: types.core.DeviceId) {
        return this.removeSessions(session, {"data.properties.deviceId": deviceId});
    }
    
    async removeSessionsBySubidentityGroup(session: mongodb.ClientSession|undefined, groupId: types.user.UsersGroupId) {
        return this.removeSessions(session, {"data.subidentity.acl.group": groupId});
    }
    
    // clear old tickets before run it
    async cleanOldSessions(session: mongodb.ClientSession|undefined) {
        return this.repositoryFactory.createSessionRepository(session).cleanOldSessions();
    }
    
    private async removeSessions(session: mongodb.ClientSession|undefined, query: any) {
        return this.repositoryFactory.createSessionRepository(session).removeSessions(query);
    }
    
    async switchUserRights(session: mongodb.ClientSession|undefined, username: types.core.Username, type: types.user.UserType, rights: types.user.UserRightsMap) {
        return this.repositoryFactory.createSessionRepository(session).switchUserRights(username, type, rights);
    }
    
    async upgradeAllEcdheSessions(session: mongodb.ClientSession|undefined, key: types.core.EccPubKey, data?: EcdheDataInSession) {
        return this.repositoryFactory.createSessionRepository(session).upgradeAllEcdheSessions(key, data);
    }
    
    async downgradeAllEcdheSessions(session: mongodb.ClientSession|undefined, key: types.core.EccPubKey) {
        return this.repositoryFactory.createSessionRepository(session).downgradeAllEcdheSessions(key);
    }
}
