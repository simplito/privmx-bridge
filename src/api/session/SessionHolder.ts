/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Session } from "./Session";
import * as types from "../../types";
import { SessionStorage } from "./SessionStorage";
import { DateUtils } from "../../utils/DateUtils";
import * as mongodb from "mongodb";

export class SessionHolder {
    
    private session: Session|null = null;
    
    constructor(
        private sessionStorage: SessionStorage
    ) {
    }
    
    getCurrentSession() {
        return this.session;
    }
    
    async createSession(tr: mongodb.ClientSession) {
        if (this.session) {
            throw new Error("Session already exists");
        }
        const session = await this.sessionStorage.createSession(tr, {
            createdDate: DateUtils.now(),
            lastUsage: DateUtils.now(),
        });
        this.session = new Session(session.id, session.data);
        return this.session;
    }
    
    async restoreSession(sessionId: types.core.SessionId) {
        if (this.session) {
            if (this.session.id != sessionId) {
                throw new Error("Cannot start new session with id " + sessionId + ", there is already loaded session with id " + this.session.id);
            }
            return this.session;
        }
        const session = await this.sessionStorage.getSession(sessionId);
        if (!session) {
            throw new Error("Cannot restore session with id " + sessionId);
        }
        this.session = new Session(session.id, session.data);
        const newLastUsage = DateUtils.now();
        const oldLastUsage = this.session.get("lastUsage");
        if (newLastUsage - oldLastUsage > 3000) {
            this.session.set("lastUsage", DateUtils.now());
        }
        return this.session;
    }
    
    async closeCurrentSessionAndCreateNewOne(tr: mongodb.ClientSession) {
        await this.close(tr);
        return this.createSession(tr);
    }
    
    async closeCurrentSessionAndRestoreGiven(tr: mongodb.ClientSession, sessionId: types.core.SessionId) {
        await this.close(tr);
        return this.restoreSession(sessionId);
    }
    
    async close(tr: mongodb.ClientSession) {
        if (this.session && this.session.isChanged()) {
            await this.sessionStorage.setSession(tr, this.session.id, this.session.changes);
        }
        this.session = null;
    }
    
    async destroyCurrentSession(tr: mongodb.ClientSession) {
        if (this.session) {
            await this.destroy(tr, this.session);
        }
    }
    
    async destroy(tr: mongodb.ClientSession, session: Session) {
        await this.sessionStorage.removeSession(tr, session.id);
        if (this.session === session) {
            this.session = null;
        }
    }
}
