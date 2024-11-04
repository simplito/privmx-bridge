/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IOC } from "../../service/ioc/IOC";
import { Utils } from "../../utils/Utils";
import { MigrationId } from "./MigrationManager";

export class Migration057RenameThreadCollection {
    
    static id = <MigrationId>"Migration_057_RenameThreadCollection";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const mongoDb = dbManager.getDb();
        
        await Utils.tryPromise(() => mongoDb.collection("thread").drop());
        await Utils.tryPromise(() => mongoDb.collection("threadMessage").drop());
        
        await (await dbManager.createOrGetCollection("thread2")).rename("thread");
        await (await dbManager.createOrGetCollection("thread2Message")).rename("threadMessage");
    }
}
