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
import { MongoKVRepositoryFactory } from "./MongoKVRepositoryFactory";
import * as mongodb from "mongodb";

export class MongoKVRepositoryFactoryEx implements pki.db.KVRepositoryFactoryEx {
    
    constructor(
        public dbManager: MongoDbManager
    ) {
    }
    
    withName(dbName: string): pki.db.KVRepositoryFactory {
        return new MongoKVRepositoryFactory(dbName, this.dbManager);
    }
    
    createVRFMessageRepository(): pki.db.KVSimpleRepository {
        const collection = this.dbManager.getCollectionByName("pki-vrf-message");
        return new MongoKVRepository(collection, null, this.dbManager.logger);
    }
    
    private getTreeLockId() {
        return "pki-tree-lock";
    }
    
    private getTreeCollectioName() {
        return "pki-tree";
    }
    
    withTreeRepositoryLock<T>(session: mongodb.ClientSession, func: (repo: pki.db.KVRepository) => Promise<T>) {
        return this.dbManager.withLock(this.getTreeLockId(), session, async () => {
            const collection = this.dbManager.getCollectionByName(this.getTreeCollectioName());
            const repository = new MongoKVRepository(collection, session, this.dbManager.logger) as pki.db.KVRepository;
            return func(repository);
        });
    }
    
    createTreeProvider() {
        const collection = this.dbManager.getCollectionByName(this.getTreeCollectioName());
        return new MongoKVRepository(collection, null, this.dbManager.logger) as pki.db.KVProvider;
    }
}
