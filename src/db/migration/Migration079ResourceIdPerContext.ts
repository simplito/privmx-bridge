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
 * A group's and a space's `clientResourceId` unique per context instead of globally. Their ids are derived from
 * the context and the resourceId, and a resourceId may follow from a public seed, so a global index let a user of
 * one context take a name first in another, or learn that it exists there.
 */
export class Migration079ResourceIdPerContext {
    
    static id = <MigrationId>"Migration_079_ResourceIdPerContext";
    /** Mongo forbids dropping an index inside a transaction. Both steps are idempotent. */
    static transaction = false;
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        for (const name of ["group", "space"]) {
            const collection = await dbManager.createOrGetCollection(name);
            if (await collection.indexExists("clientResourceId_1")) {
                await collection.dropIndex("clientResourceId_1");
            }
            await collection.createIndex({contextId: 1, clientResourceId: 1}, {unique: true, partialFilterExpression: {clientResourceId: {$exists: true}}});
        }
    }
}
