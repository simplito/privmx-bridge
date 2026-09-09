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
 * Every collection and index a group needs.
 *
 * One migration rather than three, because the group API is unreleased: no deployment exists that ran an
 * earlier slice of this without the rest, so there is nothing for a shorter migration to be compatible with.
 * All of it is `createOrGetCollection` + `createIndex`, both idempotent, so re-running is free.
 *
 * There is deliberately no data step. A group written before the metadata plane existed cannot be made
 * readable: `data` is opaque ciphertext and both tags are HMACs under keys the bridge has never held, so it
 * can copy a blob but not re-tag one. Backfilling `rosterVersion` was tried and removed — it let tree
 * operations succeed on such a group while every read still failed on the missing metadata entry, leaving it
 * writable but unreadable. Without the backfill it is refused on both paths, which is the better of the two
 * broken states, and those groups are dev leftovers that get recreated.
 */
export class Migration071GroupCollections {
    
    static id = <MigrationId>"Migration_071_GroupCollections";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const groupCollection = await dbManager.createOrGetCollection("group");
        // `contextId` alone stays alongside the two compound indexes: it is a prefix of both, but also the only
        // one a `contextId`-only query can use without walking a multikey index, and `contextId` never changes
        // after insert — so it costs nothing on the rotation path that rewrites these documents.
        await groupCollection.createIndex("contextId");
        await groupCollection.createIndex({contextId: 1, users: 1});
        await groupCollection.createIndex({contextId: 1, managers: 1});
        
        const nodeCollection = await dbManager.createOrGetCollection("groupTreeNode");
        await nodeCollection.createIndex({groupId: 1, nodeIndex: 1});
        
        const edgeCollection = await dbManager.createOrGetCollection("groupTreeEdge");
        // Reading the tree, and re-linking one parent's edges after a refresh.
        await edgeCollection.createIndex({groupId: 1, parentIndex: 1, parentGeneration: 1});
        // Finding the edge that seats one member without scanning the rest.
        await edgeCollection.createIndex({groupId: 1, childUserId: 1});
        
        const historyCollection = await dbManager.createOrGetCollection("groupHistoryEntry");
        await historyCollection.createIndex({groupId: 1, version: 1});
        
        // Reads go by derived `_id`; this is for the range delete that drops a group's state.
        const metaCollection = await dbManager.createOrGetCollection("groupMetaEntry");
        await metaCollection.createIndex({groupId: 1});
        
        const rungCollection = await dbManager.createOrGetCollection("groupArchiveRung");
        // Descending from a given epoch reads a window off this index.
        await rungCollection.createIndex({groupId: 1, atKeyVersion: 1});
        // Pruning and cutting an era are range deletes over the epoch a rung points at.
        await rungCollection.createIndex({groupId: 1, targetKeyVersion: 1});
    }
}
