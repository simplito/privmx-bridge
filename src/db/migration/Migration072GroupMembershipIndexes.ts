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
 * Indexes the membership lookup `GroupRepository.getGroupsOfUser` runs on every Phase 2 grantee resolution.
 *
 * Its filter is `contextId` and an `$or` over two array fields, so one index per branch: Mongo serves each side
 * of the `$or` from its own multikey index instead of fetching every group in the context and filtering.
 *
 * The plain `contextId` index from Migration071 stays. It is a prefix of both of these, but it is also the only
 * one a `contextId`-only query can use without walking a multikey index, and `contextId` never changes after
 * insert — so it costs nothing on the rotation path that rewrites these documents.
 */
export class Migration072GroupMembershipIndexes {
    
    static id = <MigrationId>"Migration_072_GroupMembershipIndexes";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const groupCollection = await dbManager.createOrGetCollection("group");
        await groupCollection.createIndex({contextId: 1, users: 1});
        await groupCollection.createIndex({contextId: 1, managers: 1});
    }
}
