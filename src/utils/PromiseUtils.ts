/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { SettleResult, Deferred } from "../CommonTypes";

export class PromiseUtils {
    
    static wait(milliseconds: number) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
    
    static forEach<T>(list: T[], func: (entry: T, i: number) => any): Promise<void> {
        let i = 0;
        const next = async (): Promise<void> => {
            if (i >= list.length) {
                return null;
            }
            const index = i;
            const entry = list[index];
            await func(entry, i);
            i++;
            return next();
        };
        return next();
    }
    
    static defer<T = any>(): Deferred<T> {
        const defer: Deferred<T> = {
            resolve: null,
            reject: null,
            promise: null
        };
        defer.promise = new Promise((resolve, reject) => {
            defer.resolve = resolve;
            defer.reject = reject;
        });
        return defer;
    }
    
    static callbackToPromise<T>(func: (callback: (err: any, result: T) => void) => void): Promise<T> {
        return new Promise<T>((resolve, reject) => func((err, result) => {
            if (err) {
                reject(err as Error);
            }
            else {
                resolve(result);
            }
        }));
    }
    
    static callbackToPromiseVoid(func: (callback: (err: any) => void) => void): Promise<void> {
        return new Promise<void>((resolve, reject) => func(err => {
            if (err) {
                reject(err as Error);
            }
            else {
                resolve();
            }
        }));
    }
    
    static callbackToPromise2<T>(func: (callback: (result: T) => void) => void): Promise<T> {
        return new Promise<T>((resolve) => func((result) => {
            resolve(result);
        }));
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
    
    static async filter<T>(values: T[], filter: (v: T) => Promise<boolean>): Promise<T[]> {
        const res: T[] = [];
        for (const value of values) {
            if (await filter(value)) {
                res.push(value);
            }
        }
        return res;
    }
}