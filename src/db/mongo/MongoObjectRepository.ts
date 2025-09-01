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
import { ObjectRepository, Query, QueryResult, ObjectQuery } from "../ObjectRepository";
import { MongoQuery } from "./MongoQuery";
import { MongoObjectQuery } from "./MongoObjectQuery";
import { MicroTimeUtils } from "../../utils/MicroTimeUtils";
import { MetricService } from "../../service/misc/MetricService";
import * as types from "../../types";
import { ListWithCount } from "../../CommonTypes";
import { AppException } from "../../api/AppException";
import { MongoQueryConverter } from "./MongoQueryConverter";
import { DbDuplicateError } from "../../error/DbDuplicateError";

export class MongoObjectRepository<K extends string|number, V> implements ObjectRepository<K, V> {
    
    constructor(
        public collection: mongodb.Collection<any>,
        private idProperty: keyof V,
        private session: mongodb.ClientSession|undefined,
        private logger: Logger,
        private metricService: MetricService,
    ) {
    }
    
    col<T extends mongodb.Document>() {
        return this.collection as mongodb.Collection<T>;
    }
    
    getSession() {
        return this.session;
    }
    
    generateId() {
        return new mongodb.ObjectId().toHexString() as K;
    }
    
    convertFromDbObj(dbObj: V): V {
        (<any>dbObj)[this.idProperty] = (<any>dbObj)._id;
        delete (<any>dbObj)._id;
        return dbObj;
    }
    
    convertFromDbObjEx<T>(dbObj: T): T {
        (<any>dbObj)[this.idProperty] = (<any>dbObj)._id;
        delete (<any>dbObj)._id;
        return dbObj;
    }
    
    convertToDbObj(obj: V): V {
        const dbObj: any = {};
        for (const key in <any>obj) {
            dbObj[key == this.idProperty ? "_id" : key] = (<any>obj)[key];
        }
        return dbObj;
    }
    
    getOptions<T extends {session?: mongodb.ClientSession}>(opt?: T): T {
        opt = opt || <T>{};
        if (this.session) {
            opt.session = this.session;
        }
        return opt;
    }
    
    async get(key: K): Promise<V|null> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            const x = await this.collection.findOne<V>({_id: key}, this.getOptions());
            return x ? this.convertFromDbObj(x) : null;
        }
        finally {
            this.logger.time(startTime, "Mongo get", this.collection.collectionName, key);
        }
    }
    
    async getMulti(keys: K[]): Promise<V[]> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            if (keys.length === 0) {
                return [];
            }
            if (keys.length === 1) {
                const x = await this.collection.findOne<V>({_id: keys[0]}, this.getOptions());
                return x ? [this.convertFromDbObj(x)] : [];
            }
            const list = await this.collection.find({_id: {$in: keys}}, this.getOptions()).toArray();
            return list.map(x => this.convertFromDbObj(x as V));
        }
        finally {
            this.logger.time(startTime, "Mongo getMulti", this.collection.collectionName, keys);
        }
    }
    
    async getOrDefault(key: K, def: V): Promise<V> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            const x = await this.collection.findOne<V>({_id: key}, this.getOptions());
            return x ? this.convertFromDbObj(x) : def;
        }
        finally {
            this.logger.time(startTime, "Mongo getOrDefault", this.collection.collectionName, key);
        }
    }
    
    async getAll(): Promise<V[]> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            const list = await this.collection.find({}, this.getOptions()).toArray();
            return list.map(x => this.convertFromDbObj(x as V));
        }
        finally {
            this.logger.time(startTime, "Mongo getAll", this.collection.collectionName);
        }
    }
    
    async count(f: (q: Query<V>) => QueryResult): Promise<number> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        const query = f(new MongoQuery(this.idProperty));
        try {
            return await this.collection.countDocuments(query);
        }
        finally {
            this.logger.time(startTime, "Mongo count", this.collection.collectionName, JSON.stringify(query));
        }
    }
    
    async find(f: (q: Query<V>) => QueryResult): Promise<V|null> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        const query = f(new MongoQuery(this.idProperty));
        try {
            const x = await this.collection.findOne<V>(query, this.getOptions());
            return x ? this.convertFromDbObj(x) : null;
        }
        finally {
            this.logger.time(startTime, "Mongo find", this.collection.collectionName, JSON.stringify(query));
        }
    }
    
    async findAll(f: (q: Query<V>) => QueryResult): Promise<V[]> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        const query = f(new MongoQuery(this.idProperty));
        try {
            const list = await this.collection.find(query, this.getOptions()).toArray();
            return list.map(x => this.convertFromDbObj(x as V));
        }
        finally {
            this.logger.time(startTime, "Mongo findAll", this.collection.collectionName, JSON.stringify(query));
        }
    }
    
    async exists(key: K): Promise<boolean> {
        return (await this.get(key)) != null;
    }
    
    async insert(value: V): Promise<void> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            await this.collection.insertOne(this.convertToDbObj(value), this.getOptions());
            return;
        }
        catch (error) {
            if (this.isMongoDuplicateError(error)) {
                throw new DbDuplicateError();
            }
            throw error;
        }
        finally {
            this.logger.time(startTime, "Mongo insert", this.collection.collectionName, value[this.idProperty]);
        }
    }
    
    async replace(value: V): Promise<void> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            await this.collection.replaceOne({_id: value[this.idProperty]}, this.withoutId(this.convertToDbObj(value)), this.getOptions());
            return;
        }
        finally {
            this.logger.time(startTime, "Mongo replace", this.collection.collectionName, value[this.idProperty]);
        }
    }
    
    async update(value: V): Promise<void> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            await this.collection.replaceOne({_id: value[this.idProperty]}, this.withoutId(this.convertToDbObj(value)), this.getOptions<mongodb.ReplaceOptions>({upsert: true}));
            return;
        }
        catch (error) {
            if (this.isMongoDuplicateError(error)) {
                throw new DbDuplicateError();
            }
            throw error;
        }
        finally {
            this.logger.time(startTime, "Mongo update", this.collection.collectionName, value[this.idProperty]);
        }
    }
    
    async forceUpdate(value: V) {
        await this.update({...value, __forceUpdate: true});
        await this.update(value);
    }
    
    async delete(key: K): Promise<void> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        try {
            await this.collection.deleteOne({_id: key}, this.getOptions());
            return;
        }
        finally {
            this.logger.time(startTime, "Mongo delete", this.collection.collectionName, key);
        }
    }
    
    async deleteMany(f: (q: Query<V>) => QueryResult): Promise<void> {
        const startTime = MicroTimeUtils.now();
        this.metricService.addDbRequest();
        const query = f(new MongoQuery(this.idProperty));
        try {
            await this.collection.deleteMany(query, this.getOptions());
            return;
        }
        finally {
            this.logger.time(startTime, "Mongo delete many", this.collection.collectionName, JSON.stringify(query));
        }
    }
    
    query(f: (q: Query<V>) => QueryResult): ObjectQuery<V> {
        return new MongoObjectQuery(this.collection, f(new MongoQuery(this.idProperty)), x => this.convertFromDbObj(x), this.session, <string> this.idProperty, this.logger, this.metricService);
    }
    
    /** Perform find with sort, skip and limit and returns list of found elements and count of all matched elements */
    async matchX(match: any, listParams: types.core.ListModel, sortBy: keyof V, queryRootField?: string) {
        const mongoQueries = listParams.query ? [MongoQueryConverter.convertQuery(listParams.query, queryRootField)] : [];
        return this.getMatchingPage([{$match: match}, ...mongoQueries], listParams, sortBy);
    }
    
    /** Extracts lastModificationDate from item and uses it for sorting */
    async matchWithUpdates(match: any, listParams: types.core.ListModel, sortBy: keyof V, queryRootField?: string) {
        const extendedStage: any[] = listParams.query ? [MongoQueryConverter.convertQuery(listParams.query, queryRootField)] : [];
        if (sortBy === "updates") {
            extendedStage.push({
                $addFields: {
                    lastModificationDate: {
                        $getField: {
                            field: "createDate",
                            input: { $arrayElemAt: ["$updates", -1] },
                        },
                    },
                },
            });
        }
        return this.getMatchingPage([{$match: match}, ...extendedStage], listParams, sortBy === "updates" ? "lastModificationDate" as keyof V : sortBy);
    }
    
    async getMatchingPage<X = V>(stages: any[], listParams: types.core.ListModel, sortBy: keyof V) {
        if (listParams.lastId) {
            const temporaryListProperties = {
                limit: listParams.limit,
                skip: 0,
                sortOrder: listParams.sortOrder,
            };
            const lastObject = (await this.get(listParams.lastId as K)) as V;
            if (!lastObject) {
                throw new AppException("NO_MATCH_FOR_LAST_ID");
            }
            const theSortBy = sortBy == this.idProperty ? "_id" : sortBy || "_id";
            const additionalCriteria = {
                $match: {
                    [theSortBy]: { [(listParams.sortOrder === "asc") ? "$gte" : "$lte"]: lastObject[sortBy] },
                    "_id": {$ne: listParams.lastId},
                },
            };
            stages.push(additionalCriteria);
            return await this.aggregationX<X>(stages, temporaryListProperties, sortBy);
        }
        return this.aggregationX<X>(stages, listParams, sortBy);
    }
    
    /** Perform given stages with sort, skip and limit and returns list of found elements and count of all matched elements */
    async aggregationX<X = V>(stages: any[], listParams: types.core.ListModel, sortBy: keyof V): Promise<ListWithCount<X>> {
        const theSortBy = sortBy == this.idProperty ? "_id" : sortBy || "_id";
        const pipeline = [
            ...stages,
            {
                $sort: {
                    [theSortBy]: listParams.sortOrder === "asc" ? 1 : -1,
                },
            },
            {
                $facet: {
                    totalData: [{$skip: listParams.skip}, {$limit: listParams.limit}],
                    totalCount: [{$count: "count"}],
                },
            },
        ];
        const result = <{totalData: X[], totalCount: {count: number}[]}[]> await this.collection.aggregate(pipeline).toArray();
        return {list: result[0].totalData.map(x => this.convertFromDbObjEx(x)), count: result[0].totalCount.length === 0 ? 0 : result[0].totalCount[0].count};
    }
    
    async matchX2(match: any, listParams: types.core.ListModel2<K>) {
        if (listParams.from) {
            match._id = listParams.sortOrder === "asc" ? {$gt: listParams.from} : {$lt: listParams.from};
        }
        const pipeline = [
            {
                $match: match,
            },
            {
                $sort: {
                    _id: listParams.sortOrder === "asc" ? 1 : -1,
                },
            },
            {
                $facet: {
                    totalData: [{$limit: listParams.limit}],
                    totalCount: [{$count: "count"}],
                },
            },
        ];
        const result = <{totalData: V[], totalCount: {count: number}[]}[]> await this.collection.aggregate(pipeline).toArray();
        return {list: result[0].totalData.map(x => this.convertFromDbObjEx(x)), count: result[0].totalCount.length === 0 ? 0 : result[0].totalCount[0].count};
    }
    
    private withoutId<Q>(obj: Q): Omit<Q, "_id"> {
        delete (obj as any)._id;
        return obj;
    }
    
    isMongoDuplicateError(e: unknown): boolean {
        return (e !== null && typeof(e) === "object") && "code" in e && e.code === 11000;
    }
}
