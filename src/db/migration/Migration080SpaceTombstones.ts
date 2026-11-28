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

/** The tombstones of deleted spaces, pruned with their context. Idempotent: a collection and an index only. */
export class Migration080SpaceTombstones {
    
    static id = <MigrationId>"Migration_080_SpaceTombstones";
    
    static async go(ioc: IOC): Promise<void> {
        const tombstones = await ioc.getMongoDbManager().createOrGetCollection(SpaceRepository.TOMBSTONE_COLLECTION_NAME);
        await tombstones.createIndex({contextId: 1});
    }
}
