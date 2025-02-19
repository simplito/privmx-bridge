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

export class Migration063AddDataToContainers {
    
    static id = <MigrationId>"Migration_063_AddDataToContainers";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        async function assignDataFromHistory(collectionName: string) {
            const collection = await dbManager.createOrGetCollection<{history: {data: unknown}[], data: unknown}>(collectionName);
            
            for (const entry of await collection.find({}).toArray()) {
                const last = entry.history[entry.history.length - 1];
                entry.data = last.data;
                await collection.replaceOne({_id: entry._id}, entry);
            }
        }
        
        async function assignDataFromHistoryInInbox() {
            const collection = await dbManager.createOrGetCollection<{history: {data: {meta: unknown}}[], data: unknown}>("inbox");
            
            for (const entry of await collection.find({}).toArray()) {
                const last = entry.history[entry.history.length - 1];
                entry.data = last.data.meta;
                await collection.replaceOne({_id: entry._id}, entry);
            }
        }
        
        await assignDataFromHistory("thread");
        await assignDataFromHistory("store");
        await assignDataFromHistory("streamRoom");
        await assignDataFromHistoryInInbox();
    }
}
