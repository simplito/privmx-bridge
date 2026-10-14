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
import { GroupStateRepository } from "../../service/cloud/GroupStateRepository";

/**
 * A new epoch's key is checked against every statement of the group (T4-24), not against the epoch rows an era cut
 * drops: the first index serves that lookup. Group tombstones are pruned with their context (T4-14): the second.
 * Only indexes are built and dropped, so a re-run changes nothing.
 */
export class Migration074GroupKeyReuseAndTombstones {
    
    static id = <MigrationId>"Migration_074_GroupKeyReuseAndTombstones";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const commits = await dbManager.createOrGetCollection(GroupStateRepository.TREE_COMMIT_COLLECTION_NAME);
        // T4-24 over every epoch, below the era floor too.
        await commits.createIndex({groupId: 1, "statement.groupPubKey": 1});
        // Dev and sandbox databases that already ran 073 carry an index nothing queries any more. Mongo answers a
        // drop of an absent index with code 27 (IndexNotFound); anything else is a real failure.
        const epochKeys = await dbManager.createOrGetCollection(GroupStateRepository.EPOCH_KEY_COLLECTION_NAME);
        await epochKeys.dropIndex("groupId_1_groupPubKey_1").catch((e: {code?: number}) => {
            if (e?.code !== 27) {
                throw e;
            }
        });
        const tombstones = await dbManager.createOrGetCollection(GroupStateRepository.TOMBSTONE_COLLECTION_NAME);
        await tombstones.createIndex({contextId: 1});
    }
}
