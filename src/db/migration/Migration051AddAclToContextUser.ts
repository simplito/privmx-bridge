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

export class Migration051AddAclToContextUser {
    
    static id = <MigrationId>"Migration_051_AddAclToContextUser";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const contextUserCollection = await dbManager.createOrGetCollection("contextUser");
        await contextUserCollection.updateMany({}, {$set: {acl: "ALLOW ALL"}});
    }
}
