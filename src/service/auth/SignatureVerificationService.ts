/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseParams, RequestSignature } from "../../utils/RequestSignature";
import * as db from "../../db/Model";
import { DateUtils } from "../../utils/DateUtils";
import * as types from "../../types";
import * as http from "http";
import { NonceMap } from "../../cluster/master/ipcServices/NonceMap";

export class SignatureVerificationService {

    private static readonly MAX_CLOCK_DESYNCHRONIZATION: types.core.Timespan = DateUtils.minutes(10);

    constructor(
        private nonceMap: NonceMap,
    ) {}

    async verify({request, apiKey, nonce, timestamp, signature, requestBody}: {request: http.IncomingMessage|null, apiKey: db.auth.ApiKey, nonce: string, timestamp: number, signature: string, requestBody: Buffer}) {
        if (!await this.isValidNonce(nonce)) {
            return false;
        }
        if (!this.isValidTimestamp(timestamp)) {
            return false;
        }

        const params: BaseParams = {
            apiKeyId: apiKey.id,
            httpMethod: request?.method || "",
            nonce: nonce,
            timestamp: timestamp,
            requestBody: requestBody,
            urlPath: (request as any)?.originalUrl || request?.url || "",
        };

        if (apiKey.publicKey) {
            return RequestSignature.verifyEddsa({
                ...params,
                publicKey: apiKey.publicKey,
                signature: signature,
            });
        }
        return RequestSignature.verifyHmac({
            ...params,
            apiKeySecret: apiKey.secret,
            signature: signature,
        });
    }

    async isValidNonce(nonce: string) {
        return (nonce.length <= 128 && await this.nonceMap.isValidNonce({nonce, ttl: (SignatureVerificationService.MAX_CLOCK_DESYNCHRONIZATION * 2) as types.core.Timespan}));
    }

    isValidTimestamp(timestamp: number) {
        return (Math.abs(Date.now() - timestamp) < SignatureVerificationService.MAX_CLOCK_DESYNCHRONIZATION);
    }
}
