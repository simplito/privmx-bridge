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
 * One migration rather than several, because the group API is unreleased: no deployment exists that ran an
 * earlier slice of this without the rest, so there is nothing for a shorter migration to be compatible with.
 * All of it is `createOrGetCollection` + `createIndex`, both idempotent, so re-running is free.
 *
 * The **id is deliberately bumped** from `Migration_071_GroupCollections`, which created a single
 * `groupMetaEntry` collection before the metadata planes were split in two. `MigrationManager` keys applied
 * migrations purely by id, so a developer machine that ran the old one has that id recorded and this one
 * unrecorded — and therefore runs this. Editing in place under the old id would silently skip exactly the
 * machines that still lack the plane collections. A 072 that corrected 071 would instead be archaeology of a
 * collection that never shipped, and would leave a permanently empty `groupMetaEntry` on every fresh install.
 *
 * `groupMetaEntry` is deliberately not dropped: migrations run inside a transaction and Mongo forbids dropping
 * a collection in one. It exists only on developer machines, is empty, and costs nothing. Run
 * `db.groupMetaEntry.drop()` by hand to be rid of it.
 *
 * There is deliberately no data step. A group written before the metadata planes existed cannot be made
 * readable: `data` is opaque ciphertext and every tag is an HMAC under a key the bridge has never held, so it
 * can copy a blob but not re-tag one — and it certainly cannot split one signed envelope into two
 * independently verifiable ones, which needs a second DIO and a domain-separated tag only the client can
 * produce. Backfilling `rosterVersion` was tried and removed — it let tree operations succeed on such a group
 * while every read still failed on the missing metadata entry, leaving it writable but unreadable. Without the
 * backfill it is refused on both paths, which is the better of the two broken states, and those groups are dev
 * leftovers that get recreated. Seeding the per-plane counters is unnecessary for the same reason: no document
 * carrying the superseded single `version` counter exists outside a dev machine that recreates its groups.
 */
export class Migration071GroupCollections {
    
    static id = <MigrationId>"Migration_071_GroupCollections_MetaPlanes";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const groupCollection = await dbManager.createOrGetCollection("group");
        // `contextId` alone stays alongside the two compound indexes: it is a prefix of both, but also the only
        // one a `contextId`-only query can use without walking a multikey index, and `contextId` never changes
        // after insert — so it costs nothing on the rotation path that rewrites these documents.
        await groupCollection.createIndex("contextId");
        await groupCollection.createIndex({contextId: 1, users: 1});
        await groupCollection.createIndex({contextId: 1, managers: 1});
        // The `group` collection never got the resourceId index its siblings got in Migration064, so
        // DUPLICATE_RESOURCE_ID could not fire for a resourceId reason at all. Same partial-unique shape.
        await groupCollection.createIndex("clientResourceId", {
            unique: true,
            partialFilterExpression: {
                clientResourceId: {
                    $exists: true,
                },
            },
        });
        
        const nodeCollection = await dbManager.createOrGetCollection("groupTreeNode");
        await nodeCollection.createIndex({groupId: 1, nodeIndex: 1});
        
        const edgeCollection = await dbManager.createOrGetCollection("groupTreeEdge");
        // Reading the tree, and re-linking one parent's edges after a refresh.
        await edgeCollection.createIndex({groupId: 1, parentIndex: 1, parentGeneration: 1});
        // Finding the edge that seats one member without scanning the rest.
        await edgeCollection.createIndex({groupId: 1, childUserId: 1});
        
        const historyCollection = await dbManager.createOrGetCollection("groupHistoryEntry");
        await historyCollection.createIndex({groupId: 1, version: 1});
        
        // One collection per metadata plane rather than one with a plane discriminator: the two planes are
        // written by different endpoints and move independently, and separate collections are what make a
        // forgotten plane predicate impossible rather than merely unlikely.
        //
        // One row per group in each, so reads go by derived `_id`; these indexes are for the range delete that
        // drops a group's state.
        const publicMetaCollection = await dbManager.createOrGetCollection("groupPublicMetaEntry");
        await publicMetaCollection.createIndex({groupId: 1});
        const privateMetaCollection = await dbManager.createOrGetCollection("groupPrivateMetaEntry");
        await privateMetaCollection.createIndex({groupId: 1});
        
        const rungCollection = await dbManager.createOrGetCollection("groupArchiveRung");
        // Descending from a given epoch reads a window off this index.
        await rungCollection.createIndex({groupId: 1, atKeyVersion: 1});
        // Pruning and cutting an era are range deletes over the epoch a rung points at.
        await rungCollection.createIndex({groupId: 1, targetKeyVersion: 1});
    }
}
