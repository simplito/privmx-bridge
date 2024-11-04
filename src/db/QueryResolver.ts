/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { QueryResult } from "./ObjectRepository";

export class QueryResolver {
    
    static TYPES: {[type: string]: number} = {
        "undefined": 1,
        "object": 2,
        "boolean": 3,
        "number": 4,
        "bigint": 5,
        "string": 6,
        "symbol": 7,
        "function": 8
    };
    
    static buildQuery(query: QueryResult) {
        const res: any[] = [];
        for (const field in query) {
            if (field == "$and") {
                res.push({$and: query[field].map((x: any) => ({$and: QueryResolver.buildQuery(x)}))});
            }
            else if (field == "$or") {
                res.push({$or: query[field].map((x: any) => ({$and: QueryResolver.buildQuery(x)}))});
            }
            else {
                res.push({path: QueryResolver.parseField(field), query: query[field]});
            }
        }
        return res;
    }
    
    static passedOrQuery(obj: any, query: any[]) {
        for (const q of query) {
            if (QueryResolver.passedElement(obj, q)) {
                return true;
            }
        }
        return query.length == 0 ? true : false;
    }
    
    static passedAndQuery(obj: any, query: any[]) {
        for (const q of query) {
            if (!QueryResolver.passedElement(obj, q)) {
                return false;
            }
        }
        return true;
    }
    
    static passedElement(obj: any, query: any) {
        if ("$and" in query) {
            return QueryResolver.passedAndQuery(obj, query.$and);
        }
        if ("$or" in query) {
            return QueryResolver.passedOrQuery(obj, query.$or);
        }
        if (obj == null) {
            return QueryResolver.passedValue(obj, query.query);
        }
        if (Array.isArray(obj)) {
            const newQuery = {path: query.path.slice(1), query: query.query};
            return QueryResolver.passedElementArray(obj, newQuery);
        }
        let current = obj;
        for (const [i, part] of query.path.entries()) {
            current = current[part];
            if (current == null) {
                break;
            }
            if (Array.isArray(current)) {
                const newQuery = {path: query.path.slice(i + 1), query: query.query};
                return QueryResolver.passedElementArray(current, newQuery);
            }
        }
        return QueryResolver.passedValue(current, query.query);
    }
    
    static passedElementArray(obj: any, query: any) {
        for (const x of obj) {
            const res = QueryResolver.passedElement(x, query);
            if (res) {
                return true;
            }
        }
        return false;
    }
    
    static passedValue(value: any, query: any): boolean {
        if (typeof(query) == "object" && query != null) {
            if ("$not" in query) {
                return !QueryResolver.passedValue(value, query.$not);
            }
            if ("$ne" in query) {
                return value != query.$ne;
            }
            if ("$in" in query) {
                return query.$in.includes(value);
            }
            if ("$nin" in query) {
                return !query.$nin.includes(value);
            }
            if ("$exists" in query) {
                return (value != null) == query.$exists;
            }
            if ("$regex" in query) {
                return (typeof(query.$regex) == "string" ? new RegExp(query.$regex) : <RegExp>query.$regex).test(value);
            }
            if ("$gt" in query) {
                return QueryResolver.comparable(value, query.$gt) && QueryResolver.compare(value, query.$gt) > 0;
            }
            if ("$gte" in query) {
                return QueryResolver.comparable(value, query.$gte) && QueryResolver.compare(value, query.$gte) >= 0;
            }
            if ("$lt" in query) {
                return QueryResolver.comparable(value, query.$lt) && QueryResolver.compare(value, query.$lt) < 0;
            }
            if ("$lte" in query) {
                return QueryResolver.comparable(value, query.$lte) && QueryResolver.compare(value, query.$lte) <= 0;
            }
        }
        return value == query;
    }
    
    static buildSorts(sorts: {field: string, asc: boolean}[]) {
        return sorts.map(x => ({path: QueryResolver.parseField(x.field), asc: x.asc}));
    }
    
    static parseField(str: string) {
        return str.split(".");
    }
    
    static getProp(obj: any, path: string[]): any {
        let current = obj;
        for (const part of path) {
            if (current == null) {
                return current;
            }
            current = current[part];
        }
        return current;
    }
    
    static comparable(a: any, b: any) {
        const aNum = typeof(a) == "number";
        const bNum = typeof(b) == "number";
        const aStr = typeof(a) == "string";
        const bStr = typeof(b) == "string";
        return (aNum || aStr) && (bNum || bStr);
    }
    
    static compare(a: any, b: any) {
        if (a == b) {
            return 0;
        }
        const aNum = typeof(a) == "number";
        const bNum = typeof(b) == "number";
        if (aNum && bNum) {
            return a - b;
        }
        const aStr = typeof(a) == "string";
        const bStr = typeof(b) == "string";
        if (aStr && bStr) {
            return a.localeCompare(b);
        }
        if (aStr && bNum) {
            return a.localeCompare(b.toString());
        }
        if (aNum && bStr) {
            return a.toString().localeCompare(b);
        }
        const aType = QueryResolver.TYPES[typeof(a)];
        const bType = QueryResolver.TYPES[typeof(b)];
        return  aType == bType ? 0 : aType - bType;
    }
}
