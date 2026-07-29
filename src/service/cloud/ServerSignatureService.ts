/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppException } from "../../api/AppException";
import { NonceMap } from "../../cluster/master/ipcServices/NonceMap";
import * as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";
import { PkiFactory } from "../pki/PkiFactory";
import * as pki from "privmx-pki2";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { Crypto } from "../../utils/crypto/Crypto";

export class ServerSignatureService {
    
    static readonly MAX_CLOCK_DESYNCHRONIZATION: types.core.Timespan = DateUtils.minutes(15);
    private keystore?: pki.common.keystore.KeyStore;
    
    constructor(
        private nonceMap: NonceMap,
        private pkiFactory: PkiFactory,
    ) {};
    
    async signChallenge(challenge: string) {
        const now = DateUtils.now();
        const isValid = await this.nonceMap.isValidNonce({nonce: challenge, ttl: ServerSignatureService.MAX_CLOCK_DESYNCHRONIZATION});
        if (!isValid) {
            throw new AppException("INVALID_NONCE", "This nonce was already used");
        }
        const key = (await this.getKeyStore()).getPrimaryKey().keyPair as pki.common.keystore.EccKeyPair;
        const signedChallenge = ECUtils.signToCompactSignature(key.keyPair, Crypto.sha256(Buffer.from(`${challenge};${now}`)));
        return {
            challenge: signedChallenge.toString("hex"),
            timestamp: now,
        };
    }
    
    async getKeyStore() {
        if (!this.keystore) {
            this.keystore = await this.pkiFactory.loadKeystore();
        }
        return this.keystore;
    }
}
