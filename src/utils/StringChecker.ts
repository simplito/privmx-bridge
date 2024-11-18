/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";

export class StringChecker {
    
    static isCharCodeHighLatin(code: number): boolean {
        return code >= 65 && code <= 90;
    }
    
    static isCharCodeLowLatin(code: number): boolean {
        return code >= 97 && code <= 122;
    }
    
    static isCharCodeLatin(code: number): boolean {
        return StringChecker.isCharCodeHighLatin(code) || StringChecker.isCharCodeLowLatin(code);
    }
    
    static isCharCodeDigit(code: number): boolean {
        return code >= 48 && code <= 57;
    }
    
    static isCharCodeLatinOrDigit(code: number): boolean {
        return StringChecker.isCharCodeLatin(code) || StringChecker.isCharCodeDigit(code);
    }
    
    static isCharCodeHex(code: number): boolean {
        return StringChecker.isCharCodeDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    }
    
    static isCharCodeHexLowerCase(code: number): boolean {
        return StringChecker.isCharCodeDigit(code) || (code >= 97 && code <= 102);
    }
    
    static isCharCodeBase64(code: number): boolean {
        return StringChecker.isCharCodeLatinOrDigit(code) || code == 43 || code == 47;
    }
    
    static isStringX(str: string, checker: (charCode: number) => boolean): boolean {
        for (let i = 0; i < str.length; i++) {
            if (!checker(str.charCodeAt(i))) {
                return false;
            }
        }
        return true;
    }
    
    static isStringLatin(str: string): boolean {
        return StringChecker.isStringX(str, StringChecker.isCharCodeLatin);
    }
    
    static isStringDigit(str: string): boolean {
        return StringChecker.isStringX(str, StringChecker.isCharCodeDigit);
    }
    
    static isStringLatinOrDigit(str: string): boolean {
        return StringChecker.isStringX(str, StringChecker.isCharCodeLatinOrDigit);
    }
    
    static isStringHex(str: string): str is types.core.Hex {
        return str.length % 2 == 0 && StringChecker.isStringX(str, StringChecker.isCharCodeHex);
    }
    
    static isStringHexLowerCase(str: string): str is types.core.Hex {
        return str.length % 2 == 0 && StringChecker.isStringX(str, StringChecker.isCharCodeHexLowerCase);
    }
    
    static isStringBase64(str: string): str is types.core.Base64  {
        return StringChecker.getBase64Info(str).valid;
    }
    
    static getBase64Info(str: string): {valid: false}|{valid: true, length: number, value: types.core.Base64} {
        if (str.length % 4 != 0) {
            return {valid: false};
        }
        let binLength = str.length * 3 / 4;
        let dataLength = str.length;
        if (dataLength > 0 && str.charCodeAt(dataLength - 1) == 61) {
            dataLength--;
            binLength--;
            if (dataLength > 0 && str.charCodeAt(dataLength - 1) == 61) {
                dataLength--;
                binLength--;
            }
        }
        for (let i = 0; i < dataLength; i++) {
            if (!StringChecker.isCharCodeBase64(str.charCodeAt(i))) {
                return {valid: false};
            }
        }
        return {valid: true, length: binLength, value: <types.core.Base64>str};
    }
    
    static isCharCodeBase58(code: number): boolean {
        return StringChecker.isCharCodeLatinOrDigit(code) && code != 48 && code != 73 && code != 79 && code != 108;
    }
    
    static isStringBase58(str: string): str is types.core.Base58 {
        return StringChecker.isStringX(str, StringChecker.isCharCodeBase58);
    }
}
