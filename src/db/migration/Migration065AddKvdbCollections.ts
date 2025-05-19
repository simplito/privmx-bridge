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

export class Migration065AddKvdbCollections {
    
    static id = <MigrationId>"Migration_065_AddKvdbCollections";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const kvdbCollection = await dbManager.createOrGetCollection("kvdb");
        await kvdbCollection.createIndex("contextId");
        await kvdbCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
        
        const kvdbEntryCollection = await dbManager.createOrGetCollection("kvdbEntry");
        await kvdbEntryCollection.createIndex("kvdbId");
        await kvdbEntryCollection.createIndex("entryKey");
    }
}
