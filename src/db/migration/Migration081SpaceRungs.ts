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

/** The rungs of a space's key ladder, read by space and version. Idempotent: a collection and an index only. */
export class Migration081SpaceRungs {
    
    static id = <MigrationId>"Migration_081_SpaceRungs";
    
    static async go(ioc: IOC): Promise<void> {
        const rungs = await ioc.getMongoDbManager().createOrGetCollection(SpaceRepository.RUNG_COLLECTION_NAME);
        await rungs.createIndex({spaceId: 1, atKeyVersion: 1});
    }
}
