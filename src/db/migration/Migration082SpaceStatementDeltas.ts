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
 * Space statements became deltas with a `rosterHash` (statement version 2): a history of full-roster statements
 * cannot be continued, and spaces are unreleased, so every space from before goes, with its keys, rungs and
 * statements. No tombstones: their ids are free to be created again. Idempotent.
 */
export class Migration082SpaceStatementDeltas {
    
    static id = <MigrationId>"Migration_082_SpaceStatementDeltas";
    
    static async go(ioc: IOC): Promise<void> {
        const db = ioc.getMongoDbManager();
        const old = await (await db.createOrGetCollection(SpaceRepository.COLLECTION_NAME)).find({"statement.rosterHash": {$exists: false}}, {projection: {_id: 1}}).toArray();
        const ids = old.map(space => space._id);
        if (ids.length === 0) {
            return;
        }
        for (const name of [SpaceRepository.KEY_COLLECTION_NAME, SpaceRepository.STATEMENT_COLLECTION_NAME, SpaceRepository.RUNG_COLLECTION_NAME]) {
            await (await db.createOrGetCollection(name)).deleteMany({spaceId: {$in: ids}});
        }
        await (await db.createOrGetCollection(SpaceRepository.COLLECTION_NAME)).deleteMany({_id: {$in: ids}});
    }
}
