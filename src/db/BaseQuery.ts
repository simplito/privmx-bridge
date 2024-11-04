/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";
import { QueryResult, Query, ArrayElement } from "./ObjectRepository";

export abstract class BaseQuery<T> implements Query<T> {
    
    constructor(public baseName: string = "") {
    }
    
    empty(): QueryResult {
        return <QueryResult>{};
    }
    
    not(query: QueryResult): QueryResult {
        const res = <QueryResult>{};
        for (const key in query) {
            if (key == "$and") {
                const res2 = [];
                for (const x of query[key]) {
                    res2.push(this.not(x));
                }
                res.$or = res2;
            }
            else if (key == "$or") {
                const res2 = [];
                for (const x of query[key]) {
                    res2.push(this.not(x));
                }
                res.$and = res2;
            }
            else {
                res[key] = this.tryNegate(query[key]);
            }
        }
        return res;
    }
    
    private tryNegate(query: any) {
        if (typeof(query) == "object") {
            const keys = Object.keys(query);
            if (keys.length != 1) {
                throw new Error("Cannot negate multi expression");
            }
            const key = keys[0];
            const value = query[key];
            if (key == "$ne") {
                return value;
            }
            if (key == "$in") {
                return {$nin: value};
            }
            if (key == "$nin") {
                return {$in: value};
            }
            if (key == "$exists") {
                return {$exists: !value};
            }
            if (key == "$regex") {
                return {$not: query};
            }
            if (key == "$gt") {
                return {$lte: value};
            }
            if (key == "$gte") {
                return {$lt: value};
            }
            if (key == "$lt") {
                return {$gte: value};
            }
            if (key == "$lte") {
                return {$gt: value};
            }
            return {$not: query};
        }
        return {$ne: query};
    }
    
    protected getPropName(prop: keyof T): string {
        return (this.baseName ? this.baseName + "." : "") + <string>prop;
    }
    
    eq<K extends keyof T>(prop: K, value: T[K]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = value;
        return res;
    }
    
    neq<K extends keyof T>(prop: K, value: T[K]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$ne: value};
        return res;
    }
    
    in<K extends keyof T>(prop: K, value: (T[K])[]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$in: value};
        return res;
    }
    
    nin<K extends keyof T>(prop: K, value: (T[K])[]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$nin: value};
        return res;
    }
    
    exists<K extends keyof T>(prop: K): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$exists: true};
        return res;
    }
    
    notExists<K extends keyof T>(prop: K): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$exists: false};
        return res;
    }
    
    regex<K extends keyof T>(prop: K, regex: string|RegExp): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$regex: regex};
        return res;
    }
    
    gt<K extends keyof T>(prop: K, value: T[K]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$gt: value};
        return res;
    }
    
    gte<K extends keyof T>(prop: K, value: T[K]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$gte: value};
        return res;
    }
    
    lt<K extends keyof T>(prop: K, value: T[K]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$lt: value};
        return res;
    }
    
    lte<K extends keyof T>(prop: K, value: T[K]): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = {$lte: value};
        return res;
    }
    
    relation<K extends keyof T>(prop: K, relation: types.core.Relation, value: T[K]): QueryResult {
        if (relation == "HIGHER") {
            return this.gt(prop, value);
        }
        if (relation == "HIGHER_EQUAL") {
            return this.gte(prop, value);
        }
        if (relation == "LOWER") {
            return this.lt(prop, value);
        }
        if (relation == "LOWER_EQUAL") {
            return this.lte(prop, value);
        }
        if (relation == "EQUAL") {
            return this.eq(prop, value);
        }
        if (relation == "NOT_EQUAL") {
            return this.neq(prop, value);
        }
        throw new Error("Invalid relation name " + relation);
    }
    
    includes<K extends keyof T>(prop: K, value: ArrayElement<T[K]>): QueryResult {
        const res = <QueryResult>{};
        res[this.getPropName(prop)] = value;
        return res;
    }
    
    and(...args: QueryResult[]): QueryResult {
        return this.andList(args);
    }
    
    andList(args: QueryResult[]): QueryResult {
        if (args.length == 0) {
            return this.empty();
        }
        if (args.length == 1) {
            return args[0];
        }
        const res = <QueryResult>{};
        res.$and = args;
        return res;
    }
    
    or(...args: QueryResult[]): QueryResult {
        return this.orList(args);
    }
    
    orList(args: QueryResult[]): QueryResult {
        if (args.length == 0) {
            return this.empty();
        }
        if (args.length == 1) {
            return args[0];
        }
        const res = <QueryResult>{};
        res.$or = args;
        return res;
    }
    
    protected abstract create<K extends keyof T, Q>(prop: K): Query<Q>;
    
    prop<K extends keyof T>(prop: K): Query<T[K]> {
        return this.create(prop);
    }
    
    propType<Z>(prop: keyof T): Query<Z> {
        return this.create(prop);
    }
    
    arrayProp<K extends keyof T>(prop: K): Query<ArrayElement<T[K]>> {
        return this.create(prop);
    }
}
