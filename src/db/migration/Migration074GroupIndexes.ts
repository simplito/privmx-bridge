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
 * Indexes only, so a re-run changes nothing: a new epoch's key is checked against every statement of the group,
 * below the era floor too.
 */
export class Migration074GroupIndexes {
    
    static id = <MigrationId>"Migration_074_GroupIndexes";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const commits = await dbManager.createOrGetCollection(GroupStateRepository.TREE_COMMIT_COLLECTION_NAME);
        await commits.createIndex({groupId: 1, "statement.groupPubKey": 1});
    }
}
