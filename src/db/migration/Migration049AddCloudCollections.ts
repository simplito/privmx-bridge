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

export class Migration049AddCloudCollections {
    
    static id = <MigrationId>"Migration_049_AddCloudCollections";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const contextCollection = await dbManager.createOrGetCollection("context");
        await contextCollection.createIndex("appPubKey");
        
        const contextUserCollection = await dbManager.createOrGetCollection("contextUser");
        await contextUserCollection.createIndex("userId");
        await contextUserCollection.createIndex("contextId");
        await contextUserCollection.createIndex("userPubKey");
        
        const threadCollection = await dbManager.createOrGetCollection("thread2");
        await threadCollection.createIndex("contextId");
        
        const threadMessageCollection = await dbManager.createOrGetCollection("thread2Message");
        await threadMessageCollection.createIndex("threadId");
    }
}
