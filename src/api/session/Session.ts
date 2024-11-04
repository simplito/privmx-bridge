/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @typescript-eslint/unified-signatures */

import * as types from "../../types";
import { Subidentity } from "../../service/login/UserLoginService";
import * as db from "../../db/Model";

export interface SrpDataInSession {
    I: types.user.UserLogin;
    N: types.core.Hex;
    g: types.core.Hex;
    k: types.core.Hex;
    v: types.core.Hex;
    b: types.core.Hex;
    B: types.core.Hex;
}

export interface KeyDataInSession {
    pub: types.core.EccPubKey;
    priv: types.core.EccWif;
}

export interface EcdheDataInSession {
    pub: types.core.EccPubKey;
    contextUser?: boolean;
}

export type SessionState = "init"|"keyInit"|"exchange"|"failed"|"additionalLoginStep"|"ecdhePre";

export class Session {
    
    changes: Partial<db.session.SessionData>;
    
    constructor(
        public readonly id: types.core.SessionId,
        public data: db.session.SessionData
    ) {
        this.changes = {};
    }
    
    isChanged(): boolean {
        return Object.keys(this.changes).length > 0;
    }
    
    getId(): types.core.SessionId {
        return this.id;
    }
    
    get(name: "state", value?: SessionState): SessionState;
    get(name: "properties", value?: types.user.LoginProperties): types.user.LoginProperties;
    get(name: "srp", value?: SrpDataInSession): SrpDataInSession;
    get(name: "username", value?: types.core.Username): types.core.Username;
    get(name: "type", value?: types.user.SessionUserType): types.user.SessionUserType;
    get(name: "rights", value?: types.user.UserRightsMap): types.user.UserRightsMap;
    get(name: "proxy", value?: types.core.Host): types.core.Host;
    get(name: "keyLogin", value?: KeyDataInSession): KeyDataInSession;
    get(name: "subidentity", value?: Subidentity): Subidentity;
    get(name: "primaryKey", value?: types.core.EccPubKey): types.core.EccPubKey;
    get(name: "createdDate", value?: types.core.Timestamp): types.core.Timestamp;
    get(name: "ecdhe", value?: EcdheDataInSession): EcdheDataInSession;
    get(name: "restoreKey", value?: types.core.EccPubKey): types.core.EccPubKey;
    get(name: "lastUsage", value?: types.core.Timestamp): types.core.Timestamp;
    get(name: "solution", value?: types.cloud.SolutionId): types.cloud.SolutionId;
    get(name: "deviceToken", value?: boolean): boolean;
    get<K extends keyof db.session.SessionData>(name: K, def: db.session.SessionData[K] = null): db.session.SessionData[K] {
        return name in this.data ? this.data[name] : def;
    }
    
    set(name: "state", value: SessionState): void;
    set(name: "properties", value: types.user.LoginProperties): void;
    set(name: "srp", value: SrpDataInSession): void;
    set(name: "username", value: types.core.Username): void;
    set(name: "type", value: types.user.SessionUserType): void;
    set(name: "rights", value: types.user.UserRightsMap): void;
    set(name: "proxy", value: types.core.Host): void;
    set(name: "keyLogin", value: KeyDataInSession): void;
    set(name: "subidentity", value: Subidentity): void;
    set(name: "primaryKey", value: types.core.EccPubKey): void;
    set(name: "createdDate", value: types.core.Timestamp): void;
    set(name: "ecdhe", value: EcdheDataInSession): void;
    set(name: "restoreKey", value: types.core.EccPubKey): void;
    set(name: "lastUsage", value: types.core.Timestamp): void;
    set(name: "solution", value: types.cloud.SolutionId): void;
    set(name: "deviceToken", value: boolean): void;
    set<K extends keyof db.session.SessionData>(name: K, value: db.session.SessionData[K]): void {
        this.data[name] = value;
        this.changes[name] = value;
    }
    
    getWsId(): types.core.WsId {
        const sub = this.get("subidentity");
        return <types.core.WsId>(this.get("username") + (sub ? ":" + sub.pub : ""));
    }
}
