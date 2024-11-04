/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as pki from "privmx-pki2";
import { MongoDbManager } from "./MongoDbManager";
import { MongoKVRepository } from "./MongoKVRepository";

export class MongoKVRepositoryFactory implements pki.db.KVRepositoryFactory {
    
    constructor(
        private dbName: string,
        private dbManager: MongoDbManager
    ) {
    }
    
    withProvider<T = any>(func: (repository: pki.db.KVProvider) => Promise<T>): Promise<T> {
        return this.dbManager.withMongo(this.dbName, "", db => {
            return func(new MongoKVRepository(db, null, this.dbManager.logger));
        });
    }
    
    withRepository<T = any>(func: (repository: pki.db.KVRepository) => Promise<T>): Promise<T> {
        return this.dbManager.withMongo(this.dbName, "", db => {
            return this.dbManager.withTransaction(session => {
                return func(new MongoKVRepository(db, session, this.dbManager.logger));
            });
        });
    }
    
    withRepositoryLock<T = any>(lock: string|string[], func: (repository: pki.db.KVRepository) => Promise<T>): Promise<T> {
        if (typeof(lock) == "string") {
            lock = this.dbName + "-" + lock;
        }
        else {
            lock = lock.map(x => this.dbName + "-" + x);
        }
        return this.dbManager.withMongo(this.dbName, "", db => {
            return this.dbManager.withTransactionAndLock(lock, session => {
                return func(new MongoKVRepository(db, session, this.dbManager.logger));
            });
        });
    }
}
