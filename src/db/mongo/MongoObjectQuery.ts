/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as mongodb from "mongodb";
import { Logger } from "../../service/log/LoggerFactory";
import { MetricService } from "../../service/misc/MetricService";
import { MicroTimeUtils } from "../../utils/MicroTimeUtils";
import { Utils } from "../../utils/Utils";
import { ObjectQuery, PickProperty, QueryResult } from "../ObjectRepository";

export class MongoObjectQuery<T> implements ObjectQuery<T> {
    
    limitValue?: number;
    skipValue?: number;
    sorts: {field: string, asc: boolean}[] = [];
    selectedProps: string[] = [];
    omittedProps: string[] = [];
    
    constructor(
        private collection: mongodb.Collection,
        private query: QueryResult,
        private convertFromDb: (x: T) => T,
        private session: mongodb.ClientSession|undefined,
        private idProperty: string,
        private logger: Logger,
        private metricService: MetricService,
    ) {
    }
    
    getOptions<Z extends {session?: mongodb.ClientSession} = any>(opt?: Z): Z {
        opt = opt || <Z>{};
        if (this.session) {
            opt.session = this.session;
        }
        return opt;
    }
    
    prepare(addSession: boolean) {
        let cursor = this.collection.find(this.query, addSession ? this.getOptions() : {});
        if (this.selectedProps.length > 0 || this.omittedProps.length > 0) {
            const obj: any = {};
            for (const entry of this.selectedProps) {
                obj[entry == this.idProperty ? "_id" : entry] = 1;
            }
            for (const entry of this.omittedProps) {
                obj[entry == this.idProperty ? "_id" : entry] = 0;
            }
            cursor = cursor.project(obj);
        }
        if (this.limitValue != null) {
            cursor = cursor.limit(this.limitValue);
        }
        if (this.skipValue != null) {
            cursor = cursor.skip(this.skipValue);
        }
        if (this.sorts.length > 0) {
            const obj: any = {};
            for (const entry of this.sorts) {
                obj[entry.field == this.idProperty ? "_id" : entry.field] = entry.asc ? 1 : -1;
            }
            cursor = cursor.sort(obj);
        }
        return cursor;
    }
    
    async one(): Promise<T|null> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            const list = await this.limit(1).prepare(true).toArray();
            return list.length > 0 ? this.convertFromDb(list[0] as T) : null;
        }
        finally {
            this.logger.time(startTime, "Mongo query one", this.collection.collectionName, JSON.stringify(this.query));
        }
    }
    
    async array(): Promise<T[]> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            const list = await this.prepare(true).toArray();
            return list.map(x => this.convertFromDb(x as T));
        }
        finally {
            this.logger.time(startTime, "Mongo query array", this.collection.collectionName, JSON.stringify(this.query));
        }
    }
    
    async count(): Promise<number> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            return await this.collection.countDocuments(this.query, {});
        }
        finally {
            this.logger.time(startTime, "Mongo query count", this.collection.collectionName, JSON.stringify(this.query));
        }
    }
    
    async exists(): Promise<boolean> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            const res = await this.count();
            return res > 0;
        }
        finally {
            this.logger.time(startTime, "Mongo query exists", this.collection.collectionName, JSON.stringify(this.query));
        }
    }
    
    limit(limit: number): MongoObjectQuery<T> {
        this.limitValue = limit;
        return this;
    }
    
    skip(skip: number): MongoObjectQuery<T> {
        this.skipValue = skip;
        return this;
    }
    
    sort(field: string, asc: boolean): MongoObjectQuery<T> {
        this.sorts.push({field: field, asc: asc});
        return this;
    }
    
    props<K extends keyof T>(field: K): ObjectQuery<Pick<T, K>>;
    props<K1 extends keyof T, K2 extends keyof T>(field1: K1, field2: K2): ObjectQuery<Pick<T, K1 | K2>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T>(field1: K1, field2: K2, field3: K3): ObjectQuery<Pick<T, K1 | K2 | K3>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4): ObjectQuery<Pick<T, K1 | K2 | K3 | K4>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T, K5 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4, field5: K5): ObjectQuery<Pick<T, K1 | K2 | K3 | K4 | K5>>;
    props<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T, K5 extends keyof T, K6 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4, field5: K5, field6: K6): ObjectQuery<Pick<T, K1 | K2 | K3 | K4 | K5 | K6>>;
    props(...fields: (keyof T)[]): ObjectQuery<T> {
        this.selectedProps = this.selectedProps.concat(<string[]>fields);
        return this;
    }
    
    propsChild<PK extends keyof T, K extends keyof T[PK]>(field: PK, childField: K): ObjectQuery<PickProperty<T, PK, K>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2): ObjectQuery<PickProperty<T, PK, K1 | K2>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK], K3 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2, childField3: K3): ObjectQuery<PickProperty<T, PK, K1 | K2 | K3>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK], K3 extends keyof T[PK], K4 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2, childField3: K3, childField4: K4): ObjectQuery<PickProperty<T, PK, K1 | K2 | K3 | K4>>;
    propsChild<PK extends keyof T, K1 extends keyof T[PK], K2 extends keyof T[PK], K3 extends keyof T[PK], K4 extends keyof T[PK], K5 extends keyof T[PK]>(field: PK, childField1: K1, childField2: K2, childField3: K3, childField4: K4, childField5: K5): ObjectQuery<PickProperty<T, PK, K1 | K2 | K3 | K4 | K5>>;
    propsChild<PK extends keyof T>(field: PK, ...childFields: (keyof T[PK])[]): ObjectQuery<PickProperty<T, PK, any>> {
        Utils.removeFromArray(this.selectedProps, <string>field);
        this.selectedProps = this.selectedProps.concat(childFields.map(x => (field as string) + "." + (x as string)));
        return this as ObjectQuery<PickProperty<T, PK, any>>;
    }
    
    omitProps<K extends keyof T>(field: K): ObjectQuery<Omit<T, K>>;
    omitProps<K1 extends keyof T, K2 extends keyof T>(field1: K1, field2: K2): ObjectQuery<Omit<T, K1 | K2>>;
    omitProps<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T>(field1: K1, field2: K2, field3: K3): ObjectQuery<Omit<T, K1 | K2 | K3>>;
    omitProps<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4): ObjectQuery<Omit<T, K1 | K2 | K3 | K4>>;
    omitProps<K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T, K5 extends keyof T>(field1: K1, field2: K2, field3: K3, field4: K4, field5: K5): ObjectQuery<Omit<T, K1 | K2 | K3 | K4 | K5>>;
    omitProps(...fields: (keyof T)[]): ObjectQuery<T> {
        this.omittedProps = this.omittedProps.concat(<string[]>fields);
        return this;
    }
}
