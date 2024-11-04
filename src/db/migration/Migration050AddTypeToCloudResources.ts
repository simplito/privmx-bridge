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

export class Migration050AddTypeToCloudResources {
    
    static id = <MigrationId>"Migration_050_AddTypeToCloudResources";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const threadCollection = await dbManager.createOrGetCollection("thread2");
        await threadCollection.createIndex("type");
        
        const storeCollection = await dbManager.createOrGetCollection("store");
        await storeCollection.createIndex("type");
        
        const inboxCollection = await dbManager.createOrGetCollection("inbox");
        await inboxCollection.createIndex("type");
        
        const streamRoomCollection = await dbManager.createOrGetCollection("streamRoom");
        await streamRoomCollection.createIndex("type");
    }
}
