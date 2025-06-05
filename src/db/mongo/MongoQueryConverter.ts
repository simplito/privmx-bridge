/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppException } from "../../api/AppException";
import * as types from "../../types";
export class MongoQueryConverter {
    
    private static readonly whitelist: string[] = ["id", "creator", "createDate", "lastModifier", "lastModificationDate", "lastModificationDate", "users", "messages", "author", "lastEntryDate", "entries", "lastFileDate", "files", "size", "entryKey"];
    
    static convertQuery(query: types.core.Query, rootField?: string): {$match: unknown} {
        const match = {
            $match: this.convertQueryRecursievly(query, rootField),
        };
        return match;
    }
    
    private static convertQueryRecursievly(query: types.core.Query, rootField?: string): any {
        if (this.isAndQuery(query)) {
            return {$and: query.$and.map(q => this.convertQueryRecursievly(q, rootField))};
        }
        if (this.isOrQuery(query)) {
            return {$or: query.$or.map(q => this.convertQueryRecursievly(q, rootField))};
        }
        const matchConditions = Object.entries(query).map(([key, value]) => ({
            [this.convertName(key, rootField)]: this.parseValue(value),
        }));
        return {
            $and: matchConditions,
        };
    }
    
    private static parseValue(value: types.core.PropertyQuery) {
        if (typeof value !== "object" || value === null) {
            return value;
        }
        const matchCodition: types.core.PropertyQuery&{$regex?: RegExp} = value;
        if (matchCodition.$contains || matchCodition.$endsWith || matchCodition.$startsWith) {
            matchCodition.$regex = this.assemblyRegex(matchCodition.$startsWith, matchCodition.$contains, matchCodition.$endsWith);
            delete matchCodition.$startsWith;
            delete matchCodition.$contains;
            delete matchCodition.$endsWith;
        }
        return matchCodition;
    }
    
    private static assemblyRegex(startsWith: string|undefined, contains: string|undefined, endsWith: string|undefined): RegExp {
        const startPart = startsWith ? `^${this.escapeRegexValue(startsWith)}` : "";
        const containsPart = contains ? `${this.escapeRegexValue(contains)}` : "";
        const endPart = endsWith ? `${this.escapeRegexValue(endsWith)}$` : "";
        
        const pattern = `${startPart}.*${containsPart}.*${endPart}`;
        
        return new RegExp(pattern);
      }
    
    private static isAndQuery(query: types.core.Query): query is {$and: types.core.Query[]} {
        return "$and" in query;
    }
    
    private static isOrQuery(query: types.core.Query): query is {$or: types.core.Query[]} {
        return "$or" in query;
    }
    
    private static convertName(originalString: string, rootField?: string) {
        if (originalString.startsWith("#")) {
            const field = originalString.substring(1);
            if (!this.whitelist.includes(field)) {
                throw new AppException("INVALID_PARAMS", "Query trying to access restricted or wrong field");
            }
            return field === "id" ? "_id" : field;
        }
        return originalString.startsWith("#") ? originalString.substring(1) : `${rootField || "data"}.publicMetaObject.${originalString}`;
    }
    
    private static escapeRegexValue(str: string) {
        const toEscape = ".^$*+?()[]{}\\/|-]";
        let result = "";
        for (const c of str) {
            result += toEscape.includes(c) ? "\\" + c : c;
        }
        return result;
    }
}
