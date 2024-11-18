/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { JobService } from "../job/JobService";

export class Callbacks {
    
    callbacks: {[name: string]: ((...args: any[]) => any)[]};
    
    constructor(
        private jobService: JobService
    ) {
        this.callbacks = {};
    }
    
    add(name: string, callback: (...args: any[]) => any): void {
        if (!(name in this.callbacks)) {
            this.callbacks[name] = [];
        }
        this.callbacks[name].push(callback);
    }
    
    hasCallbacks(name: string): boolean {
        return name in this.callbacks && this.callbacks[name].length > 0;
    }
    
    triggerSync<T = any>(name: string, args: any[]): T[] {
        if (!(name in this.callbacks)) {
            return [];
        }
        const res: T[] = [];
        for (const callback of this.callbacks[name]) {
            const value = callback(...args);
            if (value && typeof(value.then) == "function") {
                throw new Error("Callback returns promise in triggerSync event '" + name + "'");
            }
            res.push(value);
        }
        return res;
    }
    
    triggerZ(name: string, args: any[]): void {
        if (!(name in this.callbacks)) {
            return;
        }
        for (const callback of this.callbacks[name]) {
            this.jobService.addJob(callback(...args), "Error during calling callback '" + name + "'");
        }
    }
    
    async trigger<T = any>(name: string, args: any[]): Promise<T[]> {
        if (!(name in this.callbacks)) {
            return [];
        }
        const res: T[] = [];
        for (const callback of this.callbacks[name]) {
            res.push(await callback(...args));
        }
        return res;
    }
    
    async triggerForResult<T = unknown>(name: string, args: any[]): Promise<T|null> {
        if (!(name in this.callbacks)) {
            return null;
        }
        const callbacks = this.callbacks[name];
        for (const callback of callbacks) {
            const res = await callback(...args);
            if (res) {
                return res;
            }
        }
        return null;
    }
}
