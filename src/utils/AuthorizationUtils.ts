/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";
import * as db from "../db/Model";
import { AppException } from "../api/AppException";

export interface ParsedScope {
    scopes: types.auth.Scope[];
    solutions: types.cloud.SolutionId[];
    ipAddress?: types.core.IPAddress;
    sessionName?: db.auth.TokenSessionName;
    expiresIn?: types.core.Timespan;
    connectionLimited: boolean;
}

export class AuthoriationUtils {
    
    static getIpAddressFromScope(scopes: types.auth.Scope[]) {
        const parsed = AuthoriationUtils.parseScope(scopes, "ignore");
        return parsed.ipAddress;
    }

    static parseScope(scopes: types.auth.Scope[], expirationPolicy: "ignore"|"disabled"|types.core.Timespan) {
        const parsed: ParsedScope = {
            scopes: [],
            solutions: [],
            connectionLimited: false,
        };
        for (const scope of scopes) {
            const values = scope.split(":");
            const [key, value] = values;
            if (key === "session" && values.length === 2) {
                parsed.sessionName = value as db.auth.TokenSessionName;
            }
            else if (key === "ipAddr" && values.length === 2) {
                parsed.ipAddress = value as types.core.IPAddress;
            }
            else if (key === "solution" && values.length === 2) {
                parsed.solutions.push(value as types.cloud.SolutionId);
                parsed.scopes.push(scope);
            }
            else if (key === "connection") {
                parsed.connectionLimited = true;
            }
            else if (key === "expiresIn") {
                if (expirationPolicy === "ignore") {
                    continue;
                }
                if (expirationPolicy === "disabled") {
                    throw new AppException("INVALID_PARAMS", "expires:NUMBER is not allowed in api keys");
                }
                const timeSpan = Number(value);
                if (isNaN(timeSpan) || !Number.isInteger(timeSpan)) {
                    throw new AppException("INVALID_PARAMS", "expires:NUMBER is not an integer");
                }
                if (timeSpan > expirationPolicy) {
                    throw new AppException("INVALID_PARAMS", `Maximal ttl is exceeded (max: ${expirationPolicy}ms)`);
                }
                if (timeSpan < 0) {
                    throw new AppException("INVALID_PARAMS", "TTL must be a positive integer");
                }
                parsed.expiresIn = timeSpan as types.core.Timespan;
            }
            else {
                parsed.scopes.push(scope);
            }
        }
        return parsed;
    }
}
