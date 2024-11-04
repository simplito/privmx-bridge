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

export class Migration060IndexesForSortableFields {
    
    static id = <MigrationId>"Migration_060_IndexesForSortableFields";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const storeCollection = await dbManager.createOrGetCollection("store");
        await storeCollection.createIndex({createDate: 1})
        await storeCollection.createIndex({lastModificationDate: 1})
        await storeCollection.createIndex({lastFileDate: 1})

        const streamCollection = await dbManager.createOrGetCollection("streamRoom");
        await streamCollection.createIndex({createDate: 1})
        await streamCollection.createIndex({lastModificationDate: 1})

        const threadCollection = await dbManager.createOrGetCollection("thread");
        await threadCollection.createIndex({createDate: 1})
        await threadCollection.createIndex({lastModificationDate: 1})
        await threadCollection.createIndex({lastMsgDate: 1})

        const inboxCollection = await dbManager.createOrGetCollection("inbox");
        await inboxCollection.createIndex({createDate: 1})
        await inboxCollection.createIndex({lastModificationDate: 1})

        const contextUserCollection = await dbManager.createOrGetCollection("contextUser");
        await contextUserCollection.createIndex({created: 1})
    }
}