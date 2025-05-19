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

export class Migration064ResourceId {
    
    static id = <MigrationId>"Migration_064_ResourceId";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const threadCollection = await dbManager.createOrGetCollection("thread");
        await threadCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
        
        const threadMessageCollection = await dbManager.createOrGetCollection("threadMessage");
        await threadMessageCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
        
        const storeFileCollection = await dbManager.createOrGetCollection("storeFile");
        await storeFileCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
        
        const storeCollection = await dbManager.createOrGetCollection("store");
        await storeCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
        
        const streamCollection = await dbManager.createOrGetCollection("stream");
        await streamCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
        
        const inboxCollection = await dbManager.createOrGetCollection("inbox");
        await inboxCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
    }
}
