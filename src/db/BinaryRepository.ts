/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export interface BinaryRepository2Read<K extends string> {
    get(key: K): Promise<Buffer|null>;
    getOrDefault(key: K, def: Buffer): Promise<Buffer>;
    getEntries(keys: K[]): Promise<{key: K, value: Buffer}[]>;
    getKeys(keys: K[]): Promise<K[]>;
    getAllKeys(): Promise<K[]>;
    count(): Promise<number>;
    exists(key: K): Promise<boolean>;
    clear(): Promise<void>;
}

export interface BinaryRepository2<K extends string> extends BinaryRepository2Read<K> {
    insert(key: K, value: Buffer): Promise<void>;
}

export interface IBinaryRepositoryFactory<K extends string> {
    
    withRepositoryRead<T = any>(func: (repository: BinaryRepository2Read<K>) => Promise<T>): Promise<T>;
    withRepositoryWrite<T = any>(func: (repository: BinaryRepository2<K>) => Promise<T>): Promise<T>;
    getDiskUsage(): Promise<number>;
    initialize(): Promise<void>;
}
