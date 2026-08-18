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
 * Creates the collections a group's state lives in outside its document, with their indexes. Touches no existing
 * data — moving what current documents still carry in `tree`, `history` and `archiveRungs` is BR-08.
 */
export class Migration071GroupStateCollections {
    
    static id = <MigrationId>"Migration_071_GroupStateCollections";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        // The group collection never had a migration of its own, so its lookup index is added here too.
        const groupCollection = await dbManager.createOrGetCollection("group");
        await groupCollection.createIndex("contextId");
        
        const nodeCollection = await dbManager.createOrGetCollection("groupTreeNode");
        await nodeCollection.createIndex({groupId: 1, nodeIndex: 1});
        
        const edgeCollection = await dbManager.createOrGetCollection("groupTreeEdge");
        // Reading the tree, and re-linking one parent's edges after a refresh.
        await edgeCollection.createIndex({groupId: 1, parentIndex: 1, parentGeneration: 1});
        // Finding the edge that seats one member without scanning the rest.
        await edgeCollection.createIndex({groupId: 1, childUserId: 1});
        
        const historyCollection = await dbManager.createOrGetCollection("groupHistoryEntry");
        await historyCollection.createIndex({groupId: 1, version: 1});
        
        const rungCollection = await dbManager.createOrGetCollection("groupArchiveRung");
        // Descending from a given epoch reads a window off this index.
        await rungCollection.createIndex({groupId: 1, atKeyVersion: 1});
        // Pruning and cutting an era are range deletes over the epoch a rung points at.
        await rungCollection.createIndex({groupId: 1, targetKeyVersion: 1});
    }
}
