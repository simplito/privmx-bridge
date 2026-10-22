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
import { StreamRoomRepository } from "../../service/cloud/StreamRoomRepository";

/**
 * Every group removal and rotation looks up the stream rooms granted to the group (`getGrantedTo`, F-05e/f), and a
 * group deletion checks whether any still does (`isGroupReferenced`): both query `groups.groupId`. Index only, so a
 * re-run changes nothing.
 */
export class Migration076StreamRoomGroupIndex {
    
    static id = <MigrationId>"Migration_076_StreamRoomGroupIndex";
    
    static async go(ioc: IOC): Promise<void> {
        const rooms = await ioc.getMongoDbManager().createOrGetCollection(StreamRoomRepository.COLLECTION_NAME);
        await rooms.createIndex({"groups.groupId": 1});
    }
}
