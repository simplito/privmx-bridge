/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoDbManager } from "./MongoDbManager";
import { ObjectRepositoryFactory, ObjectRepositoryRead, ObjectRepository } from "../ObjectRepository";
import { MongoObjectRepository } from "./MongoObjectRepository";

export class MongoObjectRepositoryFactory<K extends string|number, V> implements ObjectRepositoryFactory<K, V> {
    
    constructor(
        private dbManager: MongoDbManager,
        private dbName: string,
        private idProperty: keyof V
    ) {
    }
    
    withRepositoryRead<T = any>(func: (repository: ObjectRepositoryRead<K, V>) => Promise<T>): Promise<T> {
        return this.dbManager.withMongo(this.dbName, "", db => {
            return func(new MongoObjectRepository(db, this.idProperty, null, this.dbManager.logger, this.dbManager.metricService));
        });
    }
    
    withRepositoryWrite<T = any>(func: (repository: ObjectRepository<K, V>) => Promise<T>): Promise<T> {
        return this.dbManager.withMongo(this.dbName, "", db => {
            return func(new MongoObjectRepository(db, this.idProperty, null, this.dbManager.logger, this.dbManager.metricService));
        });
    }
}
