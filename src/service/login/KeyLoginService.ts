/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../log/LoggerFactory";
import { Callbacks } from "../event/Callbacks";
import { NonceService } from "../misc/NonceService";
import { SessionHolder } from "../../api/session/SessionHolder";
import { AppException } from "../../api/AppException";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { Session } from "../../api/session/Session";
import { ECIES } from "../../utils/crypto/ECIES";
import * as types from "../../types";
import { Base64 } from "../../utils/Base64";
import { UserLoginService } from "./UserLoginService";
import { RequestInfoHolder } from "../../api/session/RequestInfoHolder";

export interface KeyInitResult {
    sessionId: types.core.SessionId;
    I: types.core.Username;
    pub: types.core.EccPubKey;
}

export interface KeyExchangeResult {
    additionalLoginStep?: any;
    K: Buffer;
}

export class KeyLoginService {
    
    constructor(
        private sessionHolder: SessionHolder,
        private userLoginService: UserLoginService,
        private nonceService: NonceService,
        private callbacks: Callbacks,
        private requestInfoHolder: RequestInfoHolder,
        private logger: Logger,
    ) {
    }
    
    async init(out: {user?: string}, pub: types.core.EccPubKey, properties: types.user.LoginProperties): Promise<KeyInitResult> {
        const user = await this.userLoginService.getKeyUser(pub);
        if (user == null) {
            throw new AppException("USER_DOESNT_EXIST");
        }
        out.user = user.I;
        if (user.subidentity && user.subidentity.deviceIdRequired) {
            if (!user.subidentity.deviceId || properties.deviceId == null || user.subidentity.deviceId != properties.deviceId) {
                throw new AppException("INVALID_DEVICE_ID");
            }
        }
        const proxy: types.core.Host|null = null;
        if (user.loginByProxy != null && (this.requestInfoHolder.serverSession == null || user.loginByProxy != this.requestInfoHolder.serverSession.host)) {
            throw new AppException("INVALID_PROXY_SESSION");
        }
        const priv = ECUtils.generateRandom();
        
        const session = await this.sessionHolder.closeCurrentSessionAndCreateNewOne(undefined);
        session.set("state", "keyInit");
        session.set("properties", properties);
        session.set("keyLogin", {
            pub: user.pub,
            priv: ECUtils.toWIF(priv),
        });
        session.set("username", user.I);
        session.set("primaryKey", user.primaryKey);
        session.set("type", user.type);
        session.set("rights", user.rights);
        session.set("subidentity", user.subidentity);
        if (proxy) {
            session.set("proxy", proxy);
        }
        await this.sessionHolder.close(undefined);
        
        return {
            sessionId: session.id,
            I: user.I,
            pub: ECUtils.publicToBase58DER(priv),
        };
    }
    
    async exchange(out: {user?: string}, sessionId: types.core.SessionId, nonce: types.core.Nonce, timestamp: types.core.Timestamp, signature: types.core.EccSignature,
        K: types.core.Base64, returnK: boolean, sessionKey: types.core.EccPubKey|undefined): Promise<KeyExchangeResult> {
        let session: Session;
        try {
            session = await this.sessionHolder.closeCurrentSessionAndRestoreGiven(undefined, sessionId);
        }
        catch (e) {
            this.logger.error(e);
            throw new AppException("UNKNOWN_SESSION");
        }
        if (session.get("state") != "keyInit") {
            throw new AppException("INVALID_SESSION_STATE");
        }
        out.user = session.get("username");
        const proxy = session.get("proxy");
        if (proxy != null && (this.requestInfoHolder.serverSession == null || proxy != this.requestInfoHolder.serverSession.host)) {
            await this.sessionHolder.destroy(undefined, session);
            throw new AppException("INVALID_PROXY_SESSION");
        }
        const keyLoginData = session.get("keyLogin");
        const pub = ECUtils.publicFromBase58DER(keyLoginData.pub);
        if (!pub) {
            throw new AppException("INVALID_SESSION_STATE");
        }
        try {
            await this.nonceService.nonceCheck2P(Buffer.from("login" + K, "utf8"), pub, nonce, timestamp, signature);
        }
        catch (e) {
            await this.sessionHolder.destroy(undefined, session);
            throw e;
        }
        
        const priv = ECUtils.fromWIF(keyLoginData.priv);
        if (!priv) {
            throw new AppException("INVALID_SESSION_STATE");
        }
        const ecies = new ECIES(priv, pub);
        const newK = ecies.decrypt(Base64.toBuf(K));
        
        const result = <KeyExchangeResult>{};
        
        if (sessionKey) {
            session.set("restoreKey", sessionKey);
        }
        session.set("state", "exchange");
        const als = await this.callbacks.triggerForResult("additionalLoginStep", [session]);
        if (als) {
            result.additionalLoginStep = als;
        }
        await this.sessionHolder.close(undefined);
        
        if (returnK === true) {
            result.K = newK;
        }
        return result;
    }
}
