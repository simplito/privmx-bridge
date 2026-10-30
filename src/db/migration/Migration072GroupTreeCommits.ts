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

/**
 * The collection a group's tree commit statements live in. Statements are read by derived id (`groupId|seq`) and
 * paged by seq for a client catching up on the chain, which is what the index is for.
 */
export class Migration072GroupTreeCommits {
    
    static id = <MigrationId>"Migration_072_GroupTreeCommits";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const commitCollection = await dbManager.createOrGetCollection("groupTreeCommit");
        await commitCollection.createIndex({groupId: 1, seq: 1});
    }
}
