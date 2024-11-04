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

export class Migration000Scheme {
    
    static id = <MigrationId>"Migration_000_Scheme";
    static transaction = false;
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        await dbManager.createCollections([
            "__lock",
            "init",
            "migration",
            "nonce",
            "request",
            "session",
            "settings",
            "ticketData",
            "server_stats",
        ]);
    }
}
