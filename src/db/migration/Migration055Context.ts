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

export class Migration055Context {
    
    static id = <MigrationId>"Migration_055_Context";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const contextCollection = await dbManager.createOrGetCollection<any>("context");
        await contextCollection.createIndex("solution");
        await contextCollection.createIndex("shares");
        
        for (const context of await contextCollection.find({}).toArray()) {
            const solution = context.solutions[0];
            const shares = context.solutions.slice(1);
            const newContext = {
                _id: context._id,
                created: context.created,
                modified: context.created,
                solution: solution,
                shares: shares,
                name: "MyContext",
                description: "",
                scope: "private",
            };
            await contextCollection.replaceOne({_id: context._id}, newContext);
        }
    }
}
