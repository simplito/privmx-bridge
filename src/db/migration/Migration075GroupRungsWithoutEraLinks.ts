/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as mongodb from "mongodb";
import { IOC } from "../../service/ioc/IOC";
import { MigrationId } from "./MigrationManager";
import { GroupStateRepository } from "../../service/cloud/GroupStateRepository";

/**
 * Every rung is an epoch rung now (L-2). Era links (`recipientKind` `user`/`group`) were never written by a client,
 * so the delete is expected to find nothing; the kind fields of the epoch rungs go. Ids are not rewritten: the
 * per-author checks query by fields, so the old id format is harmless.
 */
export class Migration075GroupRungsWithoutEraLinks {
    
    static id = <MigrationId>"Migration_075_GroupRungsWithoutEraLinks";
    
    static async go(ioc: IOC, session: mongodb.ClientSession|undefined): Promise<void> {
        const rungs = await ioc.getMongoDbManager().createOrGetCollection(GroupStateRepository.ARCHIVE_RUNG_COLLECTION_NAME);
        await rungs.deleteMany({recipientKind: {$in: ["user", "group"]}}, {session});
        await rungs.updateMany({}, {$unset: {recipientKind: "", recipient: ""}}, {session});
    }
}
