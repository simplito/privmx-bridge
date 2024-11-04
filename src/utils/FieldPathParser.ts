/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { StringChecker } from "./StringChecker";

export type PropPathPart = FieldPathPart|IndexPathPart;

export interface FieldPathPart {
    type: "field";
    name: string;
}
export interface IndexPathPart {
    type: "index";
    index: number;
}

export class FieldPathParser {
    
    static parseFieldPath(fieldPath: string) {
        const parts: PropPathPart[] = [];
        let current: {mode: "field"|"index", value: string}|null = null;
        const flush = () => {
            if (!current) {
                return;
            }
            if (current.mode === "field") {
                parts.push({type: "field", name: current.value});
            }
            else {
                const index = parseInt(current.value, 10);
                if ("" + index != current.value) {
                    throw new Error("Invalid index");
                }
                parts.push({type: "index", index: index});
            }
            current = null;
        };
        for (const c of fieldPath) {
            if (c === ".") {
                if (!current && parts.length === 0) {
                    throw new Error("Cannot start with dot");
                }
                flush();
                current = {mode: "field", value: ""};
            }
            else if (c === "[") {
                flush();
                current = {mode: "index", value: ""};
            }
            else if (c === "]") {
                flush();
            }
            else {
                const isDigit = StringChecker.isStringDigit(c);
                const isLatinOrUnderscore = StringChecker.isStringLatin(c) || c === "_";
                if (!isDigit && !isLatinOrUnderscore) {
                    throw new Error(`Invalid character '${c}'`);
                }
                if (current === null) {
                    if (!isLatinOrUnderscore) {
                        throw new Error(`Invalid character '${c}'`);
                    }
                    current = {mode: "field", value: ""};
                }
                if (current.mode === "index" && !isDigit) {
                    throw new Error(`Expetced digit, get '${c}'`);
                }
                if (current.mode === "field" && !current.value && isDigit) {
                    throw new Error(`Unexpetced digit, get '${c}'`);
                }
                current.value += c;
            }
        }
        flush();
        return parts;
    }
    
    static extract(obj: unknown, propPath: string) {
        return FieldPathParser.extractFromParsedPath(obj, FieldPathParser.parseFieldPath(propPath));
    }
    
    static extractFromParsedPath(obj: unknown, propPath: PropPathPart[]) {
        let current = obj;
        for (const entry of propPath) {
            if (current == null) {
                break;
            }
            if (entry.type === "field") {
                current = (current as any)[entry.name];
            }
            else {
                current = (current as any)[entry.index];
            }
        }
        return current;
    }
}
