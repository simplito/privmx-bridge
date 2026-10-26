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
 * Indexes only, so a re-run changes nothing: `groupGetEpochKeys` finds a past epoch's row by the keyId of its
 * self-addressed key (a member envelope) or by its grant key (an anonymous envelope), off the index rather than
 * a scan of the group's epochs.
 */
export class Migration076GroupEpochKeyLookups {
    
    static id = <MigrationId>"Migration_076_GroupEpochKeyLookups";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const epochKeys = await dbManager.createOrGetCollection(GroupStateRepository.EPOCH_KEY_COLLECTION_NAME);
        await epochKeys.createIndex({groupId: 1, "groupKey.keyId": 1});
        await epochKeys.createIndex({groupId: 1, groupPubKey: 1});
    }
}
