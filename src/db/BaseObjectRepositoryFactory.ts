/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { DbManager } from "./DbManager";
import { ObjectRepository, ObjectRepositoryFactory, ObjectRepositoryRead } from "./ObjectRepository";

export class BaseObjectRepositoryFactory<K extends string|number, V> implements ObjectRepositoryFactory<K, V>  {
    
    private repositoryFactory: ObjectRepositoryFactory<K, V>;
    
    constructor(
        private dbManager: DbManager,
        dbName: string,
        idProperty: keyof V
    ) {
        this.repositoryFactory = this.dbManager.createObjectRepositoryFactory(dbName, idProperty);
    }
    
    withRepositoryRead<T = any>(func: (repository: ObjectRepositoryRead<K, V>) => Promise<T>): Promise<T> {
        return this.repositoryFactory.withRepositoryRead(func);
    }
    
    withRepositoryWrite<T = any>(func: (repository: ObjectRepository<K, V>) => Promise<T>): Promise<T> {
        return this.repositoryFactory.withRepositoryWrite(func);
    }
}
