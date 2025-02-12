/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable max-classes-per-file */

import "q2-test";
import { ErrorCode, AppException } from "../../api/AppException";

export type Mocked<T> = T&{ [K in keyof T]: T[K] & Mock };
export const ANY = {any: true};

export function hasOneCallWithArguments(mockObj: Mock, args: any[]) {
    expect(mockObj.mock.calls.length).toBe(1);
    expect(mockObj.mock.calls[0].length).toBe(args.length);
    for (const [i, arg] of args.entries()) {
        if (arg != ANY) {
            expect(mockObj.mock.calls[0][i]).toBe(arg);
        }
    }
}

export function hasOneCall(mockObj: Mock) {
    hasCalls(mockObj, 1);
}

export function hasNoCalls(mockObj: Mock) {
    hasCalls(mockObj, 0);
}

export function hasCalls(mockObj: Mock, count: number) {
    expect(mockObj.mock.calls.length).toBe(count);
}

export function empty() {
    return;
}

export function mock<T, K extends keyof T>(obj: Mocked<T>, prop: K, func?: T[K]) {
    obj[prop] = <any>mockFn(<any>(func || empty));
}

export function createMock<T>(props: {[K in keyof T]?: Mock}) {
    return <Mocked<T>>props;
}

export function createFake<T>(props: {[K in keyof T]?: T[K]}) {
    return <T>props;
}

export function overrideMethod<T, K extends keyof T>(object: T, method: K, newImplementation: T[K]) {
    object[method] = newImplementation;
    return object;
}

export function mockMethod<T, K extends keyof T>(object: T, methodName: K, newImplementation: T[K]) {
    if (typeof(newImplementation) != "function") {
        throw new Error("Given implementation is not a function");
    }
    object[methodName] = <any>mockFn(<any>newImplementation);
    return <Mocked<T>>object;
}

export class AsyncHelper<T> {
    
    constructor(
        private func: () => Promise<T>,
    ) {
    }
    
    async toThrowError(errorMessage: string) {
        try {
            await this.func();
            expect(true).toBeFalsy();
        }
        catch (e) {
            toBeErrorWithMessage(e, errorMessage);
        }
    }
}

export class PromiseHelper<T> {
    
    constructor(
        private promise: Promise<T>,
    ) {
    }
    
    async toThrowError(errorMessage: string) {
        try {
            await this.promise;
            expect(true).toBeFalsy();
        }
        catch (e) {
            toBeErrorWithMessage(e, errorMessage);
        }
    }
    
    async toThrowApiException(errorType: ErrorCode) {
        try {
            await this.promise;
        }
        catch (e) {
            expect(AppException.is(e, errorType)).toBe(true);
            return;
        }
        expect(true).toBeFalsy();
    }
}

export function expectAsync<T>(func: () => Promise<T>) {
    return new AsyncHelper(func);
}

export function expectPromise<T>(promise: Promise<T>) {
    return new PromiseHelper(promise);
}

export function toBeErrorWithMessage(e: any, message: string) {
    expect(e).toBeInstanceOf(Error);
    expect(e).objectContaining({
        message: message,
    });
}

export function use<T>(x: T, func: (x: T) => any): T {
    func(x);
    return x;
}
