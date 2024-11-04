/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { MongoDbManager } from "./mongo/MongoDbManager";
import { IBinaryRepositoryFactory } from "./BinaryRepository";
import { ObjectRepositoryFactory, ObjectNamedRepositoryFactory } from "./ObjectRepository";
import { MongoObjectRepositoryFactory } from "./mongo/MongoObjectRepositoryFactory";
import { MongoObjectNamedRepositoryFactory } from "./mongo/MongoObjectNamedRepositoryFactory";

export type BinaryRepositoryFactoryFunc = (dbName: string) => IBinaryRepositoryFactory<any>;

export class DbManager {
    
    constructor(
        private mongoDbManager: MongoDbManager,
    ) {
    }
    
    generateId() {
        return this.mongoDbManager.generateId();
    }
    
    createObjectRepositoryFactory<K extends string|number, V>(dbName: string, idProperty: keyof V): ObjectRepositoryFactory<K, V> {
        return new MongoObjectRepositoryFactory(this.mongoDbManager, dbName, idProperty);
    }
    
    createObjectNamedRepositoryFactory<K extends string|number, V>(dbType: string, idProperty: keyof V): ObjectNamedRepositoryFactory<K, V> {
        return new MongoObjectNamedRepositoryFactory(this.mongoDbManager, dbType, idProperty);
    }
}
