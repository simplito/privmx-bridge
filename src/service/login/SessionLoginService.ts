/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import * as elliptic from "elliptic";
import { Session } from "../../api/session/Session";
import { SessionHolder } from "../../api/session/SessionHolder";
import { Logger } from "../log/Logger";
import { AppException } from "../../api/AppException";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { NonceService } from "../misc/NonceService";

export class SessionLoginService {
    
    constructor(
        private sessionHolder: SessionHolder,
        private nonceService: NonceService,
        private logger: Logger,
    ) {
    }
    
    async onSession(sessionId: types.core.SessionId, clientKey: elliptic.ec.KeyPair, nonce: types.core.Nonce, timestamp: types.core.Timestamp, signature: types.core.EccSignature): Promise<Session> {
        const session = await this.getSession(sessionId);
        this.checkRestoreKeyInSession(session, clientKey);
        await this.nonceService.nonceCheck2P(Buffer.from("restore_" + sessionId, "utf8"), clientKey, nonce, timestamp, signature);
        return session;
    }
    
    private checkRestoreKeyInSession(session: Session, clientKey: elliptic.ec.KeyPair) {
        if (session.get("state") != "exchange") {
            throw new AppException("UNKNOWN_SESSION");
        }
        const restoreKey = session.get("restoreKey");
        const pub = ECUtils.publicToBase58DER(clientKey);
        if (pub != restoreKey) {
            throw new AppException("UNKNOWN_SESSION");
        }
    }
    
    private async getSession(sessionId: types.core.SessionId) {
        try {
            if (!sessionId) {
                throw new AppException("UNKNOWN_SESSION");
            }
            return await this.sessionHolder.closeCurrentSessionAndRestoreGiven(undefined, sessionId);
        }
        catch (e) {
            this.logger.error(e);
            throw new AppException("UNKNOWN_SESSION");
        }
    }
}
