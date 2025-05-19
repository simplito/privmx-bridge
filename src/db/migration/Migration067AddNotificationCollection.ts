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

export class Migration067AddNotificationCollection {
    
    static id = <MigrationId>"Migration_067_AddNotificationCollection";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const notificationCollection = await dbManager.createOrGetCollection("notification");
        await notificationCollection.createIndex("userPubKey");
    }
}
