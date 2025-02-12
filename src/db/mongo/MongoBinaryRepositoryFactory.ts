/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IBinaryRepositoryFactory, BinaryRepository2Read, BinaryRepository2 } from "../BinaryRepository";
import { MongoDbManager } from "./MongoDbManager";

export class MongoBinaryRepositoryFactory<K extends string> implements IBinaryRepositoryFactory<K> {
    
    constructor(
        private mongoDbManager: MongoDbManager,
        private dbName: string,
    ) {
    }
    
    withRepositoryRead<T = any>(func: (repository: BinaryRepository2Read<K>) => Promise<T>): Promise<T> {
        return this.mongoDbManager.withBinaryMongo<T, K>(this.dbName, db => {
            return func(db);
        });
    }
    
    withRepositoryWrite<T = any>(func: (repository: BinaryRepository2<K>) => Promise<T>): Promise<T> {
        return this.mongoDbManager.withBinaryMongo<T, K>(this.dbName, db => {
            return func(db);
        });
    }
    
    async getDiskUsage(): Promise<number> {
        return 0;
    }
    
    async initialize(): Promise<void> {
        await this.mongoDbManager.tryCreateCollection(this.dbName, []);
    }
}