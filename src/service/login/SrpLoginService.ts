/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as BN from "bn.js";
import { SessionHolder } from "../../api/session/SessionHolder";
import { UserLoginService } from "./UserLoginService";
import { Callbacks } from "../event/Callbacks";
import { Logger } from "../log/LoggerFactory";
import { SrpLogic } from "../../utils/crypto/SrpLogic";
import { AppException } from "../../api/AppException";
import { Session } from "../../api/session/Session";
import { Utils } from "../../utils/Utils";
import { Hex } from "../../utils/Hex";
import * as types from "../../types";
import { RequestInfoHolder } from "../../api/session/RequestInfoHolder";
import { LoginLogService } from "./LoginLogService";
import { MaintenanceService } from "../misc/MaintenanceService";
import { SrpConfigService } from "./SrpConfigService";

export interface SrpInitResult {
    sessionId: types.core.SessionId;
    N: types.core.Hex;
    g: types.core.Hex;
    k: types.core.Hex;
    s: types.core.Hex;
    B: types.core.Hex;
    loginData: types.user.SrpParams;
}

export interface SrpExchangeResult {
    M2: types.core.Hex;
    K: Buffer;
    additionalLoginStep: any;
}

/* ======================== */
/*            SRP           */
/* ======================== */

export class SrpLoginService {
    
    constructor(
        private sessionHolder: SessionHolder,
        private userLoginService: UserLoginService,
        private callbacks: Callbacks,
        private srpConfigService: SrpConfigService,
        private requestInfoHolder: RequestInfoHolder,
        private loginLogService: LoginLogService,
        private maintenanceService: MaintenanceService,
        private logger: Logger,
    ) {
    }
    
    serializeBigInteger(bi: BN): types.core.Hex {
        return Hex.fromBN(bi);
    }
    
    deserializeBigInteger(data: types.core.Hex): BN {
        return Hex.toBN(data);
    }
    
    async init(I: types.user.UserLogin, host: types.core.Host, properties: types.user.LoginProperties): Promise<SrpInitResult> {
        this.logger.debug("init", {I: I, host: host, properties: properties});
        if (this.maintenanceService.isMaintenanceModeEnabled()) {
            throw new AppException("MAINTENANCE_MODE");
        }
        if (await this.loginLogService.detectAttack(this.requestInfoHolder.ip)) {
            await this.loginLogService.saveSrpLoginAttempt(null, I, false, "LOGIN_REJECTED", this.requestInfoHolder.ip, properties);
            await Utils.sleep(2000);
            throw new AppException("LOGIN_REJECTED");
        }
        const user = await this.userLoginService.getSrpUser(I, host);
        if (user == null) {
            await this.loginLogService.saveSrpLoginAttempt(null, I, false, "USER_DOESNT_EXIST", this.requestInfoHolder.ip, properties);
            throw new AppException("USER_DOESNT_EXIST");
        }
        const proxy: types.core.Host = null;
        if (user.loginByProxy != null && (this.requestInfoHolder.serverSession == null || user.loginByProxy != this.requestInfoHolder.serverSession.host)) {
            throw new AppException("INVALID_PROXY_SESSION");
        }
        
        const N = this.srpConfigService.config.N;
        const g = this.srpConfigService.config.g;
        const k = this.srpConfigService.config.k;
        const v = user.v;
        const b = SrpLogic.get_b();
        const bigB = SrpLogic.get_big_B(g, N, k, b, v);
        
        const session = await this.sessionHolder.closeCurrentSessionAndCreateNewOne(null);
        session.set("state", "init");
        session.set("properties", properties);
        session.set("srp", {
            I: user.I,
            N: this.serializeBigInteger(N),
            g: this.serializeBigInteger(g),
            k: this.serializeBigInteger(k),
            v: this.serializeBigInteger(v),
            b: this.serializeBigInteger(b),
            B: this.serializeBigInteger(bigB)
        });
        session.set("username", user.username);
        session.set("primaryKey", user.primaryKey);
        session.set("type", user.type);
        session.set("rights", user.rights);
        if (proxy) {
            session.set("proxy", proxy);
        }
        await this.sessionHolder.close(null);
        
        const res = {
            sessionId: session.getId(),
            N: Hex.fromBN(N),
            g: Hex.fromBN(g),
            k: Hex.fromBN(k),
            s: Hex.from(user.s),
            B: Hex.fromBN(bigB),
            loginData: user.loginData
        };
        return res;
    }
    
    async exchange(out: {user?: string}, sessionId: types.core.SessionId, A: BN, clientM1: BN, withK: boolean, sessionKey: types.core.EccPubKey): Promise<SrpExchangeResult> {
        this.logger.debug("exchange", {A: A, clientM1: clientM1});
        let session: Session;
        try {
            session = await this.sessionHolder.closeCurrentSessionAndRestoreGiven(null, sessionId);
        }
        catch (e) {
            this.logger.error(e);
            throw new AppException("UNKNOWN_SESSION");
        }
        if (session.get("state") != "init") {
            throw new AppException("INVALID_SESSION_STATE");
        }
        const username = out.user = session.get("username");
        const srpData = session.get("srp");
        const properties = session.get("properties");
        if (await this.loginLogService.detectAttack(this.requestInfoHolder.ip)) {
            await this.sessionHolder.destroy(null, session);
            await this.loginLogService.saveSrpLoginAttempt(username, srpData.I, false, "LOGIN_REJECTED", this.requestInfoHolder.ip, properties);
            await Utils.sleep(2000);
            throw new AppException("LOGIN_REJECTED");
        }
        const proxy = session.get("proxy");
        if (proxy != null && (this.requestInfoHolder.serverSession == null || proxy != this.requestInfoHolder.serverSession.host)) {
            await this.sessionHolder.destroy(null, session);
            throw new AppException("INVALID_PROXY_SESSION");
        }
        const N = this.deserializeBigInteger(srpData.N);
        // let g = this.deserializeBigInteger(srpData.g);
        // let k = this.deserializeBigInteger(srpData.k);
        const v = this.deserializeBigInteger(srpData.v);
        const b = this.deserializeBigInteger(srpData.b);
        const bigB = this.deserializeBigInteger(srpData.B);
        if (SrpLogic.valid_A(A, N) == false) {
            await this.sessionHolder.destroy(null, session);
            throw new AppException("INVALID_A");
        }
        const u = SrpLogic.get_u(A, bigB, N);
        const S = SrpLogic.getServer_S(A, v, u, b, N);
        const serverM1 = SrpLogic.get_M1(A, bigB, S, N);
        this.logger.debug("Server M1", {
            A: Hex.fromBN(A),
            B: Hex.fromBN(bigB),
            S: Hex.fromBN(S),
            N: Hex.fromBN(N),
            M1: Hex.fromBN(serverM1)
        });
        
        if (serverM1.cmp(clientM1) != 0) {
            await this.sessionHolder.destroy(null, session);
            await this.loginLogService.saveSrpLoginAttempt(username, srpData.I, false, "DIFFERENT_M1", this.requestInfoHolder.ip, properties);
            throw new AppException("DIFFERENT_M1");
        }
        
        const M2 = SrpLogic.get_M2(A, serverM1, S, N);
        let bigK = SrpLogic.get_big_K(S, N);
        if (bigK.length != 32) {
            const res = Buffer.alloc(32, 0);
            bigK.copy(res, 32 - bigK.length);
            bigK = res;
        }
        
        const result = <SrpExchangeResult>{
            M2: Hex.fromBN(M2)
        };
        
        if (sessionKey) {
            session.set("restoreKey", sessionKey);
        }
        session.set("state", "exchange");
        const als = await this.callbacks.triggerForResult("additionalLoginStep", [session]);
        if (als) {
            result.additionalLoginStep = als;
        }
        await this.sessionHolder.close(null);
        
        await this.loginLogService.saveSrpLoginAttempt(username, srpData.I, true, null, this.requestInfoHolder.ip, properties);
        if (withK === true) {
            result.K = bigK;
        }
        return result;
    }
}
