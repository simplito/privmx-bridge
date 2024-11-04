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

export class Migration054Auth {
    
    static id = <MigrationId>"Migration_054_Auth";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        await dbManager.createOrGetCollection("api_user");
        await dbManager.createOrGetCollection("token_encryption_key");
        
        const tokenSessionCollection = await dbManager.createOrGetCollection("token_session");
        await tokenSessionCollection.createIndex("apiKey");
        await tokenSessionCollection.createIndex("user");
        
        const apiKeyCollection = await dbManager.createOrGetCollection("api_key");
        await apiKeyCollection.createIndex("user");
    }
}
