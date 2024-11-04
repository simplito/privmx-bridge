/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";

// IMPORTANT Now it returns callback
export class Comparator {
    
    static isHigher(a: number, b: number): boolean {
        return a > b;
    }
    
    static isHigherOrEqual(a: number, b: number): boolean {
        return a >= b;
    }
    
    static isLower(a: number, b: number): boolean {
        return a < b;
    }
    
    static isLowerOrEqual(a: number, b: number): boolean {
        return a <= b;
    }
    
    static isEqual(a: number, b: number): boolean {
        return a == b;
    }
    
    static isNotEqual(a: number, b: number): boolean {
        return a != b;
    }
    
    static getCallableByName(name: types.core.Relation): (a: number, b: number) => boolean {
        if (name == "HIGHER") {
            return Comparator.isHigher;
        }
        if (name == "HIGHER_EQUAL") {
            return Comparator.isHigherOrEqual;
        }
        if (name == "LOWER") {
            return Comparator.isLower;
        }
        if (name == "LOWER_EQUAL") {
            return Comparator.isLowerOrEqual;
        }
        if (name == "EQUAL") {
            return Comparator.isEqual;
        }
        if (name == "NOT_EQUAL") {
            return Comparator.isNotEqual;
        }
        throw new Error("Invalid name " + name);
    }
}