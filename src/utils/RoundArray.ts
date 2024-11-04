/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export class RoundArray<T> {
    
    list: T[];
    index: number;
    initialized: number;
    
    constructor(length: number) {
        this.list = new Array(length);
        this.index = -1;
        this.initialized = 0;
    }
    
    current(): T {
        return this.list[this.index];
    }
    
    add(element: T): void {
        this.index = (this.index + 1) % this.list.length;
        this.list[this.index] = element;
        this.initialized = Math.max(this.initialized, this.index + 1);
    }
    
    getArray(): T[] {
        if (this.initialized == this.list.length) {
            if (this.index == this.list.length - 1) {
                return this.list;
            }
            return this.list.slice(this.index + 1).concat(this.list.slice(0, this.index + 1));
        }
        return this.list.slice(0, this.initialized);
    }
    
    forEach(func: (x: T, i: number, length: number) => any): void {
        const first = this.initialized == this.list.length ? (this.index + 1) % this.list.length : 0;
        for (let i = 0; i < this.initialized; i++) {
            const index = (first + i) % this.list.length;
            func(this.list[index], i, this.initialized);
        }
    }
    
    sum(func: (x: T) => number): number {
        let sum = 0;
        for (let i = 0; i < this.initialized; i++) {
            sum += func(this.list[i]);
        }
        return sum;
    }
    
    avg(func: (x: T) => number): number {
        return this.sum(func) / this.initialized;
    }
    
    getFirst(): T {
        const first = this.initialized == this.list.length ? (this.index + 1) % this.list.length : 0;
        return this.list[first];
    }
    
    getPrevious(): T {
        if (this.index == 0) {
            return this.list[this.list.length - 1];
        }
        return this.list[this.index - 1];
    }
    
    getLast(): T {
        return this.list[this.index];
    }
}
