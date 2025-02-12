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

export class Migration062IndexesForCreateDate {
    
    static id = <MigrationId>"Migration_062_IndexesForCreateDate";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const storeCollection = await dbManager.createOrGetCollection("storeFile");
        await storeCollection.createIndex({createDate: 1});
        
        const streamCollection = await dbManager.createOrGetCollection("threadMessage");
        await streamCollection.createIndex({createDate: 1});
    }
}
