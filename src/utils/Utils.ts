/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as NodePath from "path";
import * as types from "../types";
import { Uint64BE } from "int64-buffer";
import { Deferred, Immutable, ParsedHashmail, Result, SettleResult, StreamInterface } from "../CommonTypes";
import { Base64 } from "./Base64";

export class Utils {
    
    static sleep(milliseconds: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }
    
    static timeMicro(): number {
        throw new Error("Not implemented");
    }
    
    static fillTo(buff: Buffer, length: number): Buffer {
        if (buff.length < length) {
            const res = Buffer.alloc(length, 0);
            buff.copy(res, length - buff.length);
            return res;
        }
        if (buff.length > length) {
            return buff.slice(0, length);
        }
        return buff;
    }
    
    static fillTo32(buff: Buffer): Buffer {
        return Utils.fillTo(buff, 32);
    }
    
    static concatUrl(a: string, b: string): string {
        if (a.endsWith("/")) {
            a = a.substr(0, a.length - 1);
        }
        if (b.startsWith("/")) {
            b = b.substr(1);
        }
        return a + "/" + b;
    }
    
    static joinPaths(base: string, path: string): string {
        return NodePath.resolve(base, path);
    }
    
    static isValidEmail(email: string): boolean {
        const parts = email.split("@");
        return parts.length == 2 && parts[0].length > 0 && parts[1].length > 0;
    }
    
    static uniqueAdd<T>(array: T[], element: T): boolean {
        if (!array.includes(element)) {
            array.push(element);
            return true;
        }
        return false;
    }
    
    static removeFromArray<T>(array: T[], element: T): boolean {
        const index = array.indexOf(element);
        if (index != -1) {
            array.splice(index, 1);
            return true;
        }
        return false;
    }
    
    static hexDump(data: Buffer, descriptiveLength?: boolean): string {
        let result = "";
        const len = data.length;
        const hLen = (len % 16 == 0) ? len : len + 16 - (len % 16);
        for (let i = 0; i < hLen; ++i) {
            if (i % 16 == 0) {
                result += i.toString(16).padStart(8, "0") + " ";
            }
            
            if (i < len) {
                result += data[i].toString(16).padStart(2, "0");
            }
            else {
                result += "   ";
            }
            if (i % 16 == 7) {
                result += " ";
            }
            else if (i % 16 == 15) {
                result += " |";
                for (let j = i - 15; j <= i && j < len; ++j) {
                    const code = data[j];
                    if (code >= 33 && code <= 126) {
                        result += String.fromCharCode(data[j]);
                    }
                    else {
                        result += ".";
                    }
                }
                result += "|\n";
            }
        }
        if (descriptiveLength) {
            result += "Length: " + len + " (0x" + len.toString(16) + ")";
        }
        else {
            result += len.toString(16).padStart(8, "0");
        }
        return result;
    }
    
    static encodeUint64BE(value: number): Buffer {
        return new Uint64BE(value).toBuffer();
    }
    
    static jsonBuffer(data: any): Buffer {
        return Buffer.from(JSON.stringify(data), "utf8");
    }
    
    static fromJsonBuffer<T = any>(data: Buffer): T {
        return JSON.parse(data.toString("utf8"));
    }
    
    static jsonParse<T>(json: types.core.Json<T>): T {
        return JSON.parse(json);
    }
    
    static jsonParseSafe<T>(json: types.core.Json<T>): T|null {
        try {
            return JSON.parse(json);
        }
        catch {
            return null;
        }
    }
    
    static jsonStringify<T = any>(data: T): types.core.Json<T> {
        return <types.core.Json<T>>JSON.stringify(data);
    }
    
    static deepCopy<T>(obj: T): T {
        return JSON.parse(JSON.stringify(obj)) as T;
    }
    
    static getDataUrl(mimetype: types.core.Mimetype, data: Buffer): types.core.DataUrl {
        return <types.core.DataUrl>("data:" + mimetype + ";base64," + Base64.from(data));
    }
    
    static getHashmail(user: types.core.Username, host: types.core.Host): types.core.Hashmail {
        return <types.core.Hashmail>(user + "#" + host);
    }
    
    static splitHashmail(hashmail: types.core.Hashmail): [types.core.Username, types.core.Host] {
        return <[types.core.Username, types.core.Host]>hashmail.split("#");
    }
    
    static parseHashmail(hashmail: types.core.Hashmail): false|ParsedHashmail {
        if (typeof(hashmail) != "string" || hashmail.length < 3) {
            return false;
        }
        const parts = Utils.splitHashmail(hashmail);
        if (parts.length != 2) {
            return false;
        }
        return {
            hashmail: hashmail,
            user: parts[0],
            domain: parts[1],
        };
    }
    
    static readFromStream(source: StreamInterface, num: number): Buffer {
        let result = source.read(num);
        let count = result.length;
        while (count != num) {
            const data = source.read(num - count);
            if (data) {
                result = Buffer.concat([result, data]);
            }
            if (source.eof()) {
                break;
            }
            count = result.length;
        }
        return result;
    }
    
    static defer<T = any>(): Deferred<T> {
        const defer: Partial<Deferred<T>> = {};
        defer.promise = new Promise((resolve, reject) => {
            defer.resolve = resolve;
            defer.reject = reject;
        });
        return defer as Deferred<T>;
    }
    
    static deferSafe<T = any>(): Deferred<T> {
        const defer = Utils.defer<T>();
        defer.promise.catch(() => {
            // do nothing to prevent node unhandled promise rejection
        });
        return defer;
    }
    
    static allSettled<T>(promises: Promise<T>[]): Promise<SettleResult<T>[]> {
        return Promise.all(promises.map(async x => {
            try {
                const value = await x;
                return <SettleResult<T>>{status: "fulfilled", value: value};
            }
            catch (e) {
                return <SettleResult<T>>{status: "rejected", reason: e};
            }
        }));
    }
    
    static indexOf<T = any>(array: T[], finder: (v: T, i: number) => boolean): number {
        for (const [i, v] of array.entries()) {
            if (finder(v, i)) {
                return i;
            }
        }
        return -1;
    }
    
    static findMin<T>(array: T[], func: (x: T) => number): T|null {
        let res: T|null = null;
        let min: number|null = null;
        for (const e of array) {
            const v = func(e);
            if (min == null || v < min) {
                min = v;
                res = e;
            }
        }
        return res;
    }
    
    static findMax<T>(array: T[], func: (x: T) => number): T|null {
        let res: T|null = null;
        let max: number|null = null;
        for (const e of array) {
            const v = func(e);
            if (max == null || v > max) {
                max = v;
                res = e;
            }
        }
        return res;
    }
    
    static findMin2<T>(array: T[], comparator: (a: T, b: T) => number): T|null {
        let min: T|null = null;
        for (const e of array) {
            if (min == null || comparator(min, e) > 0) {
                min = e;
            }
        }
        return min;
    }
    
    static findMax2<T>(array: T[], comparator: (a: T, b: T) => number): T|null {
        let max: T|null = null;
        for (const e of array) {
            if (max == null || comparator(max, e) < 0) {
                max = e;
            }
        }
        return max;
    }
    
    static getMax<T, N extends number>(array: T[], func: (x: T) => N): N|null {
        let max: N|null = null;
        for (const e of array) {
            const v = func(e);
            if (max == null || v > max) {
                max = v;
            }
        }
        return max;
    }
    
    static max<T>(array: T[], func: (x: T) => number): T|null {
        let maxEntry: T|null = null;
        let maxValue: number|null = null;
        for (const e of array) {
            const v = func(e);
            if (maxValue == null || v > maxValue) {
                maxEntry = e;
                maxValue = v;
            }
        }
        return maxEntry;
    }
    
    static maxValue<T extends number>(a: T, b: T): T {
        return a > b ? a : b;
    }
    
    static async fetchAsMap<I, T extends {id: string}>(service: {getMany(ids: I[]): Promise<T[]>}, ids: I[]): Promise<{[id: string]: T}> {
        const list = await service.getMany([...new Set(ids.filter(x => x != null))]);
        const map: {[id: string]: T} = {};
        list.forEach(x => map[x.id] = x);
        return map;
    }
    
    static flat<T>(list: T[][]): T[] {
        return Array.prototype.concat.apply([], list);
    }
    
    static getLast<T>(list: T[]): T|null {
        return list.length > 0 ? list[list.length - 1] : null;
    }
    
    static mapObject<T, U>(object: {[key: string]: T}, mapper: (key: string, value: T) => U) {
        const res: U[] = [];
        for (const key in object) {
            res.push(mapper(key, object[key]));
        }
        return res;
    }
    
    static unique<T>(array: T[]): T[] {
        return [...new Set(array)];
    }
    
    static uniqueFromArrays<T>(...arrays: T[][]): T[] {
        return this.unique(arrays.flat());
    }
    
    static uniqueF<T, U>(array: T[], func: (e: T) => U): U[] {
        const set = new Set<U>();
        for (const e of array) {
            set.add(func(e));
        }
        return [...set];
    }
    
    static freezeDeep<T>(obj: T): Immutable<T> {
        if (typeof(obj) == "object") {
            if (obj == null) {
                return obj;
            }
            Object.freeze(obj);
            if (Array.isArray(obj)) {
                for (const x of obj) {
                    Utils.freezeDeep(x);
                }
                return obj;
            }
            for (const key in obj) {
                Utils.freezeDeep(obj[key]);
            }
        }
        return obj;
    }
    
    static createRange(start: number, end: number): number[] {
        if (start > end) {
            return [];
        }
        const range = new Array<number>(end - start + 1);
        for (let i = 0; i < range.length; i++) {
            range[i] = start + i;
        }
        return range;
    }
    
    static async promiseFilter<T>(array: T[], filter: (x: T) => Promise<boolean>): Promise<T[]> {
        const result: T[] = [];
        for (const entry of array) {
            if (await filter(entry)) {
                result.push(entry);
            }
        }
        return result;
    }
    
    static getRandomFromRange(a: number, b: number) {
        return a + Math.floor(Math.random() * (b - a));
    }
    
    static getRandomCharacter(alphabet: string) {
        return alphabet[Utils.getRandomFromRange(0, alphabet.length)];
    }
    
    static randomString(minLength: number, maxLength: number) {
        const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const length = Utils.getRandomFromRange(minLength, maxLength);
        let res = "";
        for (let i = 0; i < length; i++) {
            res += Utils.getRandomCharacter(alphabet);
        }
        return res;
    }
    
    static randomLowercaseString(minLength: number, maxLength: number) {
        return Utils.randomString(minLength, maxLength).toLowerCase();
    }
    
    static mapHasSpecificKeys(map: {[key: string]: any}, keys: string[]) {
        if (keys.length != Object.keys(map).length) {
            return false;
        }
        for (const key of keys) {
            if (!(key in map)) {
                return false;
            }
        }
        return true;
    }
    
    static arraysIntersect<T>(a: T[], b: T[]) {
        return a.some(x => b.includes(x));
    }
    
    static isUnique<T>(array: T[]) {
        return [...new Set(array)].length == array.length;
    }
    
    static try<T>(func: () => T): Result<T> {
        try {
            return {success: true, result: func()};
        }
        catch (e) {
            return {success: false, error: e};
        }
    }
    
    static async tryPromise<T>(func: () => Promise<T>|T): Promise<Result<T>> {
        try {
            return {success: true, result: await func()};
        }
        catch (e) {
            return {success: false, error: e};
        }
    }
    
    static listsContainsTheSame<T>(a: T[], b: T[]) {
        if (a.length != b.length) {
            return false;
        }
        for (const x of a) {
            if (!b.includes(x)) {
                return false;
            }
        }
        for (const x of b) {
            if (!a.includes(x)) {
                return false;
            }
        }
        return true;
    }
    
    static upsert<T>(array: T[], newElement: T, equalityChecker: (a: T, b: T) => boolean) {
        const newArray: T[] = [];
        let found = false;
        for (const x of array) {
            if (equalityChecker(x, newElement)) {
                found = true;
                newArray.push(newElement);
            }
            else {
                newArray.push(x);
            }
        }
        if (!found) {
            newArray.push(newElement);
        }
        return newArray;
    }
    
    static prepareString(str: string): string {
        return str
            .toLocaleLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/ł/g, "l")
            .replace(/[\W_]+/g, "");
    }
}
