/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoDbManager } from "./MongoDbManager";
import { ObjectNamedRepositoryFactory, ObjectRepositoryRead, ObjectRepository } from "../ObjectRepository";
import { MongoObjectRepository } from "./MongoObjectRepository";

export class MongoObjectNamedRepositoryFactory<K extends string|number, V> implements ObjectNamedRepositoryFactory<K, V> {
    
    constructor(
        private dbManager: MongoDbManager,
        private dbType: string,
        private idProperty: keyof V
    ) {
    }
    
    withRepositoryRead<T = any>(dbName: string, func: (repository: ObjectRepositoryRead<K, V>) => Promise<T>): Promise<T> {
        return this.dbManager.withMongo(this.dbType, dbName, db => {
            return func(new MongoObjectRepository(db, this.idProperty, null, this.dbManager.logger, this.dbManager.metricService));
        });
    }
    
    withRepositoryWrite<T = any>(dbName: string, func: (repository: ObjectRepository<K, V>) => Promise<T>): Promise<T> {
        return this.dbManager.withMongo(this.dbType, dbName, db => {
            return func(new MongoObjectRepository(db, this.idProperty, null, this.dbManager.logger, this.dbManager.metricService));
        });
    }
    
    async createRepository(dbName: string): Promise<void> {
        await this.dbManager.createSubCollection(this.dbType, dbName);
    }
    
    async removeRepository(dbName: string): Promise<void> {
        await this.dbManager.removeCollection(this.dbType, dbName);
    }
}
