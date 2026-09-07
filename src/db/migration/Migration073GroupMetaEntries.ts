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
 * Splits a group's metadata plane out of its roster plane.
 *
 * Creates `groupMetaEntry` and seeds `rosterVersion` from the existing `version`, so both planes continue from
 * where the single counter left off and the endpoint's monotone pins never see a regression.
 *
 * What this migration deliberately does NOT do is make pre-existing groups verifiable. `data` is an opaque
 * ciphertext and both tags are HMACs under keys the bridge has never held, so it can copy a blob but it cannot
 * re-tag one: a copied entry carries a `rosterTag` over the old preimage and no `MetaBlock` at all. Pre-change
 * groups must be recreated. This is the accepted cost of shipping without a dual-shape reader — the group API
 * is unreleased, and the Migration071 data move ("BR-08") it would have had to interact with was never run.
 */
export class Migration073GroupMetaEntries {
    
    static id = <MigrationId>"Migration_073_GroupMetaEntries";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const metaCollection = await dbManager.createOrGetCollection("groupMetaEntry");
        // The head is the highest `version` for a group — one indexed lookup, never a scan of the plane.
        await metaCollection.createIndex({groupId: 1, version: 1});
        
        // Both planes continue from the single counter, rather than restarting at 1 under a reader that would
        // then refuse the lower number as a rollback.
        const groupCollection = await dbManager.createOrGetCollection("group");
        await groupCollection.updateMany(
            {rosterVersion: {$exists: false}},
            [{$set: {rosterVersion: "$version"}}],
        );
    }
}
