/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as crypto from "crypto";
import * as db from "../../db/Model";
import { TokenEncryptionKeyProvider } from "./TokenEncryptionKeyProvider";
import { Hex } from "../../utils/Hex";
import { Utils } from "../../utils/Utils";

export class TokenEncryptionService {

    constructor(
        private tokenEncryptionKeyProvider: TokenEncryptionKeyProvider,
    ) {
    }

    async getKeyToEncode() {
        return this.tokenEncryptionKeyProvider.getCurrentKey();
    }

    async encrypt(data: unknown, encKey: db.auth.TokenEncryptionKey) {
        const iv = this.generateNewIv();
        const keyId = Hex.toBuf(encKey.id);
        const key = Hex.toBuf(encKey.key);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const update = cipher.update(JSON.stringify(data));
        const final = cipher.final();
        const tag = cipher.getAuthTag();
        const buff = Buffer.concat([keyId, iv, update, final, tag]).toString("base64");
        return buff;
    }

    async decrypt(encodedBase64Token: string): Promise<unknown> {
        const buffer = Buffer.from(encodedBase64Token, "base64");
        const keyId = buffer.subarray(0, 16);
        const key = await this.getKeyFromId(Hex.from(keyId) as db.auth.TokenEncryptionKeyId);
        if (!key) {
            return key;
        }
        const iv = buffer.subarray(16, 28);
        const tag = buffer.subarray(buffer.length - 16);
        const data = buffer.subarray(28, buffer.length - 16);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const update = decipher.update(data).toString("utf8");
        const final = decipher.final().toString("utf8");
        return JSON.parse(update + final);
    }

    private generateNewIv() {
        return crypto.randomBytes(12);
    }
    
    private async getKeyFromId(keyId: db.auth.TokenEncryptionKeyId) {
        const cipherKey = await this.tokenEncryptionKeyProvider.getKey(keyId);
        return cipherKey ? Hex.toBuf(cipherKey.key) : null;
    }
    
    async decryptToken(token: string) {
        const decrypted = await Utils.tryPromise(() => this.decrypt(token));
        return decrypted.success === true && this.isTokenData(decrypted.result) ? decrypted.result : null;
    }
    
    private isTokenData(token: unknown): token is db.auth.ApiTokenData {
        return !!token && typeof(token) === "object" &&
            "type" in token && typeof(token.type) === "string" && (token.type === "accessToken" || token.type === "refreshToken") &&
            "expires" in token && typeof(token.expires) === "number" &&
            "created" in token && typeof(token.created) === "number" &&
            "sessionId" in token && typeof(token.sessionId) === "string" &&
            "seq" in token && typeof(token.seq) === "number" &&
            (!("connectionId" in token) || typeof(token.connectionId) === "string");
    }
}
