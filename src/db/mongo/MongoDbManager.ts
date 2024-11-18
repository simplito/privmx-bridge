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
import { MongoBinaryDb } from "./MongoBinaryDb";
import { MongoObjectRepository } from "./MongoObjectRepository";
import { Utils } from "../../utils/Utils";
import { MetricService } from "../../service/misc/MetricService";

export type CollectionMap = {[name: string]: Promise<mongodb.Collection>};
export type MongoObj<T extends {id: string}> = Omit<T, "id">&{_id: T["id"]};

export interface Collection {
    name: string;
    type?: string;
}

export interface MongoInstance {
    client: mongodb.MongoClient;
    db: mongodb.Db;
}

const LOCK_COLLECTION_NAME = "__lock";

export class MongoDbManager {
    
    private mongo: MongoInstance|null;
    private indexesForSubCollections: {[collectionType: string]: string[]} = {
        "kvdbentry": ["seq"],
        "msg": ["modSeq"]
    };
    
    constructor(
        private client: mongodb.MongoClient|null,
        public readonly logger: Logger,
        public readonly metricService: MetricService,
    ) {
        // this.logger.level = Logger.DEBUG;
        this.mongo = null;
    }
    
    checkInitialization(mongo: MongoInstance|null): asserts mongo is MongoInstance {
        if (mongo == null) {
            throw new Error("MongoDbManager not initialized yet");
        }
    }
    
    generateId() {
        return new mongodb.ObjectId().toHexString();
    }
    
    getDbName() {
        return this.getDb().databaseName;
    }
    
    async init(mongoUrl: string, dbName: string): Promise<void> {
        if (this.mongo) {
            throw new Error("Already initialized");
        }
        const client = this.client ? this.client : await mongodb.MongoClient.connect(mongoUrl, {minPoolSize: 5, maxPoolSize: 5});
        const db = client.db(dbName);
        this.mongo = {
            db: db,
            client: client
        };
    }
    
    async close() {
        if (this.mongo) {
            await this.mongo.client.close();
            this.mongo = null;
        }
    }
    
    async createSubCollection(collectionType: string, collectionName: string) {
        const dbCollectionName = this.getCollectionName(collectionType, collectionName);
        const result = await this.tryCreateCollection(dbCollectionName, this.indexesForSubCollections[collectionType] || []);
        if (result === false) {
            this.logger.warning("Trying to create already existing collection '" + dbCollectionName + "'");
        }
    }
    
    async tryCreateCollection(dbCollectionName: string, indexes: string[]) {
        this.checkInitialization(this.mongo);
        try {
            const collection = await this.mongo.db.createCollection(dbCollectionName);
            for (const index of indexes) {
                await collection.createIndex(index);
            }
            return true;
        }
        catch (e) {
            if (e instanceof mongodb.MongoError && e.code === 48) {
                return false;
            }
            else {
                throw e;
            }
        }
    }
    
    async createOrGetCollection<T extends mongodb.Document = mongodb.Document>(collectionName: string) {
        this.checkInitialization(this.mongo);
        try {
            return await this.mongo.db.createCollection<T>(collectionName);
        }
        catch (e) {
            if (e instanceof mongodb.MongoError && e.code === 48) {
                return this.mongo.db.collection<T>(collectionName);
            }
            else {
                throw e;
            }
        }
    }
    
    async deleteSubCollection(collectionType: string, collectionName: string) {
        const dbCollectionName = this.getCollectionName(collectionType, collectionName);
        await this.deleteCollection(dbCollectionName);
    }
    
    getCollectionName(collectionType: string, collectionName: string): string {
        return collectionType + (collectionName ? "-" + collectionName : "");
    }
    
    async getCollection<T extends mongodb.Document = mongodb.Document>(collectionType: string, collectionName: string): Promise<mongodb.Collection<T>> {
        this.checkInitialization(this.mongo);
        const dbCollectionName = this.getCollectionName(collectionType, collectionName);
        return this.mongo.db.collection(dbCollectionName);
    }
    
    async removeCollection(collectionType: string, collectionName: string): Promise<boolean|null> {
        this.checkInitialization(this.mongo);
        const dbColName = this.getCollectionName(collectionType, collectionName);
        try {
            return await this.mongo.db.collection(dbColName).drop();
        }
        catch (e) {
            if (e instanceof mongodb.MongoError && e.code == 26) {
                this.logger.warning("Trying to drop not existing collection '" + dbColName + "'");
                return null;
            }
            return Promise.reject(e as Error);
        }
    }
    
    async withBinaryMongo<T, K extends string>(collectionName: string, func: (col: MongoBinaryDb<K>) => Promise<T>): Promise<T> {
        this.checkInitialization(this.mongo);
        return await func(new MongoBinaryDb(await this.getCollection(collectionName, ""), undefined, this.logger));
    }
    
    async withMongo<T>(collectionType: string, collectionName: string, func: (col: mongodb.Collection) => Promise<T>): Promise<T> {
        this.checkInitialization(this.mongo);
        return await func(await this.getCollection(collectionType, collectionName));
    }
    
    async getStorageSize() {
        this.checkInitialization(this.mongo);
        const stats = await this.mongo.db.command({dbStats: 1});
        return <number>stats.storageSize || 0;
    }
    
    getDb() {
        this.checkInitialization(this.mongo);
        return this.mongo.db;
    }
    
    getClient() {
        this.checkInitialization(this.mongo);
        return this.mongo.client;
    }
    
    async withTransaction<T>(func: (session: mongodb.ClientSession) => Promise<T>): Promise<T> {
        this.checkInitialization(this.mongo);
        const session = this.mongo.client.startSession();
        try {
            let res: T|null = null;
            await session.withTransaction(async () => {
                res = await func(session);
            }, {
                readPreference: "primary",
                readConcern: {
                    level: "local"
                },
                writeConcern: {
                    w: "majority"
                }
            });
            return res as T;
        }
        finally {
            await session.endSession();
        }
    }
    
    async ensureLockCollection() {
        await this.tryCreateCollection(LOCK_COLLECTION_NAME, []);
    }
    
    async withLock<T>(lockId: string|string[], session: mongodb.ClientSession, func: () => Promise<T>) {
        this.checkInitialization(this.mongo);
        const locksList = typeof(lockId) === "string" ? [lockId] : Utils.unique(lockId);
        const lockCollection = this.mongo.db.collection<{_id: string}>(LOCK_COLLECTION_NAME);
        for (const lock of locksList) {
            await lockCollection.insertOne({_id: lock}, {session});
        }
        const result = await func();
        // we dont't have to catch exceptions to delete locks because if func throw error, whole transaction will be reverted and all locks also will be reverted
        for (const lock of locksList) {
            await lockCollection.deleteOne({_id: lock}, {session});
        }
        return result;
    }
    
    async withTransactionAndLock<T>(lockId: string|string[], func: (session: mongodb.ClientSession) => Promise<T>): Promise<T> {
        return this.withTransaction(session => this.withLock(lockId, session, () => func(session)));
    }
    
    getRepository<K extends string|number, V extends mongodb.Document>(collectionName: string, idProp: keyof V, session?: mongodb.ClientSession): MongoObjectRepository<K, V> {
        this.checkInitialization(this.mongo);
        return new MongoObjectRepository(this.mongo.db.collection<V>(collectionName), idProp, session, this.logger, this.metricService);
    }
    
    getCollectionByName<T extends mongodb.Document = mongodb.Document>(colName: string) {
        this.checkInitialization(this.mongo);
        return this.mongo.db.collection<T>(colName);
    }
    
    async createCollections(collectionsToCreate: string[]) {
        this.checkInitialization(this.mongo);
        const db = this.mongo.db;
        const collections: Collection[] = await db.listCollections().toArray();
        
        for (const collection of collectionsToCreate) {
            if (!collections.some(x => x.name == collection)) {
                await db.createCollection(collection);
            }
        }
    }
    
    async createIndexes(info: {[collectionName: string]: string[]}) {
        this.checkInitialization(this.mongo);
        for (const collectioName in info) {
            const indexes = info[collectioName];
            const collection = this.mongo.db.collection(collectioName);
            for (const index of indexes) {
                await collection.createIndex(index);
            }
        }
    }
    
    async deleteCollection(collectionName: string): Promise<boolean|null> {
        this.checkInitialization(this.mongo);
        try {
            return await this.mongo.db.collection(collectionName).drop();
        }
        catch (e) {
            if (e instanceof mongodb.MongoError && e.code == 26) {
                this.logger.warning("Trying to drop not existing collection '" + collectionName + "'");
                return null;
            }
            return Promise.reject(e as Error);
        }
    }
}
