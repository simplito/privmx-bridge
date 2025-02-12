/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Crypto } from "./crypto/Crypto";
import * as types from "../types";
import { DateUtils } from "./DateUtils";

export interface BaseParams {
    apiKeyId: types.auth.ApiKeyId;
    timestamp: number;
    nonce: string;
    httpMethod: string;
    urlPath: string;
    requestBody: Buffer;
}

export interface HmacSignParams extends BaseParams {
    apiKeySecret: types.auth.ApiKeySecret;
}

export interface HmacVerifyParams extends HmacSignParams {
    signature: string;
}

export interface EddsaSignParams extends BaseParams {
    privKey: string;
}

export interface EddsaVerifyParams extends BaseParams {
    publicKey: types.core.EccPubKeyPEM;
    signature: string;
}

export interface SignatureInfo {
    apiKeyId: types.auth.ApiKeyId;
    version: string;
    timestamp: number;
    nonce: string;
    signature: string;
}

export class RequestSignature {
    
    static readonly PMX_HMAC_SHA256 = "pmx-hmac-sha256";
    
    static addNonceAndTimestamp<T extends {timestamp: number, nonce: string}>(params: Omit<T, "nonce"|"timestamp">): T {
        return {...params, timestamp: DateUtils.now(), nonce: Crypto.randomBytes(32).toString("base64")} as unknown as T;
    }
    
    static signHmac(params: HmacSignParams) {
        const dataToSign = RequestSignature.buildRequestSignatureData(params.timestamp, params.nonce, params.httpMethod, params.urlPath, params.requestBody);
        return Crypto.hmacSha256(Buffer.from(params.apiKeySecret, "utf8"), dataToSign).subarray(0, 20).toString("base64");
    }
    
    static signHmacToHeader(params: HmacSignParams) {
        const signature = RequestSignature.signHmac(params);
        return RequestSignature.createHeader({
            apiKeyId: params.apiKeyId,
            version: "1",
            timestamp: params.timestamp,
            nonce: params.nonce,
            signature: signature,
        });
    }
    
    static verifyHmac(params: HmacVerifyParams) {
        return RequestSignature.signHmac(params) === params.signature;
    }
    
    static signEddsa(params: EddsaSignParams) {
        const dataToSign = RequestSignature.buildRequestSignatureData(params.timestamp, params.nonce, params.httpMethod, params.urlPath, params.requestBody);
        return Crypto.genericSign(dataToSign, params.privKey).toString("base64");
    }
    
    static signEddsaToHeader(params: EddsaSignParams) {
        const signature = RequestSignature.signEddsa(params);
        return RequestSignature.createHeader({
            apiKeyId: params.apiKeyId,
            version: "1",
            timestamp: params.timestamp,
            nonce: params.nonce,
            signature: signature,
        });
    }
    
    static verifyEddsa(params: EddsaVerifyParams) {
        const dataToVerify = RequestSignature.buildRequestSignatureData(params.timestamp, params.nonce, params.httpMethod, params.urlPath, params.requestBody);
        return Crypto.genericVerify(dataToVerify, params.publicKey, Buffer.from(params.signature, "base64"));
    }
    
    static createHeader(info: SignatureInfo) {
        return `${info.apiKeyId};1;${info.timestamp};${info.nonce};${info.signature}`;
    }
    
    static parseHeader(value: string): false|SignatureInfo {
        const values = value.split(";");
        if (values.length !== 5) {
            return false;
        }
        const [apiKeyId, version, timestampStr, nonce, signature] = values;
        if (!apiKeyId || !version || !timestampStr || !nonce || !signature) {
            return false;
        }
        const timestamp = parseInt(timestampStr, 10);
        if (isNaN(timestamp)) {
            return false;
        }
        return {apiKeyId: apiKeyId as types.auth.ApiKeyId, version, timestamp, nonce, signature};
    }
    
    static buildRequestSignatureData(timestamp: number, nonce: string, httpMethod: string, urlPath: string, requestBody: Buffer) {
        const requestData = Buffer.concat([Buffer.from(`${httpMethod.toUpperCase()}\n${urlPath}\n`, "utf8"), requestBody, Buffer.from("\n", "utf8")]);
        const payload = Buffer.concat([Buffer.from(`${timestamp};${nonce};`, "utf8"), requestData]);
        return payload;
    }
}
