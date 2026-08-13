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

export class Migration070StreamRoomState {
    
    static id = <MigrationId>"Migration_070_StreamRoomState";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const mongoDb = dbManager.getDb();
        
        const streamRoomCollection = mongoDb.collection("streamRoom");
        
        // Closed rooms keep their meaning directly.
        await streamRoomCollection.updateMany({closed: true}, {$set: {state: "closed"}, $unset: {closed: ""}});
        // Non-closed rooms had no participant tracking that survives a restart,
        // so they are treated as freshly provisioned ("created") rooms.
        await streamRoomCollection.updateMany({closed: {$ne: true}, state: {$exists: false}}, {$set: {state: "created"}, $unset: {closed: ""}});
    }
}
