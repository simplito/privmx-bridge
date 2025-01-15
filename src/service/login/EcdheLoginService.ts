/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Callbacks } from "../event/Callbacks";
import * as types from "../../types";
import { SessionHolder } from "../../api/session/SessionHolder";
import { EcdheDataInSession } from "../../api/session/Session";
import { NonceService } from "../misc/NonceService";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { RepositoryFactory } from "../../db/RepositoryFactory";
import { AppException } from "../../api/AppException";
import { RpcError } from "../../api/tls/RpcError";

export class EcdheLoginService {
    
    constructor(
        private sessionHolder: SessionHolder,
        private callbacks: Callbacks,
        private nonceService: NonceService,
        private repositoryFactory: RepositoryFactory,
    ) {
    }
    
    async onLogin(key: types.core.EccPubKey, solutionId?: types.cloud.SolutionId) {
        if (solutionId) {
            const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
            if (!solution) {
                throw new RpcError("Solution does not exist");
            }
        }
        const session = await this.startEcdheSession(key, solutionId);
        await this.callbacks.trigger("ecdheLogin", [key, this, this.sessionHolder]);
        return session.id;
    }
    
    private async startEcdheSession(key: types.core.EccPubKey, solution?: types.cloud.SolutionId) {
        const session = await this.sessionHolder.closeCurrentSessionAndCreateNewOne(undefined);
        session.set("username", <types.core.Username><unknown>key);
        session.set("state", "ecdhePre");
        session.set("ecdhe", {pub: key});
        session.set("type", "ecdhe");
        session.set("rights", {
            basic: false,
            normal: false,
            admin: false,
            private_section_allowed: false,
            usergroup_sections_manager: false,
            regular_sections_manager: false,
            all_users_lookup: false
        });
        if (solution) {
            session.set("solution", solution);
        }
        return session;
    }
    
    upgradeEcdheSession(data?: EcdheDataInSession) {
        const session = this.sessionHolder.getCurrentSession();
        if (!session) {
            return;
        }
        session.set("state", "exchange");
        if (data) {
            session.set("ecdhe", data);
        }
    }
    
    async onLoginX(key: types.core.EccPubKey, nonce: types.core.Nonce, timestamp: types.core.Timestamp, signature: types.core.EccSignature, solutionId: types.cloud.SolutionId|undefined) {
        if (solutionId) {
            const solution = await this.repositoryFactory.createSolutionRepository().get(solutionId);
            if (!solution) {
                throw new RpcError("Solution does not exist");
            }
        }
        const pub = ECUtils.publicFromBase58DER(key);
        if (!pub) {
            throw new AppException("INVALID_SIGNATURE");
        }
        await this.nonceService.nonceCheck2P(Buffer.from("ecdhexlogin", "utf8"), pub, nonce, timestamp, signature);
        
        const keyExists = await this.repositoryFactory.createContextUserRepository().userPubKeyExists(key);
        if (!keyExists) {
            throw new AppException("USER_DOESNT_EXIST");
        }
        
        const session = await this.sessionHolder.closeCurrentSessionAndCreateNewOne(undefined);
        session.set("username", <types.core.Username><unknown>key);
        session.set("state", "exchange");
        session.set("ecdhe", {pub: key, contextUser: true});
        session.set("type", "ecdhe");
        session.set("rights", {
            basic: false,
            normal: false,
            admin: false,
            private_section_allowed: false,
            usergroup_sections_manager: false,
            regular_sections_manager: false,
            all_users_lookup: false
        });
        if (solutionId) {
            session.set("solution", solutionId);
        }
        return session.id;
    }
}
