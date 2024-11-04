/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../types";
import { Immutable } from "../CommonTypes";

export interface QueryResult {
    [key: string]: any;
    __queryResult: never;
}

export type ArrayElement<A> = A extends (infer T)[] ? T : never;

export interface Query<T> {
    empty(): QueryResult;
    not(query: QueryResult): QueryResult;
    eq<K extends keyof T>(prop: K, value: T[K]): QueryResult;
    neq<K extends keyof T>(prop: K, value: T[K]): QueryResult;
    in<K extends keyof T>(prop: K, value: (T[K])[]): QueryResult;
    nin<K extends keyof T>(prop: K, value: (T[K])[]): QueryResult;
    exists<K extends keyof T>(prop: K): QueryResult;
    notExists<K extends keyof T>(prop: K): QueryResult;
    regex<K extends keyof T>(prop: K, regex: string|RegExp): QueryResult;
    gt<K extends keyof T>(prop: K, value: T[K]): QueryResult;
    gte<K extends keyof T>(prop: K, value: T[K]): QueryResult;
    lt<K extends keyof T>(prop: K, value: T[K]): QueryResult;
    lte<K extends keyof T>(prop: K, value: T[K]): QueryResult;
    relation<K extends keyof T>(prop: K, relation: types.core.Relation, value: T[K]): QueryResult;
    includes<K extends keyof T>(prop: K, value: ArrayElement<T[K]>): QueryResult;
    and(...args: QueryResult[]): QueryResult;
    andList(args: QueryResult[]): QueryResult;
    or(...args: QueryResult[]): QueryResult;
    orList(args: QueryResult[]): QueryResult;
    prop<K extends keyof T>(prop: K): Query<T[K]>;
    propType<Z>(prop: keyof T): Query<Z>;
    arrayProp<K extends keyof T>(prop: K): Query<ArrayElement<T[K]>>;
}

export interface ObjectRepositoryRead<K extends string|number, V> {
    get(key: K): Promise<V>;
    getMulti(keys: K[]): Promise<V[]>;
    getOrDefault(key: K, def: V): Promise<V>;
    getAll(): Promise<V[]>;
    count(f: (q: Query<V>) => QueryResult): Promise<number>;
    find(f: (q: Query<V>) => QueryResult): Promise<V>;
    findAll(f: (q: Query<V>) => QueryResult): Promise<V[]>;
    exists(key: K): Promise<boolean>;
    query(f: (q: Query<V>) => QueryResult): ObjectQuery<V>;
}

export type PickProperty<T, K extends keyof T, Z extends keyof T[K]> = Omit<T, K>&{[Property in K]: Pick<T[K], Z>};

export interface ObjectQuery<T> {
    one(): Promise<T>;
    array(): Promise<T[]>;
    count(): Promise<number>;
    exists(): Promise<boolean>;
    limit(limit: number): ObjectQuery<T>;
    skip(skip: number): ObjectQuery<T>;
    sort(field: string, asc: boolean): ObjectQuery<T>;
    props<K extends keyof T>(field: K): ObjectQuery<Pick<T, K>>;
    props<K1 extends keyof T, K2 extends keyof T>(field1: K1, field2: K2): ObjectQuery<Pick<T, K1 | K2>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T>(field1: K1, field2: K2, field3: K3): ObjectQuery<Pick<T, K1 | K2 | K3>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4): ObjectQuery<Pick<T, K1 | K2 | K3 | K4>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T, K5 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4, field5: K5): ObjectQuery<Pick<T, K1 | K2 | K3 | K4 | K5>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T, K5 extends keyof T, K6 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4, field5: K5, field6: K6): ObjectQuery<Pick<T, K1 | K2 | K3 | K4 | K5 | K6>>;
    
    propsChild<PK extends keyof T, K extends keyof T[PK]>(field: PK, childField: K): ObjectQuery<PickProperty<T, PK, K>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2): ObjectQuery<PickProperty<T, PK, K1 | K2>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK], K3 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2, childField3: K3): ObjectQuery<PickProperty<T, PK, K1 | K2 | K3>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK], K3 extends keyof T[PK], K4 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2, childField3: K3, childField4: K4): ObjectQuery<PickProperty<T, PK, K1 | K2 | K3 | K4>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK], K3 extends keyof T[PK], K4 extends keyof T[PK], K5 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2, childField3: K3, childField4: K4, childField5: K5): ObjectQuery<PickProperty<T, PK, K1 | K2 | K3 | K4 | K5>>;
    
    omitProps<K extends keyof T>(field: K): ObjectQuery<Omit<T, K>>;
    omitProps<K1 extends keyof T, K2 extends keyof T>(field1: K1, field2: K2): ObjectQuery<Omit<T, K1 | K2>>;
    omitProps<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T>(field1: K1, field2: K2, field3: K3): ObjectQuery<Omit<T, K1 | K2 | K3>>;
    omitProps<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4): ObjectQuery<Omit<T, K1 | K2 | K3 | K4>>;
    omitProps<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T, K5 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4, field5: K5): ObjectQuery<Omit<T, K1 | K2 | K3 | K4 | K5>>;
}

export interface ObjectRepository<K extends string|number, V> extends ObjectRepositoryRead<K, V> {
    insert(value: V): Promise<void>;
    replace(value: V): Promise<void>;
    update(value: V): Promise<void>;
    delete(key: K): Promise<void>;
    deleteMany(f: (q: Query<V>) => QueryResult): Promise<void>;
}

export interface ObjectRepositoryFactory<K extends string|number, V> {
    withRepositoryRead<T = any>(func: (repository: ObjectRepositoryRead<K, V>) => Promise<T>): Promise<T>;
    withRepositoryWrite<T = any>(func: (repository: ObjectRepository<K, V>) => Promise<T>): Promise<T>;
}

export interface ObjectNamedRepositoryFactory<K extends string|number, V> {
    withRepositoryRead<T = any>(dbName: string, func: (repository: ObjectRepositoryRead<K, V>) => Promise<T>): Promise<T>;
    withRepositoryWrite<T = any>(dbName: string, func: (repository: ObjectRepository<K, V>) => Promise<T>): Promise<T>;
    createRepository(dbName: string): Promise<void>;
    removeRepository(dbName: string): Promise<void>;
}

export interface SimpleObjectRepositoryRead<K extends string|number, V> {
    get(key: K): Promise<Immutable<V>>;
    getMulti(keys: K[]): Promise<Immutable<V>[]>;
    getOrDefault(key: K, def: V): Promise<Immutable<V>>;
    getAll(): Promise<Immutable<V>[]>;
    count(f: (q: Query<V>) => QueryResult): Promise<number>;
    find(f: (q: Query<V>) => QueryResult): Promise<V>;
    findAll(f: (q: Query<V>) => QueryResult): Promise<V[]>;
    exists(key: K): Promise<boolean>;
    query(f: (q: Query<V>) => QueryResult): ObjectQuery<V>;
}

export interface SimpleObjectRepository<K extends string|number, V> extends SimpleObjectRepositoryRead<K, V> {
    insert(value: V): Promise<void>;
    replace(value: V): Promise<void>;
    update(value: V): Promise<void>;
    delete(key: K): Promise<void>;
}
