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

/**
 * `keysPrunedBelow` on every space: 0, nothing pruned yet. Up to now a manager's rotation pruned on its own, so a
 * space may be missing older wraps already; 0 then only makes its Endpoint check more rungs than it has to. The
 * rungs need no index change: their uniqueness is the `_id`, which now carries the request's seq. Idempotent.
 */
export class Migration083SpaceKeysPrunedBelow {
    
    static id = <MigrationId>"Migration_083_SpaceKeysPrunedBelow";
    
    static async go(ioc: IOC): Promise<void> {
        const spaces = await ioc.getMongoDbManager().createOrGetCollection(SpaceRepository.COLLECTION_NAME);
        await spaces.updateMany({keysPrunedBelow: {$exists: false}}, {$set: {keysPrunedBelow: 0}});
    }
}
