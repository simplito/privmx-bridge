/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-bitwise */

import { Permission } from "../Permission";
import { Logger } from "../../service/log/Logger";
import { Session } from "./Session";
import * as types from "../../types";
import { AccessDeniedError } from "./AccessDeniedError";
import { MaintenanceService } from "../../service/misc/MaintenanceService";
import { AppException } from "../AppException";
import { CloudUser } from "../../CommonTypes";

export class SessionService {
    
    private session?: Session;
    
    constructor(
        private inputSession: Session|null,
        private maintenanceService: MaintenanceService,
        private logger: Logger,
    ) {
    }
    
    private fetchSession() {
        this.logger.debug("Session id: " + (this.inputSession ? this.inputSession.id : null));
        const session = this.inputSession;
        if (session == null) {
            throw new AccessDeniedError("Unknown session");
        }
        return session;
    }
    
    private getEstablishedSession() {
        if (this.session != null) {
            return this.session;
        }
        const session = this.fetchSession();
        const state = session.get("state");
        if (state !== "exchange" && state !== "additionalLoginStep" && state !== "ecdhePre") {
            throw new AccessDeniedError("Invalid session state");
        }
        this.session = session;
        return this.session;
    }
    
    private getEstablishedSessionOrGuest() {
        if (this.inputSession) {
            return this.getEstablishedSession();
        }
        this.logger.debug("No session established");
        return new Session("" as types.core.SessionId, {
            username: "" as types.core.Username,
            type: "guest",
        });
    }
    
    getRealUserSession() {
        const session = this.getSession();
        return session && ["local", "basic"].includes(session.get("type")) ? session : null;
    }
    
    getSession(): Session|null {
        if (this.inputSession) {
            return this.getEstablishedSession();
        }
        return null;
    }
    
    getSessionUser(): Session {
        return this.getEstablishedSessionOrGuest();
    }
    
    assertMethod(permissions: number|number[]) {
        if (Array.isArray(permissions)) {
            // OR
            let exception = null;
            for (const permission of permissions) {
                try {
                    this.assertMethod(permission);
                    return;
                }
                catch (e) {
                    exception = e;
                }
            }
            throw exception;
        }
        
        // AND
        if (this.maintenanceService.isMaintenanceModeEnabled()) {
            this.logger.debug("maintenance is enabled");
            if (!(permissions & Permission.ALLOW_WITH_MAINTENANCE)) {
                throw new AccessDeniedError("Failed assert ALLOW_WITH_MAINTENANCE");
            }
        }
        
        if (permissions & Permission.SESSION_ESTABLISHED) {
            const session = this.getSession();
            if (session == null || session.get("state") != "exchange") {
                this.throwError(session, "Failed assert SESSION_ESTABLISHED");
            }
        }
        
        if (permissions & Permission.USER_SESSION) {
            const session = this.getSession();
            if (session == null || session.get("state") != "exchange" || !session.get("rights").basic || session.get("subidentity") != null) {
                this.throwError(session, "Failed assert USER_SESSION");
            }
            else {
                const username = session.get("username");
                this.logger.debug("Logged as: " + username);
            }
        }
        
        /*
        if (permissions & Permission.NORMAL_PERMISSIONS) {
            let session = this.getSession();
            if (session == null || session.get("state") != "exchange" || !session.hasNormalRight()) {
                throw new AccessDeniedError("Failed assert NORMAL_PERMISSIONS");
            }
            let user = session.get("username");
            this.logger.debug("Logged as: " + user);
        }
        */
        
        if (permissions & Permission.ADMIN_PERMISSIONS) {
            const session = this.getSession();
            if (session == null || session.get("state") != "exchange" || !session.get("rights").admin) {
                this.throwError(session, "Failed assert ADMIN_PERMISSIONS");
            }
            this.logger.debug("User has ADMIN_PERMISSIONS");
        }
        
        if (permissions & Permission.HAS_ANY_SESSION) {
            const session = this.getSession();
            if (session == null || (session.get("state") != "exchange" && session.get("state") != "ecdhePre")) {
                this.throwError(session, "Failed assert HAS_ANY_SESSION");
            }
            this.logger.debug("User has HAS_ANY_SESSION");
        }
    }
    
    private throwError(session: Session|null, msg: string) {
        if (session != null && session.get("state") == "additionalLoginStep") {
            throw new AppException("NEED_2FA_AUTHENTICATION");
        }
        else {
            throw new AccessDeniedError(msg);
        }
    }
    
    assertRights(right: types.user.UserRight) {
        const session = this.getSession();
        if (session == null || session.get("state") != "exchange" || !session.get("rights")[right]) {
            throw new AccessDeniedError("Failed assert right " + right);
        }
        this.logger.debug("User has right " + right);
    }
    
    validateContextSessionAndGetCloudUser() {
        const session = this.getSession();
        const ecdhe = session ? session.get("ecdhe") : null;
        if (!session || session.get("type") !== "ecdhe" || !ecdhe || !ecdhe.contextUser) {
            throw new AppException("ACCESS_DENIED");
        }
        return new CloudUser(ecdhe.pub, session.get("solution"));
    }
}
