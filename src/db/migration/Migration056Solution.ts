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

export class Migration056Solution {
    
    static id = <MigrationId>"Migration_056_Solution";
    
    static async go(ioc: IOC): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        
        const contextCollection = await dbManager.createOrGetCollection<any>("context");
        const solutionCollection = await dbManager.createOrGetCollection<any>("solution");
        
        const checkSolution = async (id: string, date: any) => {
            const sol = await solutionCollection.findOne({_id: id});
            if (!sol) {
                await solutionCollection.insertOne({_id: id, created: date, name: "MySolution"});
            }
        };
        
        for (const context of await contextCollection.find({}).toArray()) {
            await checkSolution(context.solution, context.created);
            for (const solution of context.shares) {
                await checkSolution(solution, context.created);
            }
        }
    }
}
