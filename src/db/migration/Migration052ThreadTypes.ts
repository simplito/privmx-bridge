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

export class Migration052ThreadTypes {
    
    static id = <MigrationId>"Migration_052_ThreadTypes";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const mongoDb = dbManager.getDb();
        
        const threadCollection = mongoDb.collection("thread2");
        await threadCollection.updateMany({type: {$exists: false}}, {$set: {type: "thread"}});
    }
}
