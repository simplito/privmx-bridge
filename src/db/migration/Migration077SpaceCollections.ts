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
import { SpaceRepository } from "../../service/cloud/SpaceRepository";

/** The two collections of a space and their indexes. Idempotent: collections and indexes only. */
export class Migration077SpaceCollections {
    
    static id = <MigrationId>"Migration_077_SpaceCollections";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const spaces = await dbManager.createOrGetCollection(SpaceRepository.COLLECTION_NAME);
        await spaces.createIndex({contextId: 1, "users.userId": 1});
        // Without `contextId` too: a group's epoch change looks its spaces up by the group alone.
        await spaces.createIndex({"groups.groupId": 1});
        await spaces.createIndex("clientResourceId", {unique: true, partialFilterExpression: {clientResourceId: {$exists: true}}});
        const keys = await dbManager.createOrGetCollection(SpaceRepository.KEY_COLLECTION_NAME);
        await keys.createIndex({spaceId: 1, keyVersion: 1});
    }
}
