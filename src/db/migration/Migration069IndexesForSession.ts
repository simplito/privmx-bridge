/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IOC } from "../../service/ioc/IOC";
import { MigrationId } from "./MigrationManager";

export class Migration069IndexesForSession {
    
    static id = <MigrationId>"Migration_069_Indexes_for_session";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const sessionCollection = await dbManager.createOrGetCollection("session");
        await sessionCollection.createIndex({
            "data.state": 1,
            "data.lastUsage": -1,
            "data.createdDate": -1,
            "data.restoreKey": 1,
        });
        const ticketDataCollection = await dbManager.createOrGetCollection("ticketData");
        await ticketDataCollection.createIndex({ "sessionId": 1 });
        
        const threadCollection = await dbManager.createOrGetCollection("thread");
        await threadCollection.createIndex({ contextId: 1, users: 1, createDate: -1 });
        await threadCollection.createIndex({ contextId: 1, managers: 1, createDate: -1 });
        
        const storeCollection = await dbManager.createOrGetCollection("store");
        await storeCollection.createIndex({ contextId: 1, users: 1, createDate: -1 });
        await storeCollection.createIndex({ contextId: 1, managers: 1, createDate: -1 });
        
        const kvdbCollection = await dbManager.createOrGetCollection("kvdb");
        await kvdbCollection.createIndex({ contextId: 1, users: 1, createDate: -1 });
        await kvdbCollection.createIndex({ contextId: 1, managers: 1, createDate: -1 });
        
        const streamCollection = await dbManager.createOrGetCollection("stream");
        await streamCollection.createIndex({ contextId: 1, users: 1, createDate: -1 });
        await streamCollection.createIndex({ contextId: 1, managers: 1, createDate: -1 });
    }
}
