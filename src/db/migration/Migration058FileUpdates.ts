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

export class Migration058FileUpdates {
    
    static id = <MigrationId>"Migration_058_FileUpdates";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const storeFileCollection = await dbManager.createOrGetCollection("storeFile");
        
        for (const storeFile of await storeFileCollection.find({}).toArray()) {
            storeFile.author = storeFile.creator;
            storeFile.createDate = storeFile.created;
            if (storeFile.lastModificationDate !== storeFile.created) {
                storeFile.updates = [{createDate: storeFile.lastModificationDate, author: storeFile.lastModifier}];
            }
            delete storeFile.lastModifier;
            delete storeFile.lastModificationDate;
            delete storeFile.version;
            await storeFileCollection.replaceOne({_id: storeFile._id}, storeFile);
        }
    }
}
