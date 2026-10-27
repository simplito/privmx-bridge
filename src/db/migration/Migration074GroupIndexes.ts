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
import { StreamRoomRepository } from "../../service/cloud/StreamRoomRepository";

/**
 * Indexes only, so a re-run changes nothing:
 * - a new epoch's key is checked against every statement of the group, below the era floor too;
 * - group tombstones are pruned with their context;
 * - group removals, rotations and deletions look up the stream rooms granted to the group.
 */
export class Migration074GroupIndexes {
    
    static id = <MigrationId>"Migration_074_GroupIndexes";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const commits = await dbManager.createOrGetCollection(GroupStateRepository.TREE_COMMIT_COLLECTION_NAME);
        await commits.createIndex({groupId: 1, "statement.groupPubKey": 1});
        const tombstones = await dbManager.createOrGetCollection(GroupStateRepository.TOMBSTONE_COLLECTION_NAME);
        await tombstones.createIndex({contextId: 1});
        const rooms = await dbManager.createOrGetCollection(StreamRoomRepository.COLLECTION_NAME);
        await rooms.createIndex({"groups.groupId": 1});
    }
}
