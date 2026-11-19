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
import { SpaceRepository } from "../../service/cloud/SpaceRepository";

/** The collection of a space's signed statements. Idempotent: a collection and an index only. */
export class Migration078SpaceStatements {
    
    static id = <MigrationId>"Migration_078_SpaceStatements";
    
    static async go(ioc: IOC): Promise<void> {
        const statements = await ioc.getMongoDbManager().createOrGetCollection(SpaceRepository.STATEMENT_COLLECTION_NAME);
        await statements.createIndex({spaceId: 1, seq: 1}, {unique: true});
    }
}
